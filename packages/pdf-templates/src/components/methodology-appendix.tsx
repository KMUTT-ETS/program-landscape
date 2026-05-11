import { z } from 'zod';

// Shared bundle schema — the same shape every Council-affecting PDF
// template can opt into. Mirrors `LandscapeMethodologyBundle` from
// @kku/db; redeclared here so pdf-templates doesn't take a @kku/db
// dependency.
//
// `previewMethodologies` lists methodology slugs whose outputs flow into
// the brief but have not yet been signed off by their governance body
// (gap #5). The appendix renders a PREVIEW badge for any manifest entry
// in this list. Optional + defaults to `[]` for back-compat.
export const MethodologyBundleSchema = z.object({
  tag: z.string(),                                // "landscape-2026-05.v1"
  fingerprint: z.string(),                        // 8-char SHA-256 prefix
  manifest: z.record(z.string(), z.string()),     // { 'health-score': 'v3.4', ... }
  previewMethodologies: z.array(z.string()).optional().default([]),
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
  const previewSet = new Set(bundle.previewMethodologies ?? []);
  const entries = Object.entries(bundle.manifest)
    .map(([key, version]) => ({ key, version, isPreview: previewSet.has(key) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const previewCount = entries.filter((e) => e.isPreview).length;
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
      {previewCount > 0 && (
        <div
          style={{
            marginTop: '4pt',
            marginBottom: '12pt',
            padding: '8pt 10pt',
            border: '0.5pt solid #c87f00',
            background: '#fff7e8',
            fontSize: '9pt',
            color: '#5a3a00',
          }}
        >
          <strong>⚠ ระเบียบวิธีที่อยู่ระหว่างทดลองใช้ (PREVIEW)</strong>: {previewCount} รายการ
          <br />
          เอกสารนี้อ้างอิงระเบียบวิธีที่ยังไม่ได้รับการอนุมัติอย่างเป็นทางการ — ตัวเลขที่คำนวณจาก
          ระเบียบวิธีเหล่านี้ควรถือเป็น <em>preview-quality</em> จนกว่าหน่วยงานที่รับผิดชอบจะให้
          ความเห็นชอบ. รายการที่มีเครื่องหมาย <strong>PREVIEW</strong> ในตารางด้านล่างคือรายการที่อยู่
          ระหว่างทดลอง.
          <br />
          <em style={{ fontSize: '8.5pt' }}>
            This brief depends on {previewCount} methodologies pending governance sign-off.
            Numbers derived from them should be treated as preview-quality.
          </em>
        </div>
      )}
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
              <td style={{ padding: '3pt 8pt 3pt 0', fontVariantNumeric: 'tabular-nums' }}>
                {e.key}
                {e.isPreview && (
                  <span
                    style={{
                      display: 'inline-block',
                      marginLeft: '6pt',
                      padding: '0pt 4pt',
                      border: '0.5pt solid #c87f00',
                      background: '#fff7e8',
                      color: '#5a3a00',
                      fontSize: '7.5pt',
                      fontWeight: 'bold',
                      letterSpacing: '0.5pt',
                      verticalAlign: 'middle',
                    }}
                  >
                    PREVIEW
                  </span>
                )}
              </td>
              <td style={{ padding: '3pt 0', fontFamily: 'IBM Plex Mono, monospace', fontSize: '8.5pt' }}>
                {e.version}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: '12pt', fontSize: '8.5pt' }}>
        ระเบียบวิธีทั้งหมด: {entries.length} รายการ
        {previewCount > 0 && <> · ระหว่างทดลองใช้: {previewCount}</>}
        &nbsp;·&nbsp;
        Documented at <code>docs/methodologies/</code>
        &nbsp;·&nbsp;
        Source-of-truth: <code>packages/db/src/methodology-bundle.ts</code>
      </p>
    </section>
  );
}
