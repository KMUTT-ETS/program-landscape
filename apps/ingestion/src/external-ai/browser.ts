import { Logger } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';
import { stripExternalAiHtml } from '@kku/db';

// ─────────────────────────────────────────────────────────────────────────
// Singleton Playwright Chromium for CDN-protected external-ai sources.
//
// Some sites (OECD, WEF, Incapsula-protected gov sites) block plain
// server-side fetches even with a Chrome UA — they run TLS / JS
// challenges that only a real browser solves. This wrapper launches
// one headless browser per worker process, reuses it for every
// HEADLESS-strategy job, and exposes a `fetchHtml(url)` helper that
// returns plain text.
//
// Lifecycle:
//   - Lazy launch on first call (saves 200ms boot time when no
//     HEADLESS source is configured)
//   - Single Browser instance, one Context per fetch (clean cookies)
//   - Explicit close() at worker shutdown
//
// Memory + time: each fetch costs ~50-200MB peak + 5-15s wall time.
// Worker concurrency stays at 1 for the external-ai queue so we
// never hold multiple pages open simultaneously.
// ─────────────────────────────────────────────────────────────────────────

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class BrowserService {
  private readonly logger = new Logger(BrowserService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (this.launching) return this.launching;
    this.launching = chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    try {
      this.browser = await this.launching;
      this.logger.log('headless Chromium launched');
      return this.browser;
    } finally {
      this.launching = null;
    }
  }

  // Resolve URL → stripped plain text. Mirrors the PLAIN path's
  // contract: any HTTP failure throws; otherwise returns the same
  // stripped output the LLM prompt expects.
  async fetchHtml(url: string): Promise<string> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
      // Time-zone matters for some sites' geo-fencing decisions.
      timezoneId: 'Asia/Bangkok',
    });
    try {
      const page = await context.newPage();
      // 25s ceiling on the whole navigation. CDN challenges typically
      // resolve in 1-3s once Chromium's JS runtime executes them.
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      if (!response) throw new Error('No response from headless fetch');
      const status = response.status();
      if (status >= 400) {
        throw new Error(`Headless HTTP ${status}`);
      }
      // Some challenges replace the body after DOMContentLoaded; wait
      // for network-idle briefly so the real content lands.
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {
          /* network-idle isn't strictly required; we keep what we have */
        });
      const html = await page.content();
      return stripExternalAiHtml(html).slice(0, 50_000);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch((err) => {
        this.logger.warn(`browser close failed: ${(err as Error).message}`);
      });
      this.browser = null;
    }
  }
}
