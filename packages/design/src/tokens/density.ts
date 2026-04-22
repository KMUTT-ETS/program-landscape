// Density tokens. User-selectable; the choice is persisted per-user
// (User.themePreference carries the theme; density lands on a sibling
// User column in prompt 13 — for now it's a session-only setting).

export const DENSITY_MODES = ['compact', 'comfortable', 'spacious'] as const;
export type Density = (typeof DENSITY_MODES)[number];

export const densityTokens = {
  cellPx: 'var(--density-cell-px)',
  cellPy: 'var(--density-cell-py)',
  rowH: 'var(--density-row-h)',
  gap: 'var(--density-gap)',
  fontStep: 'var(--density-font-step)',
} as const;
