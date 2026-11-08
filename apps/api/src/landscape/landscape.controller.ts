// apps/api/src/landscape/landscape.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { HEALTH_SCORE_VERSION, LANDSCAPE_ATLAS_VERSION, resolveAtlasScope, type AtlasScope } from '@kku/db';
import type { ApiMeta, SessionUser } from '@kku/shared';
import { AuthSession, Authorized, Provenance, ZodValidationPipe, clampScopeForUser } from '../common';
import { LandscapeService } from './landscape.service';

export const ScopeQuery = z.object({
  scope: z.enum(['university', 'faculty', 'department', 'program']).default('university'),
  scopeId: z.string().min(1).optional(),
});
type ScopeQueryT = z.infer<typeof ScopeQuery>;

const src = (id: string, name: string) => ({ id, name });
const ENROLMENT = src('student_cohort_distributions', 'Registrar · currently active students');
const HEALTH = src('health_score', `Health score (${HEALTH_SCORE_VERSION})`);

const ATLAS_CAVEATS = [
  'Charts list what they cannot place, with the reason; a missing value is never drawn as 0.',
  'Answer lines are computed from the data by fixed rules; no AI wrote them.',
];

@Controller('/landscape')
export class LandscapeController {
  constructor(private readonly landscape: LandscapeService) {}

  private async scope(q: ScopeQueryT, user: SessionUser): Promise<AtlasScope> {
    const eff = await clampScopeForUser(q.scope, q.scopeId ?? null, user);
    return resolveAtlasScope(eff.scope, eff.scopeId);
  }

  private envelope<T extends { computedAt: string }>(data: T, scope: AtlasScope): { data: T; meta: Partial<ApiMeta> } {
    return { data, meta: { freshnessDate: data.computedAt, scope: { level: scope.level, id: scope.id } } };
  }

  @Get('shape')
  @Authorized('programs:read:all')
  @Provenance({ sources: [ENROLMENT, HEALTH], methodologyVersion: LANDSCAPE_ATLAS_VERSION, caveats: ATLAS_CAVEATS })
  async shape(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(ScopeQuery)) q: ScopeQueryT) {
    const s = await this.scope(q, user);
    return this.envelope(await this.landscape.shape(s), s);
  }

  @Get('position')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      src('tcas_admission_stats', 'TCAS admission statistics (applications and seats)'),
      src('enrollment_metrics', 'Registrar · enrolment by year'),
      src('financial_metrics', 'Finance · net contribution'),
      src('risk_assessments', 'Risk Management · 5×5 matrix'),
      ENROLMENT,
      HEALTH,
    ],
    methodologyVersion: LANDSCAPE_ATLAS_VERSION,
    caveats: [
      ...ATLAS_CAVEATS,
      'Bachelor programmes only: TCAS and the risk register cover bachelor programmes.',
      'TCAS round 3 only (part of admissions, not all of it); each course code is counted once per entry year.',
    ],
  })
  async position(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(ScopeQuery)) q: ScopeQueryT) {
    const s = await this.scope(q, user);
    return this.envelope(await this.landscape.position(s), s);
  }

  @Get('capability')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      src('research_outputs', 'Publications mirror (Scopus, PubMed)'),
      src('research_service_projects', 'Research & academic-service grants'),
      src('faculty_members', 'HR · active teaching staff'),
    ],
    methodologyVersion: LANDSCAPE_ATLAS_VERSION,
    caveats: [
      ...ATLAS_CAVEATS,
      'Grants are a lower bound: about 30% of co-investigator ids match no HR record.',
      'A project counts for every faculty with a member on it, so faculty figures sum to more than the university total.',
    ],
  })
  async capability(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(ScopeQuery)) q: ScopeQueryT) {
    const s = await this.scope(q, user);
    return this.envelope(await this.landscape.capability(s), s);
  }

  @Get('future')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      src('ai_readiness', 'AI readiness (deterministic, per programme)'),
      src('dq', 'Digital intelligence (DQ) assessments'),
      HEALTH,
      src('program_skills', 'Skills extracted from curricula, mapped to national strategic sectors'),
    ],
    methodologyVersion: LANDSCAPE_ATLAS_VERSION,
    caveats: [
      ...ATLAS_CAVEATS,
      'Sector coverage depends on skills extracted from curriculum PDFs; an empty cell means "not mapped", not "no capacity".',
    ],
  })
  async future(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(ScopeQuery)) q: ScopeQueryT) {
    const s = await this.scope(q, user);
    return this.envelope(await this.landscape.future(s), s);
  }
}
