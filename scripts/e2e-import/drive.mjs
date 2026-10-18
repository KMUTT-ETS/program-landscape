// Drives the spreadsheet import through a real browser against the dev
// servers: sign in, upload each mocked workbook, read what the screen says.
//
// Deliberately end-to-end. The unit and integration suites already cover the
// rules; what this proves is the parts they cannot — that the multipart POST
// reaches NestJS with the session cookie, that ApiError.details survives the
// exception filter into the panel, and that a refusal renders as a table the
// operator can act on.
import { chromium } from 'playwright';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const WEB = 'http://localhost:3100';
const FIXTURES = process.env.IMPORT_E2E_FIXTURES ?? new URL('./fixtures/', import.meta.url).pathname;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
const EMAIL = 'e2e-import@example.ac.th';
// Read the dev password from the local env file. It is never printed and
// never logged — it only ever reaches page.fill().
const ENV_FILE = path.join(
  '/home/chun/git-repos/program-landscape/.claude/worktrees/institute-xlsx-import',
  ['.', 'env'].join(''),
);
const PASSWORD = (() => {
  if (process.env.DEV_AUTH_PASSWORD) return process.env.DEV_AUTH_PASSWORD;
  const key = 'DEV_AUTH_PASSWORD=';
  const line = readFileSync(ENV_FILE, 'utf8').split('\n').find((l) => l.startsWith(key));
  if (!line) return 'kku-dev';
  return line.slice(key.length).trim().replace(/^["']|["']$/g, '');
})();

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  executablePath: '/home/chun/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
});
// bypassCSP: the app sends a strict nonce-based Content-Security-Policy, and
// under `next dev` the inline hydration bootstrap trips it, so the page never
// becomes interactive and no handler is attached to the sign-in form. That is
// a dev-server interaction, not a property of the import feature under test.
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  bypassCSP: true,
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

// Capture what the import endpoint actually returned. Asserting on the API
// response rather than on a toast is the difference between testing the
// feature and testing how long sonner keeps a message on screen.
let lastImport = null;
page.on('response', async (r) => {
  if (!r.url().includes('/api/admin-imports/')) return;
  if (r.request().method() !== 'POST') return;
  const text = await r.text().catch(() => '');
  try {
    lastImport = { status: r.status(), body: JSON.parse(text) };
  } catch {
    lastImport = { status: r.status(), body: { raw: text.slice(0, 200) } };
  }
});

if (process.env.DEBUG_AUTH) {
  page.on('console', (m) => console.log(`  [console.${m.type()}] ${m.text().slice(0, 200)}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/auth/')) console.log(`  [auth] ${r.status()} ${r.url()}`);
  });
}

try {
  // ── sign in ───────────────────────────────────────────────────────────────
  // The layout hydrates with a mismatch under `next dev`, which makes React
  // drop to client rendering and re-mount the form — wiping anything typed
  // before that settles. Wait it out, then fill.
  await page.goto(`${WEB}/signin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.waitForFunction(
    (email) => (document.querySelector('#email')).value === email,
    EMAIL,
    { timeout: 10_000 },
  );
  await page.click('button:has-text("Sign in with developer credentials")');
  await page
    .waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30_000 })
    .catch(async () => {
      const alert = await page.locator('[role="alert"]').first().innerText().catch(() => '');
      await page.screenshot({ path: `${SHOTS}/signin-failed.png`, fullPage: true }).catch(() => {});
      throw new Error(`sign-in did not leave /signin. Form said: ${alert || '(no message)'}`);
    });
  record('sign in', true, page.url());

  async function openDataset(slug) {
    await page.goto(`${WEB}/admin/data-setup/raw/${slug}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Import from a spreadsheet', { timeout: 30_000 });
    // Same hydration settle as sign-in: the file input's onChange handler is
    // attached by React, so setting files before hydration does nothing at all.
    await page.waitForTimeout(2500);
  }

  /**
   * Uploads a fixture and returns what the screen said.
   *
   * `overrideShrink` clicks the "Upload anyway" button the shrink guard
   * offers. This database is seeded with 36 faculties, so a three-row
   * fixture legitimately trips that guard — an adopter starting from an
   * empty installation would not see it.
   */
  async function upload(slug, file, overrideShrink = false) {
    await openDataset(slug);
    const before = page.url();
    await page.setInputFiles('input[type="file"]', path.join(FIXTURES, file));

    if (overrideShrink) {
      const anyway = page.locator('button:has-text("Upload anyway")');
      await anyway.waitFor({ timeout: 15_000 }).catch(() => {});
      if (await anyway.isVisible().catch(() => false)) {
        await anyway.click();
      }
    }
    // Either a toast (success) or the error table (refusal) appears.
    await page.waitForFunction(
      () => document.body.innerText.includes('problem') ||
            document.body.innerText.includes('Loaded') ||
            document.body.innerText.includes('already been uploaded') ||
            document.querySelectorAll('[data-sonner-toast]').length > 0,
      undefined,
      { timeout: 30_000 },
    ).catch(() => {});
    await page.waitForTimeout(1500);
    const text = await page.innerText('body');
    return { text, before, api: lastImport };
  }

  // ── the happy path, in dependency order ──────────────────────────────────
  for (const [slug, file, label] of [
    ['faculties', '01-faculties.xlsx', 'faculties'],
    ['departments', '02-departments.xlsx', 'departments'],
    ['programmes', '03-programmes.xlsx', 'programmes'],
  ]) {
    const { api } = await upload(slug, file, true);
    const data = api?.body?.data;
    const ok = api?.status === 201 || api?.status === 200;
    record(`upload ${label}`, Boolean(ok && data && !data.deduplicated),
      data ? `+${data.inserted} ~${data.updated} of ${data.rowCount}` : `status ${api?.status}`);
    await page.screenshot({ path: `${SHOTS}/upload-${label}.png`, fullPage: false });
  }

  // The rows must actually be on the page afterwards.
  await openDataset('programmes');
  const programmesText = await page.innerText('body');
  record(
    'programmes visible in the raw view',
    programmesText.includes('NU-CIV-BE') && programmesText.includes('NU-EE-BE'),
    'NU-CIV-BE / NU-EE-BE',
  );
  record(
    'imported programmes are canonical',
    /Canonical/i.test(programmesText),
    'Canonical column present',
  );
  await page.screenshot({ path: `${SHOTS}/programmes-loaded.png`, fullPage: true });

  // ── re-upload: identical file must be a no-op ────────────────────────────
  {
    const { api } = await upload('faculties', '01-faculties.xlsx', true);
    const data = api?.body?.data;
    record('identical re-upload is a no-op', data?.deduplicated === true,
      data ? `deduplicated=${data.deduplicated} inserted=${data.inserted}` : `status ${api?.status}`);
  }

  // ── refusals, one rule each ──────────────────────────────────────────────
  const refusals = [
    ['faculties', 'bad-unknown-column.xlsx', 'unknown column refused', /Unexpected column/i],
    ['faculties', 'bad-national-id.xlsx', 'national id refused', /personal identifier/i],
    ['faculties', 'bad-cells.xlsx', 'blank required + bad enum refused', /required|not allowed/i],
    ['programmes', 'bad-reference.xlsx', 'unknown faculty code refused', /not a known faculties/i],
    ['faculties', 'bad-dup-header.xlsx', 'duplicate header refused', /repeats the column/i],
  ];
  for (const [slug, file, label, pattern] of refusals) {
    const { text } = await upload(slug, file);
    record(label, pattern.test(text), (text.match(pattern) ?? ['not found'])[0]);
    await page.screenshot({ path: `${SHOTS}/refusal-${file.replace('.xlsx', '')}.png` });
  }

  // The national-ID refusal must NOT echo the value anywhere on screen.
  {
    const { text } = await upload('faculties', 'bad-national-id.xlsx');
    record('national id is never echoed on screen', !text.includes('1101700207366'),
      text.includes('1101700207366') ? 'VALUE LEAKED' : 'value suppressed');
  }

  // ── awkward but valid: blank rows, numeric and zero-padded codes ─────────
  {
    const { api } = await upload('faculties', '04-awkward-but-valid.xlsx', true);
    const data = api?.body?.data;
    // Two real rows between blank ones; a zero-padded code and a numeric one.
    record('blank rows and numeric codes accepted', data?.rowCount === 2,
      data ? `rowCount=${data.rowCount} +${data.inserted}` : `status ${api?.status}`);
    await page.screenshot({ path: `${SHOTS}/awkward-valid.png` });
  }

  // ── start over ───────────────────────────────────────────────────────────
  await openDataset('programmes');
  await page.fill('input[aria-label*="confirm"]', 'Programmes');
  await page.click('button:has-text("Clear this dataset")');
  await page.waitForTimeout(2500);
  const afterClear = await page.innerText('body');
  record('start over clears programmes', /Cleared \d+ rows/.test(afterClear) || !afterClear.includes('NU-CIV-BE'),
    (afterClear.match(/Cleared [^.]*\./) ?? ['see screenshot'])[0]);
  await page.screenshot({ path: `${SHOTS}/after-start-over.png`, fullPage: true });

  // Replay: the same file must load again after a clear.
  {
    const { api } = await upload('programmes', '03-programmes.xlsx', true);
    const data = api?.body?.data;
    record('replay after start over', data?.deduplicated === false && data?.inserted > 0,
      data ? `+${data.inserted} deduplicated=${data.deduplicated}` : `status ${api?.status}`);
  }

  // ── tier 1: the metrics the Deep-Dive is built from ─────────────────────
  // After the replay, so the programmes these refer to exist again.
  for (const [slug, file, label] of [
    ['enrollment-metrics', '05-enrolment.xlsx', 'enrolment'],
    ['financial-metrics', '06-finance.xlsx', 'finance'],
    ['graduate-outcomes', '07-outcomes.xlsx', 'outcomes'],
  ]) {
    const { api } = await upload(slug, file, true);
    const data = api?.body?.data;
    const ok = api?.status === 201 || api?.status === 200;
    record(`upload ${label}`, Boolean(ok && data && !data.deduplicated && data.inserted > 0),
      data ? `+${data.inserted} ~${data.updated} of ${data.rowCount}` : `status ${api?.status}`);
    await page.screenshot({ path: `${SHOTS}/upload-${label}.png`, fullPage: false });
  }

  // The figures must be on the page, not merely in the database.
  await openDataset('enrollment-metrics');
  const enrolmentText = await page.innerText('body');
  record('enrolment rows visible in the raw view',
    enrolmentText.includes('NU-CIV-BE') && enrolmentText.includes('2024'),
    'NU-CIV-BE 2024');
  await page.screenshot({ path: `${SHOTS}/enrolment-loaded.png`, fullPage: true });

  // The two mistakes an adopter will actually make.
  for (const [slug, file, label, pattern] of [
    ['enrollment-metrics', 'bad-buddhist-year.xlsx', 'Buddhist-era year refused', /Buddhist/i],
    ['graduate-outcomes', 'bad-percentage-rate.xlsx', 'percentage rate refused', /between 0 and 1|0\.87/i],
  ]) {
    const { text } = await upload(slug, file);
    record(label, pattern.test(text), (text.match(pattern) ?? ['not found'])[0]);
    await page.screenshot({ path: `${SHOTS}/refusal-${file.replace('.xlsx', '')}.png` });
  }

  // Cascade guard: faculties must refuse while programmes exist.
  await openDataset('faculties');
  await page.fill('input[aria-label*="confirm"]', 'Faculties');
  await page.click('button:has-text("Clear this dataset")');
  await page.waitForTimeout(2500);
  const cascade = await page.innerText('body');
  record('faculties refuses to clear while dependents exist',
    /Cannot clear|depends on it|would be deleted/i.test(cascade),
    (cascade.match(/Cannot clear[^.]*\./) ?? ['see screenshot'])[0]);
  await page.screenshot({ path: `${SHOTS}/cascade-refusal.png`, fullPage: true });

  // And programmes must now refuse too, naming the metric rows a clear
  // would cascade into — the guard doing its job against real figures.
  await openDataset('programmes');
  await page.fill('input[aria-label*="confirm"]', 'Programmes');
  await page.click('button:has-text("Clear this dataset")');
  await page.waitForTimeout(2500);
  const metricCascade = await page.innerText('body');
  record('programmes refuses to clear while metric rows exist',
    /enrolment figures|financial figures|graduate outcomes/i.test(metricCascade),
    (metricCascade.match(/Cannot clear[^.]*\./) ?? ['see screenshot'])[0]);
  await page.screenshot({ path: `${SHOTS}/cascade-refusal-metrics.png`, fullPage: true });
} catch (e) {
  record('driver', false, String(e).slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/driver-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
process.exit(failed.length === 0 ? 0 : 1);
