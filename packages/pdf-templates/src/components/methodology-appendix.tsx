import { z } from 'zod';

// Shared bundle schema — the same shape every Council-affecting PDF
// template can opt into. Mirrors `LandscapeMethodologyBundle` from
// @kku/db; redeclared here so pdf-templates doesn't take a @kku/db
// dependency.
export const MethodologyBundleSchema = z.object({
  tag: z.string(),                                // "landscape-2026-05.v1"
  fingerprint: z.string(),                        // 8-char SHA-256 prefix
  manifest: z.record(z.string(), z.string()),     // { 'health-score': 'v3.4', ... }
});
export type MethodologyBundle = z.infer<typeof MethodologyBundleSchema>;

/**
 * Format a bundle into its cover/footer stamp: `tag+fingerprint`.
 * Pure helper — templates can inline this if they need just the string.
 */
export function formatMethodologyStamp(bundle: MethodologyBundle): string {
  return `${bundle.tag}+${bundle.fingerprint}`;
}

// Back-compat alias for the original Council Pack consumer.
export type CouncilPackMethodologyBundle = MethodologyBundle;

// Renders the methodology bundle as an appendix at the end of a Council
// Pack. Closes evaluation-pipeline.md §13 gap #4 — readers see the exact
// version of every sub-methodology that contributed to the numbers in
// the brief, with both the citable calendar tag (e.g. `landscape-2026-05.v1`)
// and the drift-catching fingerprint (8-char SHA-256 of the manifest).
//
// Display logic: alphabetical by methodology key. The manifest can have
// 30+ entries — readable as a two-column table at A4.

export interface MethodologyAppendixProps {
  bundle: CouncilPackMethodologyBundle;
}

export function MethodologyAppendix({ bundle }: MethodologyAppendixProps) {
  const entries = Object.entries(bundle.manifest)
    .map(([key, version]) => ({ key, version }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return (
    <section className="appendix methodology-appendix" style={{ pageBreakBefore: 'always' }}>
      <h2>เวอร์ชันระเบียบวิธี · Methodology bundle</h2>
      <p className="muted" style={{ marginTop: '4pt', marginBottom: '12pt' }}>
        ตัวบ่งชี้รุ่น (Bundle ID): <strong>{bundle.tag}+{bundle.fingerprint}</strong>
        <br />
        <small>
          ใช้ ID นี้อ้างอิงเมื่อสนทนาเกี่ยวกับเอกสารฉบับนี้ภายหลัง — มันบ่งบอกว่าใช้ระเบียบวิธี
          เวอร์ชันใดในการคำนวณตัวเลขทั้งหมดในรายงาน
        </small>
      </p>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '9pt',
          marginTop: '8pt',
        }}
      >
        <thead>
          <tr style={{ borderBottom: '0.5pt solid #999' }}>
            <th style={{ textAlign: 'left', padding: '4pt 8pt 4pt 0', width: '50%' }}>
              ระเบียบวิธี · Methodology
            </th>
            <th style={{ textAlign: 'left', padding: '4pt 0' }}>เวอร์ชัน · Version</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.key} style={{ borderBottom: '0.25pt dotted #ccc' }}>
              <td style={{ padding: '3pt 8pt 3pt 0', fontVariantNumeric: 'tabular-nums' }}>{e.key}</td>
              <td style={{ padding: '3pt 0', fontFamily: 'IBM Plex Mono, monospace', fontSize: '8.5pt' }}>
                {e.version}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: '12pt', fontSize: '8.5pt' }}>
        ระเบียบวิธีทั้งหมด: {entries.length} รายการ
        &nbsp;·&nbsp;
        Documented at <code>docs/methodologies/</code>
        &nbsp;·&nbsp;
        Source-of-truth: <code>packages/db/src/methodology-bundle.ts</code>
      </p>
    </section>
  );
}
