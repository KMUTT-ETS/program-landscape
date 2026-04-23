import type { TemplateDefinition } from '@kku/shared';
import { Cover } from '../../components/cover';
import { Section } from '../../components/section';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { QuarterlyReviewDataSchema, type QuarterlyReviewData } from './schema';

const VERSION = '0.1.0';

function QuarterlyReviewDoc({ data }: { data: QuarterlyReviewData }) {
  return (
    <>
      <Cover titleTh={`การทบทวนรายไตรมาส · ${data.quarterLabel}`} dateLabel={data.dateLabel} author={data.author} />

      <Section title="ตัวเลขสำคัญ (Headline Metrics)">
        <div style={{ display: 'flex', gap: '12pt', flexWrap: 'wrap', marginTop: '6pt' }}>
          {data.headlineMetrics.map((m, i) => (
            <div
              key={i}
              style={{
                flex: '1 1 140pt',
                minWidth: '140pt',
                padding: '10pt',
                border: '1pt solid #ccc',
                borderRadius: '4pt',
              }}
            >
              <div className="muted" style={{ fontSize: '11pt' }}>
                {m.labelTh}
              </div>
              <div style={{ fontSize: '20pt', fontWeight: 600, marginTop: '2pt' }}>{m.value}</div>
              {m.changeFromLastQuarter ? (
                <div className="muted" style={{ fontSize: '10pt' }}>
                  {m.changeFromLastQuarter}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      <Section title="ภาพรวมพอร์ตหลักสูตร">
        <p style={{ whiteSpace: 'pre-line' }}>{data.portfolioSummary.narrativeTh}</p>
      </Section>

      {data.portfolioSummary.programsAtRisk.length > 0 ? (
        <Section title="หลักสูตรที่มีความเสี่ยง (Programs at Risk)">
          <table>
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ชื่อ</th>
                <th className="numeric">คะแนนรวม</th>
                <th>เหตุผล</th>
              </tr>
            </thead>
            <tbody>
              {data.portfolioSummary.programsAtRisk.map((p, i) => (
                <tr key={i}>
                  <td>{p.code}</td>
                  <td>{p.nameTh}</td>
                  <td className="numeric">{p.overallScore?.toFixed(0) ?? '—'}</td>
                  <td>{p.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {data.portfolioSummary.programsStrong.length > 0 ? (
        <Section title="หลักสูตรที่โดดเด่น (Strong Performers)">
          <table>
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ชื่อ</th>
                <th className="numeric">คะแนนรวม</th>
                <th>จุดเด่น</th>
              </tr>
            </thead>
            <tbody>
              {data.portfolioSummary.programsStrong.map((p, i) => (
                <tr key={i}>
                  <td>{p.code}</td>
                  <td>{p.nameTh}</td>
                  <td className="numeric">{p.overallScore?.toFixed(0) ?? '—'}</td>
                  <td>{p.highlight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {data.trendsDigest.length > 0 ? (
        <Section title="แนวโน้มสำคัญ (Trend Digest)" breakBefore>
          <ul>
            {data.trendsDigest.map((t, i) => (
              <li key={i} style={{ marginBottom: '6pt' }}>
                <strong>[{t.signalType}]</strong> {t.title}
                <div className="muted" style={{ fontSize: '11pt' }}>
                  {t.summaryTh} · ผลกระทบ {(t.impactScore * 100).toFixed(0)}% · {t.detectedDate}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {data.scenarioPipeline.length > 0 ? (
        <Section title="Pipeline สถานการณ์จำลอง (Scenario Pipeline)">
          <table>
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>ประเภท</th>
                <th>สถานะ</th>
                <th className="numeric">โปรแกรม</th>
              </tr>
            </thead>
            <tbody>
              {data.scenarioPipeline.map((s, i) => (
                <tr key={i}>
                  <td>{s.name}</td>
                  <td>{s.type}</td>
                  <td>{s.workflowStatus}</td>
                  <td className="numeric">{s.affectedProgramsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {data.decisionPipeline.length > 0 ? (
        <Section title="Pipeline การตัดสินใจของสภา (Council Decision Pipeline)">
          <table>
            <thead>
              <tr>
                <th>เรื่อง</th>
                <th>ประเภท</th>
                <th>สถานะ</th>
                <th>มีผลวันที่</th>
              </tr>
            </thead>
            <tbody>
              {data.decisionPipeline.map((d, i) => (
                <tr key={i}>
                  <td>{d.title}</td>
                  <td>{d.decisionType}</td>
                  <td>{d.status}</td>
                  <td>{d.effectiveDate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {data.caveats.length > 0 ? (
        <Section title="ข้อจำกัดและหมายเหตุ" breakBefore>
          <ul>
            {data.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

export const quarterlyReviewTemplate: TemplateDefinition<QuarterlyReviewData> = {
  name: 'quarterly-review',
  version: VERSION,
  schema: QuarterlyReviewDataSchema,
  render(data) {
    return {
      html: renderTemplateToHtml(<QuarterlyReviewDoc data={data} />),
      css: baseCss,
      footerHtml: buildFooterHtml({ leftLabel: `KKU · Quarterly Review · ${data.quarterLabel}` }),
    };
  },
};
