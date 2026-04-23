import type { TemplateDefinition } from '@kku/shared';

import { Section } from '../../components/section';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { GapReportDataSchema, type GapReportData } from './schema';

const VERSION = '0.1.0';

function GapReportDoc({ data }: { data: GapReportData }) {
  const scopeLine =
    data.reportKind === 'region'
      ? `ภูมิภาค: ${data.region ?? 'TH'}`
      : data.reportKind === 'sector'
        ? `ภาค Sector: ${data.sectorCode ?? ''}`
        : 'ภาพรวมมหาวิทยาลัย';

  return (
    <>
      <Section title={`รายงานช่องว่างอุปสงค์-อุปทาน · ${data.dateLabel}`}>
        <p className="muted">{scopeLine}</p>
        {data.author ? <p className="muted">จัดทำโดย {data.author}</p> : null}
        {data.headlineMetrics.length > 0 ? (
          <div style={{ display: 'flex', gap: '12pt', marginTop: '8pt', flexWrap: 'wrap' }}>
            {data.headlineMetrics.map((m, i) => (
              <div
                key={i}
                style={{
                  flex: '1 1 auto',
                  minWidth: '120pt',
                  padding: '8pt',
                  border: '1pt solid #ccc',
                  borderRadius: '4pt',
                }}
              >
                <div className="muted" style={{ fontSize: '11pt' }}>
                  {m.labelTh}
                </div>
                <div style={{ fontSize: '18pt', fontWeight: 600, marginTop: '2pt' }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      <Section title="บทวิเคราะห์">
        <p style={{ whiteSpace: 'pre-line' }}>{data.narrativeTh}</p>
        {data.narrativeEn ? (
          <>
            <h3 style={{ marginTop: '10pt', fontSize: '13pt' }}>English</h3>
            <p className="muted" style={{ whiteSpace: 'pre-line' }}>
              {data.narrativeEn}
            </p>
          </>
        ) : null}
      </Section>

      {data.topSkillGaps.length > 0 ? (
        <Section title="ช่องว่างด้านทักษะ — อันดับต้น">
          <table>
            <thead>
              <tr>
                <th>ทักษะ</th>
                <th className="numeric">อุปสงค์</th>
                <th className="numeric">อุปทาน KKU</th>
                <th className="numeric">ช่องว่าง</th>
                <th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {data.topSkillGaps.map((r, i) => (
                <tr key={i}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.nameEn}</div>
                    <div className="muted">{r.nameTh}</div>
                  </td>
                  <td className="numeric">{r.demand.toFixed(1)}</td>
                  <td className="numeric">{r.supply.toFixed(1)}</td>
                  <td className="numeric" style={{ color: r.gap > 0 ? '#b02' : r.gap < 0 ? '#0a6' : undefined }}>
                    {r.gap.toFixed(1)}
                  </td>
                  <td>{r.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {data.topSectors.length > 0 ? (
        <Section title="ภาค Sector — BCG และ S-curve">
          <table>
            <thead>
              <tr>
                <th>Sector</th>
                <th>ตระกูล</th>
                <th className="numeric">อุปสงค์</th>
                <th className="numeric">อุปทาน</th>
                <th className="numeric">ช่องว่าง</th>
                <th>แนวโน้ม</th>
              </tr>
            </thead>
            <tbody>
              {data.topSectors.map((s) => (
                <tr key={s.sectorCode}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{s.nameEn}</div>
                    <div className="muted">{s.nameTh}</div>
                  </td>
                  <td>{s.family}</td>
                  <td className="numeric">{s.demand.toFixed(1)}</td>
                  <td className="numeric">{s.supply.toFixed(1)}</td>
                  <td className="numeric">{s.gap.toFixed(1)}</td>
                  <td>
                    {s.trend === 'growing'
                      ? '▲ เติบโต'
                      : s.trend === 'shrinking'
                        ? '▼ หดตัว'
                        : '— คงที่'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {data.forecastSnapshots.length > 0 ? (
        <Section title="ภาพการพยากรณ์ (80% CI)">
          <table>
            <thead>
              <tr>
                <th>หัวข้อ</th>
                <th>ประเภท</th>
                <th className="numeric">ปีเป้าหมาย</th>
                <th className="numeric">ค่าพยากรณ์</th>
                <th className="numeric">ช่วง CI 80%</th>
              </tr>
            </thead>
            <tbody>
              {data.forecastSnapshots.map((f, i) => (
                <tr key={i}>
                  <td>{f.subjectLabel}</td>
                  <td>{f.kind === 'DEMAND' ? 'อุปสงค์' : 'อุปทาน'}</td>
                  <td className="numeric">{f.targetYear}</td>
                  <td className="numeric">{f.projected.toFixed(1)}</td>
                  <td className="numeric">
                    [{f.ci80Low.toFixed(1)}, {f.ci80High.toFixed(1)}]
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section title="แหล่งข้อมูลและระเบียบวิธี" breakBefore>
        <p>
          <strong>Methodology version:</strong> {data.provenance.methodologyVersion}
        </p>
        <p>
          <strong>Sources:</strong> {data.provenance.sources.join(', ')}
        </p>
        <p>
          <strong>Confidence:</strong> {(data.provenance.confidence * 100).toFixed(0)}%
        </p>
        {data.provenance.caveats.length > 0 ? (
          <>
            <p style={{ marginTop: '6pt' }}>
              <strong>หมายเหตุ / ข้อจำกัด:</strong>
            </p>
            <ul>
              {data.provenance.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </>
        ) : null}
      </Section>
    </>
  );
}

export const gapReportTemplate: TemplateDefinition<GapReportData> = {
  name: 'gap-report',
  version: VERSION,
  schema: GapReportDataSchema,
  render(data) {
    return {
      html: renderTemplateToHtml(<GapReportDoc data={data} />),
      css: baseCss,
      footerHtml: buildFooterHtml({
        leftLabel: `KKU · Gap Report · ${data.scopeLabel} · ${data.dateLabel}`,
      }),
    };
  },
};
