import type { TemplateDefinition, TemplateRegistry } from '@kku/shared';

import { councilPackTemplate } from './templates/council-pack/template';
import { programBriefTemplate } from './templates/program-brief/template';
import { scenarioPackTemplate } from './templates/scenario-pack/template';
import { weeklyTrendDigestTemplate } from './templates/weekly-trend-digest/template';
import { decisionRecordTemplate } from './templates/decision-record/template';
import { dataQualityReportTemplate } from './templates/data-quality-report/template';

// Export the base CSS so callers that build bespoke one-off HTML (rare,
// and only for admin-tooling-style use) can match the rest of the system.
export { baseCss } from './styles/base-css';

// Re-export print-safe chart primitives.
export * from './components/chart-for-print';
export * from './components/cover';
export * from './components/section';
export * from './components/provenance-appendix';
export * from './components/footer-template';
export { renderTemplateToHtml } from './render';

// Re-export the typed schemas for each template — calling modules parse
// their inputs against these before invoking the service, so mistakes
// surface at the module boundary instead of inside Gotenberg.
export * from './templates/council-pack/schema';
export * from './templates/program-brief/schema';
export * from './templates/scenario-pack/schema';
export * from './templates/weekly-trend-digest/schema';
export * from './templates/decision-record/schema';
export * from './templates/data-quality-report/schema';

// Array view for callers that want to iterate rather than register.
export const allTemplates = [
  councilPackTemplate,
  programBriefTemplate,
  scenarioPackTemplate,
  weeklyTrendDigestTemplate,
  decisionRecordTemplate,
  dataQualityReportTemplate,
] as const;

// Registers every template shipped by this package into a registry. The
// NestJS PdfModule calls this once at boot. Keeps the "which templates
// exist" list in exactly one place — here.
export function registerBuiltinTemplates(registry: TemplateRegistry): void {
  // Widen to TemplateDefinition<unknown> so the inference over the
  // heterogeneous tuple doesn't try to collapse every template's typed
  // schema into a single generic — each template's schema narrows its
  // own data independently at render time.
  for (const template of allTemplates as readonly TemplateDefinition<unknown>[]) {
    registry.register(template);
  }
}
