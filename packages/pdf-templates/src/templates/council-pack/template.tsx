import type { TemplateDefinition, TemplateRenderContext } from '@kku/shared';

import { Cover } from '../../components/cover';
import { Section } from '../../components/section';
import { ProvenanceAppendix } from '../../components/provenance-appendix';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { CouncilPackDataSchema, type CouncilPackData } from './schema';

const VERSION = '1.0.0';

function CouncilPackDoc(props: { data: CouncilPackData; ctx: TemplateRenderContext }) {
  const { data } = props;
  return (
    <>
      <Cover
        titleTh={data.titleTh}
        titleEn={data.titleEn}
        scope={data.scopeLabel}
        dateLabel={data.dateLabel}
        author={data.author}
        version={data.version}
        confidentialityLabel={data.confidentialityLabel}
      />

      <Section title="สรุปสำหรับผู้บริหาร">
        {data.executiveSummary.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {data.executiveSummary.keyTakeaways.length > 0 && (
          <>
            <h3>ประเด็นสำคัญ</h3>
            <ul>
              {data.executiveSummary.keyTakeaways.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          </>
        )}
        {typeof data.executiveSummary.confidence === 'number' && (
          <p className="muted">
            ระดับความเชื่อมั่นของการวิเคราะห์: {Math.round(data.executiveSummary.confidence * 100)}%
          </p>
        )}
      </Section>

      {data.sections.map((section, i) => (
        <Section key={i} title={section.title} breakBefore>
          <div dangerouslySetInnerHTML={{ __html: section.html }} />
        </Section>
      ))}

      {data.provenance.length > 0 && (
        <ProvenanceAppendix entries={data.provenance} />
      )}
    </>
  );
}

export const councilPackTemplate: TemplateDefinition<CouncilPackData> = {
  name: 'council-pack',
  version: VERSION,
  schema: CouncilPackDataSchema,
  defaultOptions: {
    paperFormat: 'A4',
    orientation: 'portrait',
    marginsMm: { top: 20, bottom: 20, left: 15, right: 15 },
  },
  render(data, ctx) {
    const bodyHtml = renderTemplateToHtml(<CouncilPackDoc data={data} ctx={ctx} />);
    return {
      html: bodyHtml,
      css: baseCss,
      footerHtml: buildFooterHtml({
        leftLabel: `KKU Curriculum Intelligence · Program Landscape · ${data.titleTh}`,
        rightLabel: data.confidentialityLabel,
      }),
    };
  },
};
