import { PROGRAM_OVERLAP_VERSION } from '@kku/db';
import type { ApiMeta } from '@kku/shared';

// program-overlap.v1 provenance, shared by the Education dashboard endpoints
// and the Deep-Dive section so the drawer reads the same everywhere.
// methodologyVersion comes from the constant, never a literal.
export const PROGRAM_OVERLAP_PROVENANCE: Partial<ApiMeta> = {
  sources: [
    { id: 'program-overlap', name: `Programme overlap (${PROGRAM_OVERLAP_VERSION})` },
    { id: 'program-courses-extract', name: 'Curriculum course extraction' },
    { id: 'program-skills-detailed', name: 'PLO extraction' },
  ],
  methodologyVersion: PROGRAM_OVERLAP_VERSION,
  caveats: [
    'Curriculum overlap is not market cannibalisation: two programmes can share courses and still recruit different students.',
    'Course descriptions are capped at 80 courses per programme; courses beyond the cap are matched on their names only.',
    'Every action is a prompt for review by the faculty and Council, not a decision.',
  ],
};
