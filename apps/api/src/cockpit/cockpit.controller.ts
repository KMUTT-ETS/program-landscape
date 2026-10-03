import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { GRANT_AWARD_CAVEAT, HEALTH_SCORE_VERSION, LANDSCAPE_METHODOLOGY_BUNDLE } from '@kku/db';
import { ForbiddenException } from '@nestjs/common';
import { prisma } from '@kku/db';
import { ScopeLevelSchema, type ScopeLevel, type SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
  clampScopeForUser,
  resolveEffectiveScope,
} from '../common';
import { CockpitService } from './cockpit.service';
import { PdfService } from '../pdf/pdf.service';
import { RecruitmentService } from '../education/recruitment.service';

const ScopeQuerySchema = z.object({
  scope: ScopeLevelSchema.default('university'),
  scopeId: z.string().optional(),
});
type ScopeQuery = z.infer<typeof ScopeQuerySchema>;

const BriefBodySchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: z.string().nullable().optional(),
  style: z.enum(['thai-narrative', 'executive-summary', 'full-deep-dive']).default('thai-narrative'),
});
type BriefBody = z.infer<typeof BriefBodySchema>;

const ExportBodySchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: z.string().nullable().optional(),
  titleTh: z.string().default('รายงานภาพรวมหลักสูตร มข.'),
  titleEn: z.string().default('KKU Curriculum Portfolio Overview'),
  includeBrief: z.boolean().default(true),
  briefStyle: z.enum(['thai-narrative', 'executive-summary', 'full-deep-dive']).default('executive-summary'),
});
type ExportBody = z.infer<typeof ExportBodySchema>;

const SaveViewBodySchema = z.object({
  name: z.string().min(1).max(80),
  viewMode: z.enum(['heatmap', 'matrix', 'rollup']),
  scope: ScopeLevelSchema,
  scopeId: z.string().nullable().optional(),
  filters: z.record(z.string(), z.unknown()).default({}),
});
type SaveViewBody = z.infer<typeof SaveViewBodySchema>;

// Scope guard for cockpit reads. Delegates to the shared
// `clampScopeForUser` helper which honours both the primary session
// scope AND UserScope rows (multi-scope). A user whose primary role
// is PROGRAM_USER but who has a UserScope grant of UNIVERSITY_USER
// now sees the full cockpit at any requested scope — same posture
// applied across the risks / education / staff modules.
async function clampCockpitScope(
  scope: ScopeLevel,
  scopeId: string | null,
  user: SessionUser,
): Promise<{ scope: ScopeLevel; scopeId: string | null }> {
  const clamped = await clampScopeForUser(scope, scopeId, user);
  return { scope: clamped.scope as ScopeLevel, scopeId: clamped.scopeId };
}

// Build the list of (scope, scopeId) pairs the cockpit should fetch
// for this user. Single-scope users get [{ scope: requested, scopeId }];
// multi-grant users get one entry per granted faculty/program so the
// service can be fanned out and the rows unioned. A user with grants
// across both axes (e.g. FACULTY_USER F1 + PROGRAM_USER P9 in another
// faculty) gets the union of both.
async function cockpitScopeTargets(
  scope: ScopeLevel,
  scopeId: string | null,
  user: SessionUser,
): Promise<Array<{ scope: ScopeLevel; scopeId: string | null }>> {
  const eff = await resolveEffectiveScope(user);
  if (eff.mode === 'none') {
    throw new ForbiddenException(
      'Your account has no faculty or program assignment. Contact an admin.',
    );
  }
  if (eff.mode === 'all') {
    // Admin / UNIVERSITY tier — honour whatever scope was requested.
    return [{ scope, scopeId }];
  }
  const targets: Array<{ scope: ScopeLevel; scopeId: string | null }> = [];
  for (const fid of eff.facultyIds) targets.push({ scope: 'faculty', scopeId: fid });
  // Drop program grants whose faculty is already covered by a faculty
  // grant — otherwise the program shows twice (once via the faculty
  // target's roll-up, once via its own target). Common pattern: a
  // FACULTY_USER grant for F1 plus an explicit PROGRAM_USER grant for
  // a program inside F1 (admin-redundant but not invalid).
  if (eff.programIds.length > 0 && eff.facultyIds.length > 0) {
    const facultyIdSet = new Set(eff.facultyIds);
    const programs = await prisma.program.findMany({
      where: { id: { in: eff.programIds } },
      select: { id: true, facultyId: true },
    });
    const programFacultyById = new Map(programs.map((p) => [p.id, p.facultyId]));
    for (const pid of eff.programIds) {
      const fid = programFacultyById.get(pid);
      if (fid && facultyIdSet.has(fid)) continue; // covered by faculty target
      targets.push({ scope: 'program', scopeId: pid });
    }
  } else {
    for (const pid of eff.programIds) targets.push({ scope: 'program', scopeId: pid });
  }
  return targets;
}

const HEALTH_SOURCE = {
  id: 'health-score',
  name: `Health score methodology ${HEALTH_SCORE_VERSION}`,
};
const HEALTH_CAVEATS = [
  'Financial includes an external-grant award of up to +10 points (grant baht per teaching staff per year, last 3 complete fiscal years); it never lowers a score.',
  GRANT_AWARD_CAVEAT,
];

@Controller('/cockpit')
export class CockpitController {
  constructor(
    private readonly cockpit: CockpitService,
    private readonly pdf: PdfService,
    private readonly recruitment: RecruitmentService,
  ) {}

  @Get('recruitment')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'kku-admission-campaigns', name: 'KKU Registry · POWERBI.ADMISSION_STAT' },
    ],
    methodologyVersion: 'recruitment-rollup.v2',
  })
  async recruitmentRollup(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ScopeQuerySchema)) q: ScopeQuery,
  ) {
    const eff = await clampCockpitScope(q.scope, q.scopeId ?? null, user);
    // Reuse the RecruitmentService — it already supports a facultyId
    // filter. University scope leaves filters empty; faculty scope
    // narrows to that faculty. Department scope falls through to
    // university (the recruitment data is per-program, not
    // per-department, since CURR_ID maps to programs not departments).
    return this.recruitment.getDashboard({
      facultyId: eff.scope === 'faculty' ? (eff.scopeId ?? null) : null,
    });
  }

  @Get('kpis')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'mv_metrics', name: 'Materialized metric rollups' },
      HEALTH_SOURCE,
    ],
    methodologyVersion: HEALTH_SCORE_VERSION,
    caveats: HEALTH_CAVEATS,
  })
  async kpis(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ScopeQuerySchema)) q: ScopeQuery,
  ) {
    const targets = await cockpitScopeTargets(q.scope, q.scopeId ?? null, user);
    if (targets.length === 1) {
      const t = targets[0]!;
      return this.cockpit.kpis(t.scope, t.scopeId);
    }
    // Multi-grant — fan out + combine. Counts sum; averages weight by
    // programCount per call.
    const results = await Promise.all(targets.map((t) => this.cockpit.kpis(t.scope, t.scopeId)));
    return combineKpis(results);
  }

  @Get('heatmap')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [HEALTH_SOURCE],
    methodologyVersion: HEALTH_SCORE_VERSION,
    caveats: HEALTH_CAVEATS,
  })
  async heatmap(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ScopeQuerySchema)) q: ScopeQuery,
  ) {
    const targets = await cockpitScopeTargets(q.scope, q.scopeId ?? null, user);
    if (targets.length === 1) {
      const t = targets[0]!;
      return this.cockpit.heatmap(t.scope, t.scopeId);
    }
    const results = await Promise.all(targets.map((t) => this.cockpit.heatmap(t.scope, t.scopeId)));
    return {
      methodologyVersion: results[0]!.methodologyVersion,
      rows: results.flatMap((r) => r.rows),
    };
  }

  @Get('matrix')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [HEALTH_SOURCE],
    methodologyVersion: HEALTH_SCORE_VERSION,
    caveats: HEALTH_CAVEATS,
  })
  async matrix(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ScopeQuerySchema)) q: ScopeQuery,
  ) {
    const targets = await cockpitScopeTargets(q.scope, q.scopeId ?? null, user);
    if (targets.length === 1) {
      const t = targets[0]!;
      return this.cockpit.matrix(t.scope, t.scopeId);
    }
    const results = await Promise.all(targets.map((t) => this.cockpit.matrix(t.scope, t.scopeId)));
    return {
      ...results[0]!,
      bubbles: results.flatMap((r) => r.bubbles),
    };
  }

  @Get('rollup')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'mv_metrics', name: 'Materialized metric rollups' },
      HEALTH_SOURCE,
    ],
    methodologyVersion: HEALTH_SCORE_VERSION,
    caveats: HEALTH_CAVEATS,
  })
  async rollup(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ScopeQuerySchema)) q: ScopeQuery,
  ) {
    const targets = await cockpitScopeTargets(q.scope, q.scopeId ?? null, user);
    if (targets.length === 1) {
      const t = targets[0]!;
      return this.cockpit.rollup(t.scope, t.scopeId);
    }
    const results = await Promise.all(targets.map((t) => this.cockpit.rollup(t.scope, t.scopeId)));
    return {
      methodologyVersion: results[0]!.methodologyVersion,
      nodes: results.flatMap((r) => r.nodes),
    };
  }

  @Post('brief')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'cockpit.brief', entityType: 'AiInference' })
  async brief(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(BriefBodySchema)) body: BriefBody,
  ) {
    const eff = await clampCockpitScope(body.scope, body.scopeId ?? null, user);
    return this.cockpit.generateBrief({
      scope: eff.scope,
      scopeId: eff.scopeId,
      style: body.style,
      userId: user.userId,
    });
  }

  @Post('export')
  @Authorized('pdf:generate')
  @AuditLog({ action: 'cockpit.export', entityType: 'PdfGeneration' })
  async export(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(ExportBodySchema)) body: ExportBody,
  ) {
    const eff = await clampCockpitScope(body.scope, body.scopeId ?? null, user);
    // Build the Council Pack body from the cockpit's own data.
    const [kpis, heatmap, brief] = await Promise.all([
      this.cockpit.kpis(eff.scope, eff.scopeId),
      this.cockpit.heatmap(eff.scope, eff.scopeId),
      body.includeBrief
        ? this.cockpit.generateBrief({
            scope: eff.scope,
            scopeId: eff.scopeId,
            style: body.briefStyle,
            userId: user.userId,
          })
        : Promise.resolve(null),
    ]);

    const sections = buildCouncilPackSections({ kpis, heatmap, brief });
    const result = await this.pdf.generateAndPersist(
      {
        templateName: 'council-pack',
        data: {
          titleTh: body.titleTh,
          titleEn: body.titleEn,
          dateLabel: formatThaiDate(new Date()),
          scopeLabel: eff.scope,
          author: user.name ?? user.email,
          executiveSummary: {
            paragraphs: brief?.text
              ? brief.text.split(/\n\n+/).slice(0, 4)
              : [kpis.programCount + ' programs at scope. Health + financial snapshot follows.'],
            keyTakeaways: summariseKeyTakeaways(kpis, heatmap.rows),
            confidence: brief?.confidence,
          },
          // Gap #4 closure: every Council Pack now carries the full
          // methodology bundle (tag + fingerprint + manifest) so any
          // number cited can be traced back to specific sub-versions.
          methodologyBundle: LANDSCAPE_METHODOLOGY_BUNDLE,
          sections,
          provenance: [
            {
              id: 'health-score',
              label: 'Health score methodology',
              source: 'KKU Data Office',
              freshnessDate: formatThaiDate(new Date()),
              methodologyVersion: HEALTH_SCORE_VERSION,
              // The Council Pack provenance schema has no `caveats`; zod
              // strips unknown keys, so the caveats ride in `note`.
              note: HEALTH_CAVEATS.join(' '),
            },
            {
              id: 'mv-metrics',
              label: 'Metric rollups (enrollment / financial / outcomes)',
              source: 'Prisma materialized views mv_*_metrics',
              freshnessDate: kpis.latestFreshness
                ? formatThaiDate(new Date(kpis.latestFreshness))
                : '—',
            },
          ],
        },
        scope: { level: eff.scope, id: eff.scopeId },
      },
      user.userId,
    );

    return {
      pdfUrl: result.signedUrl,
      expiresAt: result.signedUrlExpiresAt?.toISOString(),
      byteSize: result.byteSize,
      pageCount: result.pageCount,
      templateName: result.templateName,
      templateVersion: result.templateVersion,
    };
  }

  // ── Saved views ────────────────────────────────────────────────────
  @Get('saved-views')
  @Authorized('programs:read:all')
  async listSavedViews(@AuthSession() user: SessionUser) {
    return this.cockpit.listSavedViews(user.userId);
  }

  @Post('saved-views')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'cockpit.save_view', entityType: 'SavedCockpitView' })
  async saveView(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(SaveViewBodySchema)) body: SaveViewBody,
  ) {
    // Refuse to save a view pointing at a scope the user can't access —
    // otherwise the view would 403 every time it loads anyway.
    const eff = await clampCockpitScope(body.scope, body.scopeId ?? null, user);
    return this.cockpit.saveView(user.userId, {
      name: body.name,
      viewMode: body.viewMode,
      scope: eff.scope,
      scopeId: eff.scopeId,
      filters: body.filters,
    });
  }

  @Post('saved-views/:id/touch')
  @Authorized('programs:read:all')
  async touchView(@AuthSession() user: SessionUser, @Param('id') id: string) {
    await this.cockpit.touchSavedView(user.userId, id);
    return { ok: true };
  }

  @Delete('saved-views/:id')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'cockpit.delete_view', entityType: 'SavedCockpitView' })
  async deleteView(@AuthSession() user: SessionUser, @Param('id') id: string) {
    await this.cockpit.deleteSavedView(user.userId, id);
    return { ok: true };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

// Combine N single-scope cockpit KPI responses into one. Counts sum;
// averages (dataCompleteness, curriculum age) weight by programCount
// so a faculty grant doesn't get drowned by a single-program grant.
// Used for users with multi-faculty / multi-program / mixed grants.
type KpisShape = Awaited<ReturnType<CockpitService['kpis']>>;
function combineKpis(parts: KpisShape[]): KpisShape {
  if (parts.length === 0) {
    throw new Error('combineKpis requires at least one part');
  }
  const first = parts[0]!;
  const sumN = (key: keyof KpisShape): number =>
    parts.reduce<number>((acc, p) => acc + ((p[key] as number | null) ?? 0), 0);
  const sumNullable = (key: keyof KpisShape): number | null => {
    let acc = 0;
    let anyNotNull = false;
    for (const p of parts) {
      const v = p[key] as number | null;
      if (v !== null && v !== undefined) {
        acc += v;
        anyNotNull = true;
      }
    }
    return anyNotNull ? acc : null;
  };
  const weightedAvg = (key: keyof KpisShape): number | null => {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const p of parts) {
      const v = p[key] as number | null;
      const w = p.programCount;
      if (v !== null && v !== undefined && w > 0) {
        weightedSum += v * w;
        totalWeight += w;
      }
    }
    return totalWeight > 0 ? weightedSum / totalWeight : null;
  };
  const latestFreshness: Date | null = (() => {
    let latest: Date | null = null;
    for (const p of parts) {
      const v = p.latestFreshness;
      if (v && (!latest || v > latest)) latest = v;
    }
    return latest;
  })();
  return {
    programCount: sumN('programCount'),
    enrolledTotal: sumNullable('enrolledTotal') ?? 0,
    netContributionTotal: sumNullable('netContributionTotal'),
    dangerZoneCount: sumN('dangerZoneCount'),
    qualityConcernCount: sumN('qualityConcernCount'),
    atRiskCount: sumN('atRiskCount'),
    surgingCount: sumN('surgingCount'),
    programsWithTrend: sumN('programsWithTrend'),
    dataCompletenessPct: weightedAvg('dataCompletenessPct'),
    averageCurriculumAgeYears: weightedAvg('averageCurriculumAgeYears'),
    methodologyVersion: first.methodologyVersion,
    latestFreshness,
  };
}

function formatThaiDate(d: Date): string {
  // Buddhist-era year (CE + 543) + Thai month names. Simple enough to
  // keep inline; if this gets richer we move to dayjs + dayjs-buddhist.
  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear() + 543}`;
}

interface CouncilPackInputs {
  kpis: Awaited<ReturnType<CockpitService['kpis']>>;
  heatmap: Awaited<ReturnType<CockpitService['heatmap']>>;
  brief: Awaited<ReturnType<CockpitService['generateBrief']>> | null;
}

function buildCouncilPackSections(inputs: CouncilPackInputs): Array<{ title: string; html: string }> {
  const { kpis, heatmap } = inputs;
  const rows = heatmap.rows;

  const kpiHtml = `
    <table>
      <tbody>
        <tr><td>จำนวนหลักสูตร</td><td class="numeric">${kpis.programCount}</td></tr>
        <tr><td>จำนวนนักศึกษา (ปีล่าสุด)</td><td class="numeric">${kpis.enrolledTotal ?? '—'}</td></tr>
        <tr><td>กำไร/ขาดทุนสุทธิ (บาท)</td><td class="numeric">${kpis.netContributionTotal !== null ? kpis.netContributionTotal.toLocaleString('en-US') : '—'}</td></tr>
        <tr><td>หลักสูตรในเขตอันตราย</td><td class="numeric">${kpis.dangerZoneCount}</td></tr>
        <tr><td>หลักสูตรที่มีปัญหาคุณภาพ</td><td class="numeric">${kpis.qualityConcernCount}</td></tr>
        <tr><td>อายุเฉลี่ยของหลักสูตร (ปี)</td><td class="numeric">${kpis.averageCurriculumAgeYears?.toFixed(1) ?? '—'}</td></tr>
      </tbody>
    </table>
  `;

  const heatmapRowsHtml = rows
    .map((r) => {
      const cells = (['attractiveness', 'financial', 'capability', 'outcomes', 'relevance'] as const)
        .map((dim) => {
          const s = r.dimensions[dim];
          if (s.score === null) return `<td class="muted">—</td>`;
          const tone =
            s.score < 40 ? 'danger' : s.score < 65 ? 'warning' : 'success';
          return `<td class="numeric ${tone}">${s.score.toFixed(0)}</td>`;
        })
        .join('');
      const overall = r.overall.score;
      const overallCell =
        overall === null
          ? `<td class="muted">—</td>`
          : `<td class="numeric"><strong>${overall.toFixed(0)}</strong></td>`;
      return `<tr><td>${r.scopeLabel}</td>${cells}${overallCell}</tr>`;
    })
    .join('');

  const heatmapHtml = `
    <table>
      <thead>
        <tr>
          <th>หน่วยงาน</th>
          <th class="numeric">Demand</th>
          <th class="numeric">Financial</th>
          <th class="numeric">Quality</th>
          <th class="numeric">Relevance</th>
          <th class="numeric">Capability</th>
          <th class="numeric">รวม</th>
        </tr>
      </thead>
      <tbody>${heatmapRowsHtml}</tbody>
    </table>
    <p class="muted">คะแนน 0–100 · &lt;40 = อันตราย · 40–65 = ต้องปรับปรุง · &gt;65 = แข็งแรง</p>
  `;

  return [
    { title: 'ตัวชี้วัดสำคัญ', html: kpiHtml },
    { title: 'แผนที่สุขภาพหลักสูตร', html: heatmapHtml },
  ];
}

function summariseKeyTakeaways(
  kpis: Awaited<ReturnType<CockpitService['kpis']>>,
  rows: Awaited<ReturnType<CockpitService['heatmap']>>['rows'],
): string[] {
  const out: string[] = [];
  if (kpis.dangerZoneCount > 0) {
    out.push(`มี ${kpis.dangerZoneCount} หน่วยงานที่อยู่ในเขตอันตราย (คะแนนรวม < 40)`);
  }
  if (kpis.qualityConcernCount > 0) {
    out.push(`มี ${kpis.qualityConcernCount} หน่วยงานที่มีปัญหาด้านคุณภาพ`);
  }
  if (kpis.averageCurriculumAgeYears && kpis.averageCurriculumAgeYears > 10) {
    out.push(
      `อายุเฉลี่ยของหลักสูตรอยู่ที่ ${kpis.averageCurriculumAgeYears.toFixed(0)} ปี — อาจต้องทบทวน`,
    );
  }
  const healthy = rows.filter((r) => (r.overall.score ?? 0) >= 65).length;
  if (healthy > 0) {
    out.push(`${healthy} หน่วยงานอยู่ในสถานะแข็งแรง (คะแนน ≥ 65)`);
  }
  return out;
}
