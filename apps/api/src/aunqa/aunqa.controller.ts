import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import {
  AuthSession,
  Authorized,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  assertProgramAccessible,
  clampFacultyNameFilter,
} from '../common';
import {
  AunqaService,
  type AunqaFacultyOverview,
  type AunqaProgramAnalysis,
} from './aunqa.service';

// Teaching & Learning (AUN-QA v4) — evidence completeness per programme.
//
// Neither route produces an AUN-QA 1-7 rating, and nothing here may be
// captioned as one: the bands describe how much evidence THIS PLATFORM
// holds, not how good the programme is. See the header of
// `packages/db/src/aunqa-readiness.ts`.

// Express gives a query param that appears once as a string and twice or
// more as string[]; both normalise to string[] at the schema layer, as
// the education dashboards do.
const StringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): string[] => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return v.filter((x) => x.length > 0);
    return v.length > 0 ? [v] : [];
  });

const OverviewQuerySchema = z.object({ facultyName: StringArray });
type OverviewQuery = z.infer<typeof OverviewQuerySchema>;

@Controller('/aunqa')
export class AunqaController {
  constructor(private readonly aunqa: AunqaService) {}

  @Get('program/:programId')
  @Authorized('institution:read:dashboard')
  async program(
    @AuthSession() user: SessionUser,
    @Param('programId') programId: string,
  ): Promise<AunqaProgramAnalysis> {
    // Per-programme gate, exactly as the deep-dive uses it: 404 for an
    // unknown programme, 403 for one outside the caller's scopes.
    await assertProgramAccessible(programId, user);
    return this.aunqa.programAnalysis(programId);
  }

  @Get('faculty-overview')
  @Authorized('institution:read:dashboard')
  async facultyOverview(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(OverviewQuerySchema)) q: OverviewQuery,
  ): Promise<AunqaFacultyOverview> {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    // `null` means the account has NO faculty grant at all. The sentinel
    // matches no faculty, so the caller gets an empty table. Passing `q`
    // through unclamped here would serve every programme in the
    // university to exactly the user who is entitled to none.
    if (clamped === null) {
      return this.aunqa.facultyOverview({ ...q, facultyName: ['__none__'] });
    }
    return this.aunqa.facultyOverview(clamped);
  }
}
