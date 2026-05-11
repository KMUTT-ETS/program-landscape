import type { TemplateDefinition } from '@kku/shared';
import { Cover } from '../../components/cover';
import { Section } from '../../components/section';
import { MethodologyAppendix, formatMethodologyStamp } from '../../components/methodology-appendix';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { AnnualStrategicReviewDataSchema, type AnnualStrategicReviewData } from './schema';

const VERSION = '0.1.0';

function AnnualStrategicReviewDoc({ data }: { data: AnnualStrategicReviewData }) {
  const stamp = data.methodologyBundle ? formatMethodologyStamp(data.methodologyBundle) : undefined;
  return (
    <>
      <Cover titleTh={`การทบทวนเชิงกลยุทธ์ประจำปี · ${data.yearLabel}`} dateLabel={data.dateLabel} author={data.author} version={stamp} />

      <Section title="บทสรุปผู้บริหาร">
        <p style={{ whiteSpace: 'pre-line' }}>{data.executiveSummaryTh}</p>
      </Section>

      {data.sectorAlignment.length > 0 ? (
        <Section title="ความสอดคล้องกับภาค BCG / S-curve">
          <table>
            <thead>
              <tr>
                <th>Sector</th>
                <th>ตระกูล</th>
                <th className="numeric">อุปสงค์</th>
                <th className="numeric">อุปทาน</th>
                <th className="numeric">ช่องว่าง</th>
              </tr>
            </thead>
            <tbody>
              {data.sectorAlignment.map((s) => (
                <tr key={s.sectorCode}>
                  <td>{s.nameTh}</td>
                  <td>{s.family}</td>
                  <td className="numeric">{s.demandIndex.toFixed(1)}</td>
                  <td className="numeric">{s.supplyIndex.toFixed(1)}</td>
                  <td className="numeric">{s.gap.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.sectorAlignment.map((s) => (
            <div key={`narrative-${s.sectorCode}`} style={{ marginTop: '8pt' }}>
              <h3 style={{ fontSize: '13pt', margin: '6pt 0 2pt 0' }}>{s.nameTh}</h3>
              <p className="muted" style={{ whiteSpace: 'pre-line' }}>
                {s.narrativeTh}
              </p>
            </div>
          ))}
        </Section>
      ) : null}

      {data.majorDecisions.length > 0 ? (
        <Section title="การตัดสินใจสำคัญประจำปี" breakBefore>
          <table>
            <thead>
              <tr>
                <th>เรื่อง</th>
                <th>ประเภท</th>
                <th>สถานะ</th>
                <th>มีผลวันที่</th>
                <th>เลขที่ประชุม</th>
              </tr>
            </thead>
            <tbody>
              {data.majorDecisions.map((d, i) => (
                <tr key={i}>
                  <td>{d.title}</td>
                  <td>{d.decisionType}</td>
                  <td>{d.status}</td>
                  <td>{d.effectiveDate ?? '—'}</td>
                  <td>{d.councilSessionRef ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {data.outcomeReviews.length > 0 ? (
        <Section title="การประเมินผลภายหลัง (Outcome Reviews)" breakBefore>
          {data.outcomeReviews.map((r, i) => (
            <div key={i} style={{ marginBottom: '12pt' }}>
              <h3 style={{ fontSize: '13pt', margin: '0 0 4pt 0' }}>
                {r.decisionTitle} ({r.horizon})
              </h3>
              <p style={{ whiteSpace: 'pre-line' }}>{r.narrativeTh}</p>
              {r.whatWorkedTh.length > 0 ? (
                <>
                  <strong style={{ fontSize: '11pt' }}>สิ่งที่ได้ผล</strong>
                  <ul>{r.whatWorkedTh.map((x, j) => <li key={j}>{x}</li>)}</ul>
                </>
              ) : null}
              {r.whatDidntWorkTh.length > 0 ? (
                <>
                  <strong style={{ fontSize: '11pt' }}>สิ่งที่ไม่ได้ผล</strong>
                  <ul>{r.whatDidntWorkTh.map((x, j) => <li key={j}>{x}</li>)}</ul>
                </>
              ) : null}
              {r.lessonsTh.length > 0 ? (
                <>
                  <strong style={{ fontSize: '11pt' }}>บทเรียน</strong>
                  <ul>{r.lessonsTh.map((x, j) => <li key={j}>{x}</li>)}</ul>
                </>
              ) : null}
            </div>
          ))}
        </Section>
      ) : null}

      {data.forwardPrioritiesTh.length > 0 ? (
        <Section title="ลำดับความสำคัญสำหรับปีถัดไป">
          <ol>
            {data.forwardPrioritiesTh.map((p, i) => (
              <li key={i} style={{ marginBottom: '4pt' }}>
                {p}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {data.caveats.length > 0 ? (
        <Section title="ข้อจำกัดและหมายเหตุ">
          <ul>{data.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </Section>
      ) : null}
      {data.methodologyBundle && <MethodologyAppendix bundle={data.methodologyBundle} />}
    </>
  );
}

export const annualStrategicReviewTemplate: TemplateDefinition<AnnualStrategicReviewData> = {
  name: 'annual-strategic-review',
  version: VERSION,
  schema: AnnualStrategicReviewDataSchema,
  render(data) {
    const stamp = data.methodologyBundle ? formatMethodologyStamp(data.methodologyBundle) : null;
    const footerLeft = stamp
      ? `KKU · Annual Strategic Review · ${data.yearLabel} · ${stamp}`
      : `KKU · Annual Strategic Review · ${data.yearLabel}`;
    return {
      html: renderTemplateToHtml(<AnnualStrategicReviewDoc data={data} />),
      css: baseCss,
      footerHtml: buildFooterHtml({ leftLabel: footerLeft }),
    };
  },
};
