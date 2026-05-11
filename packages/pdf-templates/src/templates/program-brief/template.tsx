import type { TemplateDefinition } from '@kku/shared';

import { Section } from '../../components/section';
import { MethodologyAppendix, formatMethodologyStamp } from '../../components/methodology-appendix';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { ProgramBriefDataSchema, type ProgramBriefData } from './schema';

const VERSION = '0.1.0';

const LEVEL_LABEL: Record<ProgramBriefData['level'], string> = {
  BACHELOR: 'ปริญญาตรี',
  MASTER: 'ปริญญาโท',
  DOCTORAL: 'ปริญญาเอก',
  HIGHER_GRAD_DIPLOMA: 'ประกาศนียบัตรบัณฑิตชั้นสูง',
};

function ProgramBriefDoc({ data }: { data: ProgramBriefData }) {
  const stamp = data.methodologyBundle ? formatMethodologyStamp(data.methodologyBundle) : null;
  return (
    <>
      <Section title={data.programNameTh} subtitle={`${data.programNameEn} · ${data.programCode} · ${LEVEL_LABEL[data.level]}`}>
        <p className="muted">
          {data.facultyNameTh}
          {data.departmentNameTh ? ` · ${data.departmentNameTh}` : ''} · ข้อมูล ณ {data.dateLabel}
          {stamp && (
            <>
              {' · '}
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.9em' }}>{stamp}</span>
            </>
          )}
        </p>
        <p>{data.summary}</p>
      </Section>

      <Section title="ตัวชี้วัดหลัก">
        <table>
          <thead>
            <tr>
              <th>ตัวชี้วัด</th>
              <th className="numeric">ค่า</th>
              <th className="numeric">เปลี่ยนแปลง</th>
            </tr>
          </thead>
          <tbody>
            {data.keyMetrics.map((m, i) => (
              <tr key={i}>
                <td>{m.label}</td>
                <td className="numeric">{m.value}</td>
                <td className={`numeric ${m.sentiment === 'negative' ? 'danger' : m.sentiment === 'positive' ? 'success' : ''}`}>
                  {m.delta ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {data.risks.length > 0 && (
        <Section title="ความเสี่ยง">
          <ul>{data.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Section>
      )}

      {data.recommendations.length > 0 && (
        <Section title="ข้อเสนอแนะ">
          <ul>{data.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Section>
      )}

      {data.sources.length > 0 && (
        <Section title="แหล่งข้อมูล">
          <ul>
            {data.sources.map((s) => (
              <li key={s.id}>
                {s.label}
                {s.freshnessDate && <span className="muted"> · ณ {s.freshnessDate}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {data.methodologyBundle && <MethodologyAppendix bundle={data.methodologyBundle} />}
    </>
  );
}

export const programBriefTemplate: TemplateDefinition<ProgramBriefData> = {
  name: 'program-brief',
  version: VERSION,
  schema: ProgramBriefDataSchema,
  render(data) {
    const stamp = data.methodologyBundle ? formatMethodologyStamp(data.methodologyBundle) : null;
    const footerLeft = stamp
      ? `KKU Curriculum Intelligence · ${data.programNameTh} · ${stamp}`
      : `KKU Curriculum Intelligence · Program Landscape · ${data.programNameTh}`;
    return {
      html: renderTemplateToHtml(<ProgramBriefDoc data={data} />),
      css: baseCss,
      footerHtml: buildFooterHtml({
        leftLabel: footerLeft,
      }),
    };
  },
};
