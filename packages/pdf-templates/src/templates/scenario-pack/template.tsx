import type { TemplateDefinition } from '@kku/shared';

import { Cover } from '../../components/cover';
import { Section } from '../../components/section';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { ScenarioPackDataSchema, type ScenarioPackData } from './schema';

const VERSION = '0.1.0';

function ScenarioPackDoc({ data }: { data: ScenarioPackData }) {
  return (
    <>
      <Cover
        titleTh={data.titleTh}
        scope={data.scopeLabel}
        dateLabel={data.dateLabel}
        author={data.author}
      />
      {data.scenarios.map((s) => (
        <Section key={s.id} title={s.nameTh} breakBefore>
          <h3>สมมติฐาน</h3>
          <table>
            <tbody>
              {s.assumptions.map((a, i) => (
                <tr key={i}><td>{a.label}</td><td className="numeric">{a.value}</td></tr>
              ))}
            </tbody>
          </table>
          <h3>ผลการจำลอง</h3>
          <table>
            <thead>
              <tr>
                <th>ตัวชี้วัด</th>
                <th className="numeric">พื้นฐาน</th>
                <th className="numeric">สถานการณ์</th>
                <th className="numeric">เปลี่ยนแปลง</th>
              </tr>
            </thead>
            <tbody>
              {s.projections.map((p, i) => (
                <tr key={i}>
                  <td>{p.label}</td>
                  <td className="numeric">{p.baseline}</td>
                  <td className="numeric">{p.scenario}</td>
                  <td className="numeric">{p.delta ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>คำอธิบาย</h3>
          <p>{s.narrative}</p>
        </Section>
      ))}
      {data.caveats.length > 0 && (
        <Section title="ข้อจำกัด" breakBefore>
          <ul>{data.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </Section>
      )}
    </>
  );
}

export const scenarioPackTemplate: TemplateDefinition<ScenarioPackData> = {
  name: 'scenario-pack',
  version: VERSION,
  schema: ScenarioPackDataSchema,
  render(data) {
    return {
      html: renderTemplateToHtml(<ScenarioPackDoc data={data} />),
      css: baseCss,
      footerHtml: buildFooterHtml({ leftLabel: `KKU Curriculum Intelligence · Program Landscape · ${data.titleTh}` }),
    };
  },
};
