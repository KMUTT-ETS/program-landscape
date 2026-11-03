import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HEADER =
  "# ── KKU example connectors (off; only for Khon Kaen University's own systems) ──";

const text = readFileSync(join(__dirname, '..', '..', '..', '.env.example'), 'utf8');
const lines = text.split('\n');
const headerIdx = lines.indexOf(HEADER);

describe('.env.example', () => {
  it('has the KKU example header exactly once', () => {
    expect(headerIdx).toBeGreaterThan(-1);
    expect(lines.filter((l) => l === HEADER)).toHaveLength(1);
  });

  it('disables mock connector runs by default', () => {
    expect(lines).toContain('ALLOW_MOCK_CONNECTOR_RUNS=false');
  });

  it('uses generic database defaults', () => {
    expect(lines).toContain('POSTGRES_USER=landscape');
    expect(lines).toContain('POSTGRES_PASSWORD=landscape_dev_password');
    expect(lines).toContain('DEV_AUTH_PASSWORD=change-me-dev');
  });

  it('mentions kku.ac.th and KKU_SSO_ISSUER only inside the KKU section', () => {
    const outside = lines.slice(0, headerIdx).join('\n');
    expect(outside).not.toContain('kku.ac.th');
    expect(outside).not.toContain('KKU_SSO_ISSUER');
  });

  it('keeps every KKU_* assignment below the KKU header', () => {
    lines.forEach((line, i) => {
      const trimmed = line.replace(/^#\s*/, '');
      if (/^(KKU_|UNICON_|DQ_API_)[A-Z0-9_]*=/.test(trimmed)) {
        expect(i, line).toBeGreaterThan(headerIdx);
      }
    });
  });
});
