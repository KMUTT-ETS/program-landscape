import type { TemplateDefinition, TemplateRegistry } from '@kku/shared';

import { councilPackTemplate } from './templates/council-pack/template';
import { programBriefTemplate } from './templates/program-brief/template';
import { programDetailTemplate } from './templates/program-detail/template';
import { scenarioPackTemplate } from './templates/scenario-pack/template';
import { weeklyTrendDigestTemplate } from './templates/weekly-trend-digest/template';
import { decisionRecordTemplate } from './templates/decision-record/template';
import { dataQualityReportTemplate } from './templates/data-quality-report/template';
import { gapReportTemplate } from './templates/gap-report/template';
import { quarterlyReviewTemplate } from './templates/quarterly-review/template';
import { annualStrategicReviewTemplate } from './templates/annual-strategic-review/template';
import { facultyLevelReviewTemplate } from './templates/faculty-level-review/template';

// Export the base CSS so callers that build bespoke one-off HTML (rare,
// and only for admin-tooling-style use) can match the rest of the system.
export { baseCss } from './styles/base-css';

// Re-export print-safe chart primitives.
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
export * from './templates/program-detail/schema';
export * from './templates/scenario-pack/schema';
export * from './templates/weekly-trend-digest/schema';
export * from './templates/decision-record/schema';
export * from './templates/data-quality-report/schema';
export * from './templates/gap-report/schema';
export * from './templates/quarterly-review/schema';
export * from './templates/annual-strategic-review/schema';
export * from './templates/faculty-level-review/schema';

// Array view for callers that want to iterate rather than register.
export const allTemplates = [
  councilPackTemplate,
  programBriefTemplate,
  programDetailTemplate,
  scenarioPackTemplate,
  weeklyTrendDigestTemplate,
  decisionRecordTemplate,
  dataQualityReportTemplate,
  gapReportTemplate,
  quarterlyReviewTemplate,
  annualStrategicReviewTemplate,
  facultyLevelReviewTemplate,
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
