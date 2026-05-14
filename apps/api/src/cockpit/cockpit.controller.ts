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
import { LANDSCAPE_METHODOLOGY_BUNDLE } from '@kku/db';
import { ScopeLevelSchema, type ScopeLevel, type SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
  clampScopeForUser,
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
      { id: 'kku-tcas-funnel', name: 'KKU Registry · POWERBI.ADMISSION_STAT_CURRID' },
    ],
    methodologyVersion: 'recruitment-rollup.v1',
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
      { id: 'health-score', name: 'Health score methodology v2.1' },
    ],
    methodologyVersion: 'health-score.v2.1',
  })
  async kpis(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ScopeQuerySchema)) q: ScopeQuery,
  ) {
    const eff = await clampCockpitScope(q.scope, q.scopeId ?? null, user);
    return this.cockpit.kpis(eff.scope, eff.scopeId);
  }

  @Get('heatmap')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'health-score', name: 'Health score methodology v2.1' }],
    methodologyVersion: 'health-score.v2.1',
  })
  async heatmap(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ScopeQuerySchema)) q: ScopeQuery,
  ) {
    const eff = await clampCockpitScope(q.scope, q.scopeId ?? null, user);
    return this.cockpit.heatmap(eff.scope, eff.scopeId);
  }

  @Get('matrix')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'health-score', name: 'Health score methodology v2.1' }],
    methodologyVersion: 'health-score.v2.1',
  })
  async matrix(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ScopeQuerySchema)) q: ScopeQuery,
  ) {
    const eff = await clampCockpitScope(q.scope, q.scopeId ?? null, user);
    return this.cockpit.matrix(eff.scope, eff.scopeId);
  }

  @Get('rollup')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'mv_metrics', name: 'Materialized metric rollups' },
      { id: 'health-score', name: 'Health score methodology v2.1' },
    ],
    methodologyVersion: 'health-score.v2.1',
  })
  async rollup(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ScopeQuerySchema)) q: ScopeQuery,
  ) {
    const eff = await clampCockpitScope(q.scope, q.scopeId ?? null, user);
    return this.cockpit.rollup(eff.scope, eff.scopeId);
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
              methodologyVersion: 'health-score.v2.1',
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
