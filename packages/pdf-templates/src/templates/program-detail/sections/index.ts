import * as React from 'react';

import type { ProgramDetailData } from '../schema';
import { renderAiReadinessSection } from './ai-readiness';
import { renderCohortDistributionSection } from './cohort-distribution';
import { renderCoursesSection } from './courses';
import { renderCurriculumRevisionSection } from './curriculum-revision';
import { renderDecisionsSection } from './decisions';
import { renderDemandFunnelSection } from './demand-funnel';
import { renderDemographicOutlookSection } from './demographic-outlook';
import { renderDigitalCompetencySection } from './digital-competency';
import { renderFacultySection } from './faculty';
import { renderFinancialsSection } from './financials';
import { renderHealthScoreSection } from './health-score';
import { renderLifecycleSection } from './lifecycle';
import { renderOutcomesSection } from './outcomes';
import { renderPeersSection } from './peers';
import { renderRecruitmentSection } from './recruitment';
import { renderResearchExpertiseSection } from './research-expertise';
import { renderSkillsSection } from './skills';
import { renderStrategicNarrativeSection } from './strategic-narrative';
import { renderTcasSection } from './tcas';
import { renderTrendsSection } from './trends';

export interface NumberedSection {
  id: string;
  /**
   * True for the 11 sections whose body is chart-led (a chart carries the
   * interpretive load; the exact figures move to the back-matter
   * appendix). False for the 2 prose sections and the 5 reference-table
   * sections (course list, trend exposure, council decisions, peer
   * institutions, research expertise) — those already show every figure in
   * the body, so they contribute nothing to the appendix (see
   * appendix.tsx).
   */
  chartLed: boolean;
  render(data: ProgramDetailData): React.ReactElement | null;
}

// Single source of truth for the deep-dive's numbered section sequence —
// every section here (cover excluded; it has no `.section-opener` and is
// never numbered) renders inside the shared `.program-body` counter scope
// in this exact order. Both `template.tsx` (body assembly, Task 7) and
// `appendix.tsx` (back-matter index computation, Task 6) import this same
// array so the two can never drift out of sync — a reordered or newly
// null-returning section renumbers both the body's §NN and the appendix's
// B.NN cross-references automatically, because both derive the same
// running index from the same call to the same `render()` function.
export const SECTIONS: NumberedSection[] = [
  { id: 'health-score', chartLed: true, render: renderHealthScoreSection },
  { id: 'lifecycle', chartLed: false, render: renderLifecycleSection },
  { id: 'strategic-narrative', chartLed: false, render: renderStrategicNarrativeSection },
  { id: 'ai-readiness', chartLed: true, render: renderAiReadinessSection },
  { id: 'demand-funnel', chartLed: true, render: renderDemandFunnelSection },
  { id: 'recruitment', chartLed: true, render: renderRecruitmentSection },
  { id: 'tcas', chartLed: true, render: renderTcasSection },
  { id: 'cohort-distribution', chartLed: true, render: renderCohortDistributionSection },
  { id: 'demographic-outlook', chartLed: true, render: renderDemographicOutlookSection },
  { id: 'outcomes', chartLed: true, render: renderOutcomesSection },
  // Immediately after outcomes: on the deep-dive page digital competency
  // is a sub-block of Outcomes, and the report follows the page's order
  // so a reader can move between the two without re-orienting.
  { id: 'digital-competency', chartLed: true, render: renderDigitalCompetencySection },
  { id: 'skills', chartLed: true, render: renderSkillsSection },
  { id: 'courses', chartLed: false, render: renderCoursesSection },
  { id: 'faculty', chartLed: true, render: renderFacultySection },
  { id: 'financials', chartLed: true, render: renderFinancialsSection },
  { id: 'peers', chartLed: false, render: renderPeersSection },
  // After peers (both are "how does this program compare externally"
  // reference tables) and before trends (a forward-looking radar, whereas
  // this section is retrospective — grounded in the roster's last 10
  // years of actual publications).
  { id: 'research-expertise', chartLed: false, render: renderResearchExpertiseSection },
  // Straight after research expertise, as on the deep-dive page: this
  // advice is derived from what that same roster publishes, so it reads
  // as a conclusion drawn from the section above rather than a new topic.
  { id: 'curriculum-revision', chartLed: false, render: renderCurriculumRevisionSection },
  { id: 'trends', chartLed: false, render: renderTrendsSection },
  { id: 'decisions', chartLed: false, render: renderDecisionsSection },
];
