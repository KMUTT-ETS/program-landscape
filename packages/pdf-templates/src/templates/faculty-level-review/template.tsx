import type { TemplateDefinition } from '@kku/shared';
import { Cover } from '../../components/cover';
import { Section } from '../../components/section';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { FacultyLevelReviewDataSchema, type FacultyLevelReviewData } from './schema';

const VERSION = '0.1.0';

function FacultyLevelReviewDoc({ data }: { data: FacultyLevelReviewData }) {
  return (
    <>
      <Cover
        titleTh={`รายงานระดับคณะ · ${data.facultyNameTh}`}
        scope={data.facultyNameEn}
        dateLabel={data.dateLabel}
        author={data.author}
      />

      <Section title="สรุป">
        <p style={{ whiteSpace: 'pre-line' }}>{data.summaryTh}</p>
      </Section>

      <Section title="ภาพรวมหลักสูตร">
        <table>
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อ</th>
              <th>ระดับ</th>
              <th className="numeric">คะแนนสุขภาพ</th>
              <th className="numeric">ความครบถ้วน</th>
              <th className="numeric">บัณฑิต</th>
              <th className="numeric">สัญญาณ</th>
            </tr>
          </thead>
          <tbody>
            {data.programSnapshot.map((p) => (
              <tr key={p.code}>
                <td>{p.code}</td>
                <td>{p.nameTh}</td>
                <td>{p.level}</td>
                <td className="numeric">{p.healthScore?.toFixed(0) ?? '—'}</td>
                <td className="numeric">{p.dataCompletenessPct != null ? `${p.dataCompletenessPct.toFixed(0)}%` : '—'}</td>
                <td className="numeric">{p.latestGraduates ?? '—'}</td>
                <td className="numeric">{p.trendCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {data.trendHighlights.length > 0 ? (
        <Section title="แนวโน้มสำคัญที่ส่งผลต่อคณะ">
          <ul>
            {data.trendHighlights.map((t, i) => (
              <li key={i} style={{ marginBottom: '6pt' }}>
                <strong>[{t.signalType}]</strong> {t.title}
                <div className="muted" style={{ fontSize: '11pt' }}>
                  {t.summaryTh} · ผลกระทบ {(t.impactScore * 100).toFixed(0)}%
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {data.risksTh.length > 0 ? (
        <Section title="ความเสี่ยง">
          <ul>{data.risksTh.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Section>
      ) : null}

      {data.opportunitiesTh.length > 0 ? (
        <Section title="โอกาส">
          <ul>{data.opportunitiesTh.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </Section>
      ) : null}

      {data.recommendedActionsTh.length > 0 ? (
        <Section title="การดำเนินการที่แนะนำ">
          <ol>
            {data.recommendedActionsTh.map((a, i) => (
              <li key={i} style={{ marginBottom: '4pt' }}>
                {a}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {data.caveats.length > 0 ? (
        <Section title="ข้อจำกัด" breakBefore>
          <ul>{data.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </Section>
      ) : null}
    </>
  );
}

export const facultyLevelReviewTemplate: TemplateDefinition<FacultyLevelReviewData> = {
  name: 'faculty-level-review',
  version: VERSION,
  schema: FacultyLevelReviewDataSchema,
  render(data) {
    return {
      html: renderTemplateToHtml(<FacultyLevelReviewDoc data={data} />),
      css: baseCss,
      footerHtml: buildFooterHtml({ leftLabel: `KKU · ${data.facultyNameEn} · Faculty Review · ${data.dateLabel}` }),
    };
  },
};
