// Token-*name* export. The single source of *values* lives in
// packages/design/src/css/tokens.css (OKLCH). Consuming code uses these
// name constants with `oklch(var(...))` or, more usually, through the
// Tailwind preset utilities.

export const colorTokens = {
  surface: {
    0: 'var(--color-surface-0)',
    1: 'var(--color-surface-1)',
    2: 'var(--color-surface-2)',
    3: 'var(--color-surface-3)',
    4: 'var(--color-surface-4)',
  },
  border: {
    subtle: 'var(--color-border-subtle)',
    default: 'var(--color-border-default)',
    strong: 'var(--color-border-strong)',
  },
  text: {
    primary: 'var(--color-text-primary)',
    secondary: 'var(--color-text-secondary)',
    tertiary: 'var(--color-text-tertiary)',
    disabled: 'var(--color-text-disabled)',
    inverse: 'var(--color-text-inverse)',
  },
  accent: {
    default: 'var(--color-accent-default)',
    hover: 'var(--color-accent-hover)',
    active: 'var(--color-accent-active)',
    subtle: 'var(--color-accent-subtle)',
    fg: 'var(--color-accent-fg)',
  },
  semantic: {
    success: 'var(--color-success-default)',
    successSubtle: 'var(--color-success-subtle)',
    warning: 'var(--color-warning-default)',
    warningSubtle: 'var(--color-warning-subtle)',
    danger: 'var(--color-danger-default)',
    dangerSubtle: 'var(--color-danger-subtle)',
    info: 'var(--color-info-default)',
    infoSubtle: 'var(--color-info-subtle)',
  },
  data: {
    positive: 'var(--color-data-positive)',
    negative: 'var(--color-data-negative)',
    neutral: 'var(--color-data-neutral)',
  },
  chart: {
    1: 'var(--color-chart-1)',
    2: 'var(--color-chart-2)',
    3: 'var(--color-chart-3)',
    4: 'var(--color-chart-4)',
    5: 'var(--color-chart-5)',
    6: 'var(--color-chart-6)',
    7: 'var(--color-chart-7)',
    8: 'var(--color-chart-8)',
    9: 'var(--color-chart-9)',
    10: 'var(--color-chart-10)',
    11: 'var(--color-chart-11)',
    12: 'var(--color-chart-12)',
  },
  /* Brand-home / sidebar dark surface — 2026-04-24 redesign */
  nav: {
    surface: 'var(--color-nav-surface)',
    surfaceHover: 'var(--color-nav-surface-hover)',
    fg: 'var(--color-nav-fg)',
    fgMuted: 'var(--color-nav-fg-muted)',
  },
  /* Per-module signature colours — 2026-04-24 redesign */
  module: {
    cockpit: 'var(--color-module-cockpit)',
    cockpitSubtle: 'var(--color-module-cockpit-subtle)',
    programs: 'var(--color-module-programs)',
    programsSubtle: 'var(--color-module-programs-subtle)',
    trends: 'var(--color-module-trends)',
    trendsSubtle: 'var(--color-module-trends-subtle)',
    gap: 'var(--color-module-gap)',
    gapSubtle: 'var(--color-module-gap-subtle)',
    scenarios: 'var(--color-module-scenarios)',
    scenariosSubtle: 'var(--color-module-scenarios-subtle)',
    benchmarking: 'var(--color-module-benchmarking)',
    benchmarkingSubtle: 'var(--color-module-benchmarking-subtle)',
    analyst: 'var(--color-module-analyst)',
    analystSubtle: 'var(--color-module-analyst-subtle)',
    decisions: 'var(--color-module-decisions)',
    decisionsSubtle: 'var(--color-module-decisions-subtle)',
  },
} as const;

/** For Recharts etc. that want a pre-resolved string list. */
export const chartPaletteOrder: Array<keyof typeof colorTokens.chart> = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
];

/** Module keys — used as a discriminator on nav items + page headers. */
export const MODULE_KEYS = [
  'cockpit',
  'programs',
  'trends',
  'gap',
  'scenarios',
  'benchmarking',
  'analyst',
  'decisions',
  'neutral',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
