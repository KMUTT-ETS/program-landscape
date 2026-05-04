// Shape-only types shared between page.tsx (server) and client.tsx.
// Keeping them out of page.tsx so the client can import without
// picking up `dynamic = 'force-dynamic'` and other server-only flags.

export interface CockpitKpis {
  programCount: number;
  enrolledTotal: number | null;
  netContributionTotal: number | null;
  dangerZoneCount: number;
  qualityConcernCount: number;
  /** Zero-enrolment + crashing (3-yr delta ≤-50%) at this scope. */
  atRiskCount: number;
  /** 3-yr delta ≥+50% at this scope. */
  surgingCount: number;
  /** Programs at this scope that have a 3-yr enrolment trend (denominator). */
  programsWithTrend: number;
  /** Average data-completeness across the heatmap rows at this scope, 0-100. */
  dataCompletenessPct: number | null;
  averageCurriculumAgeYears: number | null;
  methodologyVersion: string;
  latestFreshness: string | null;
}

export interface HealthScoreCell {
  score: number | null;
  dataCompletenessPct: number;
  drivers: Array<{ label: string; value: number | null; raw: unknown }>;
}

export interface HealthScoreRow {
  scope: string;
  scopeId: string;
  scopeLabel: string;
  parentScopeId: string | null;
  methodologyVersion: string;
  dimensions: {
    attractiveness: HealthScoreCell;
    financial: HealthScoreCell;
    capability: HealthScoreCell;
    outcomes: HealthScoreCell;
    relevance: HealthScoreCell;
  };
  overall: HealthScoreCell;
  latestFreshness: string | null;
}

export interface CockpitHeatmap {
  methodologyVersion: string;
  rows: HealthScoreRow[];
}

export interface MatrixBubble {
  id: string;
  label: string;
  level: string;
  x: number;
  y: number;
  size: number;
  color: number;
  dataCompletenessPct: number;
}

export interface CockpitMatrix {
  methodologyVersion: string;
  axisX: { label: string; minLabel: string; maxLabel: string };
  axisY: { label: string; minLabel: string; maxLabel: string };
  sizeLabel: string;
  colorLabel: string;
  bubbles: MatrixBubble[];
}

export interface RollupNode extends HealthScoreRow {
  enrolledTotal: number | null;
  netContributionTotal: number | null;
  programCount: number;
}

export interface CockpitRollup {
  methodologyVersion: string;
  nodes: RollupNode[];
}

export interface SavedView {
  id: string;
  name: string;
  viewMode: 'heatmap' | 'matrix' | 'rollup';
  scope: string;
  scopeId: string | null;
  filtersJson: Record<string, unknown>;
  lastUsedAt: string;
}
