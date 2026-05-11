import type { TemplateDefinition, TemplateRenderContext } from '@kku/shared';

import { Cover } from '../../components/cover';
import { Section } from '../../components/section';
import { ProvenanceAppendix } from '../../components/provenance-appendix';
import { MethodologyAppendix } from '../../components/methodology-appendix';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { CouncilPackDataSchema, type CouncilPackData } from './schema';

const VERSION = '1.0.0';

function CouncilPackDoc(props: { data: CouncilPackData; ctx: TemplateRenderContext }) {
  const { data } = props;
  // Compose the cover-line version: caller-supplied label takes priority,
  // otherwise fall back to the methodology-bundle stamp so the cover never
  // ships without a citable identity. Gap #4 closure: every Council brief
  // carries a single readable string that pins all methodology versions
  // used in its numbers.
  const bundleStamp = data.methodologyBundle
    ? `${data.methodologyBundle.tag}+${data.methodologyBundle.fingerprint}`
    : undefined;
  const coverVersion = data.version ?? bundleStamp;
  return (
    <>
      <Cover
        titleTh={data.titleTh}
        titleEn={data.titleEn}
        scope={data.scopeLabel}
        dateLabel={data.dateLabel}
        author={data.author}
        version={coverVersion}
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
      {data.methodologyBundle && (
        <MethodologyAppendix bundle={data.methodologyBundle} />
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
    const bundleStamp = data.methodologyBundle
      ? `${data.methodologyBundle.tag}+${data.methodologyBundle.fingerprint}`
      : null;
    // Footer carries the bundle stamp on every page so any extracted page
    // (screenshot, photo, scan) retains the methodology-version identity.
    const footerLeft = bundleStamp
      ? `KKU Curriculum Intelligence · ${data.titleTh} · ${bundleStamp}`
      : `KKU Curriculum Intelligence · Program Landscape · ${data.titleTh}`;
    return {
      html: bodyHtml,
      css: baseCss,
      footerHtml: buildFooterHtml({
        leftLabel: footerLeft,
        rightLabel: data.confidentialityLabel,
      }),
    };
  },
};
