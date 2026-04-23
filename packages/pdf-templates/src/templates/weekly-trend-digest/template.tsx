import type { TemplateDefinition } from '@kku/shared';

import { Section } from '../../components/section';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { WeeklyTrendDigestDataSchema, type WeeklyTrendDigestData } from './schema';

const VERSION = '0.1.0';

const SIGNAL_LABEL: Record<WeeklyTrendDigestData['signals'][number]['signalType'], string> = {
  POLICY: 'นโยบาย',
  RESEARCH: 'งานวิจัย',
  MARKET: 'ตลาด',
  TECH: 'เทคโนโลยี',
  NEWS: 'ข่าวสาร',
};

function WeeklyTrendDigestDoc({ data }: { data: WeeklyTrendDigestData }) {
  return (
    <>
      <Section title={`สรุปสัญญาณแวดล้อม · ${data.weekLabel}`}>
        <p className="muted">ข้อมูล ณ {data.dateLabel}</p>
        <p>{data.overview}</p>
      </Section>
      {data.signals.map((s) => (
        <Section key={s.id} title={s.titleTh}>
          <p className="muted">
            <span className="badge">{SIGNAL_LABEL[s.signalType]}</span> · {s.source}
          </p>
          <p>{s.summary}</p>
          {s.implicationForKku && (
            <p><strong>นัยต่อ มข.:</strong> {s.implicationForKku}</p>
          )}
        </Section>
      ))}
    </>
  );
}

export const weeklyTrendDigestTemplate: TemplateDefinition<WeeklyTrendDigestData> = {
  name: 'weekly-trend-digest',
  version: VERSION,
  schema: WeeklyTrendDigestDataSchema,
  render(data) {
    return {
      html: renderTemplateToHtml(<WeeklyTrendDigestDoc data={data} />),
      css: baseCss,
      footerHtml: buildFooterHtml({ leftLabel: `KKU · Trends Radar · ${data.weekLabel}` }),
    };
  },
};
