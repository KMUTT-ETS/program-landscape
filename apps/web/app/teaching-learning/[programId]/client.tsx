'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfidenceBadge,
  FreshnessBadge,
  RadarChartSmall,
  Section,
  type RadarPoint,
} from '@kku/ui';
// TYPE-ONLY from `@kku/shared`. Its barrel re-exports subpaths that pull
// `node:crypto`, which breaks the browser bundle — the DQ module table
// (`DQ_MODULES`, plain data) is read by the SERVER page and handed down as
// the `dqModules` prop. Nothing here reaches `@kku/shared` or `@kku/db` at
// runtime.
import type { DqModule } from '@kku/shared';
import { submitDisagreementAction } from '@/lib/actions/program-deep-dive';
// Shared with `/education/student-dq` and the deep-dive so every DQ radar
// means the same thing by its floor — see the helper for why it is not 0.
import { dqRadarDomain } from '@/lib/dq-radar-domain';

/*
 * Teaching & Learning — one programme against the AUN-QA v4 criteria.
 *
 * ── FOUR RULES THIS FILE EXISTS TO KEEP ───────────────────────────────
 * 1. Unavailable evidence renders as "no evidence", NEVER as 0 and never
 *    as an empty chart. On an accreditation surface a zero reads as
 *    "measured, and scored nothing", which is a different and false claim.
 * 2. `ResolvedEvidence.caveat` is rendered beside the figure it qualifies,
 *    never hidden in a tooltip. The caveats are load-bearing: a staff
 *    figure computed over a whole faculty is not a statement about this
 *    programme, and cohort progression is not a measured time to graduate.
 *    A QA officer quoting an uncaveated figure into a submission is the
 *    harm this page exists to prevent.
 * 3. A criterion with no evidence at all for this programme is omitted —
 *    and named once at the foot alongside the criteria the platform can
 *    evidence for nobody, so a reader cannot infer that what they see is
 *    the whole framework.
 * 4. No AUN-QA 1-7 rating anywhere. Completeness is a claim about OUR
 *    DATA; a rating is a claim about the programme, and assessors make
 *    those. See the header of `packages/db/src/aunqa-readiness.ts`.
 *
 * Criterion numbers and titles are never written here — they arrive from
 * the registry in `packages/shared/src/aunqa/criteria.ts` so correcting the
 * list against the official guide stays an edit to one table. The labels
 * below name EVIDENCE CHANNELS (the registry's binding vocabulary), which
 * is a different thing.
 */

// ── Payload types ─────────────────────────────────────────────────────
// Mirror `AunqaProgramAnalysis` in `apps/api/src/aunqa/aunqa.service.ts`.
// Declared here and imported as types by the server page, the same
// arrangement `/education/student-dq` uses.

export type AunqaBand = 'well-evidenced' | 'partly-evidenced' | 'no-evidence';

export interface AunqaBindingRef {
  kind: string;
  field?: string;
  theme?: string;
}

export interface AunqaResolvedEvidence {
  binding: AunqaBindingRef;
  available: boolean;
  /** Shape depends on the binding kind. Always null when unavailable. */
  value: unknown;
  sourceLabel: string;
  freshness: string | null;
  caveat: string | null;
}

export interface AunqaSubCriterion {
  id: string;
  title: string;
  hasEvidence: boolean;
  evidence: AunqaResolvedEvidence[];
}

export interface AunqaCriterion {
  criterionId: string;
  title: string;
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: AunqaBand;
  subCriteria: AunqaSubCriterion[];
  evidence: AunqaResolvedEvidence[];
}

export interface AunqaUnevidencedCriterion {
  id: string;
  title: string;
  whyAbsent: string;
}

export interface AunqaProgramSummary {
  id: string;
  code: string;
  nameEn: string | null;
  nameTh: string;
  level: string;
  facultyId: string;
  facultyNameTh: string;
  facultyNameEn: string | null;
}

export interface AunqaProgramAnalysis {
  program: AunqaProgramSummary;
  criteria: AunqaCriterion[];
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: AunqaBand;
  unevidencedCriteria: AunqaUnevidencedCriterion[];
}

export interface AunqaNarrativeGap {
  subCriterionId: string;
  missing: string;
}

export interface AunqaNarrativeDraft {
  programId: string;
  criterionId: string;
  criterionTitle: string;
  paragraph: string;
  gaps: AunqaNarrativeGap[];
  band: string;
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  confidence: number;
  methodVersion: string;
  aiInferenceId: string | null;
}

export type GenerateNarrative = (
  criterionId: string,
) => Promise<{ ok: true; draft: AunqaNarrativeDraft } | { ok: false; message: string }>;

// ── Value shapes ──────────────────────────────────────────────────────
// Mirror the per-kind interfaces in `packages/db/src/aunqa-evidence.ts`.
// `value` arrives as `unknown` by contract; `read<T>` narrows it once the
// channel key has told us which shape to expect. The upstream invariant
// (`available: true` implies a non-null value, enforced by
// `assertAvailable`) is what makes the cast safe.

function read<T>(ev: AunqaResolvedEvidence): T | null {
  if (!ev.available || ev.value === null || ev.value === undefined) return null;
  return ev.value as T;
}

interface CurriculumSkillsValue {
  skillCount: number;
  ploSkillCount: number;
  majorContributorCount: number;
  minorContributorCount: number;
  topSkills: Array<{ nameEn: string; nameTh: string; weight: number; pickedFromPlo: boolean }>;
}

interface CurriculumCoursesValue {
  extractedCourseCount: number;
  gradedCourseCount: number;
  totalCredits: number | null;
  yearsObserved: number[];
}

interface CurriculumCreditsValue {
  totalCredits: number;
  durationYears: number | null;
  creditsFromCourseList: number | null;
  extractedCourseCount: number;
}

interface EvaluationThemeValue {
  theme: string;
  ratingAvg: number;
  respondentCount: number;
  cellCount: number;
  questionCount: number;
  yearsObserved: { first: number; last: number };
}

interface DqProgramScoreValue {
  rawMean: number;
  scoredStudents: number;
}

interface DqModuleProfileValue {
  rawMean: number | null;
  scoredStudents: number;
  modules: Array<{
    moduleKey: string;
    moduleNo: number;
    mean: number | null;
    universityMean: number | null;
  }>;
  weakest: Array<{ moduleKey: string; mean: number }>;
}

interface GraduateOutcomeValue {
  field: 'employmentRate' | 'jobRelevance' | 'furtherStudy' | 'salary';
  value: number;
  graduationYear: number;
  sampleSize: number;
}

interface ClassGpaDistributionValue {
  averageClassGpa: number;
  courseCount: number;
  classCount: number;
  gradedCount: number;
  bands: Array<{ band: string; lo: number; hi: number; courses: number }>;
  yearsObserved: number[];
}

interface EnrollmentMetricValue {
  field: 'dropouts' | 'enrolled';
  value: number;
  academicYear: number;
  enrolled: number;
  dropouts: number;
  dropoutPct: number;
  series: Array<{
    academicYear: number;
    enrolled: number;
    dropouts: number;
    dropoutPct: number;
  }>;
}

interface CohortProgressionValue {
  cohorts: Array<{
    entryYearBE: number;
    yearInProgramme: number;
    studentCount: number;
    status: string;
  }>;
  totalActive: number;
  incomingCount: number;
  onTrackCount: number;
  delayedCount: number;
  delayedPct: number | null;
  programDurationYears: number | null;
}

type RosterScope = 'program' | 'department' | 'faculty';

interface StaffRatioValue {
  enrolled: number;
  activeStaff: number;
  studentsPerStaff: number;
  academicYear: number;
  rosterScope: RosterScope;
}

interface StaffRankMixValue {
  activeStaff: number;
  ranks: Record<string, number>;
  seniorSharePct: number;
  retiringWithin5Years: number;
  rosterScope: RosterScope;
}

interface StaffResearchValue {
  activeStaff: number;
  totalPublications: number;
  publicationsPerStaff: number;
  rosterScope: RosterScope;
}

interface StaffWorkloadValue {
  academicYear: number;
  teachers: number;
  sections: number;
  totalContactHrsPerWeek: number;
  avgContactHrsPerTeacher: number;
}

interface PedagogyDisciplineFitValue {
  disciplineFitScore: number;
  overallScore: number;
  confidence: number;
  methodVersion: string;
}

interface PedagogyQaSystemValue {
  qaScore: number;
  framework: string | null;
  continuousImprovementEvidence: string[];
  stakeholderFeedbackLoops: string[];
  confidence: number;
  methodVersion: string;
}

interface PedagogyGapsValue {
  gaps: Array<{ area: string; severity: string; observation: string; recommendation: string }>;
  gapCount: number;
  confidence: number;
  methodVersion: string;
}

interface PeerContentModernityValue {
  verdict: string;
  narrative: string;
  confidence: number;
  peerCountTotal: number;
}

interface PeerContentGapsValue {
  gaps: Array<{ topic: string; kkuStatus: string; peerExamples: string; severity: string }>;
  gapCount: number;
  confidence: number;
  peerCountTotal: number;
}

// ── Channel identity + labels ─────────────────────────────────────────

/** Mirrors `bindingKey` in `packages/db/src/aunqa-evidence.ts` — kind, plus
 *  the field or theme that distinguishes two bindings of the same kind. */
function channelKey(b: AunqaBindingRef): string {
  if (b.theme !== undefined) return `${b.kind}:${b.theme}`;
  if (b.field !== undefined) return `${b.kind}:${b.field}`;
  return b.kind;
}

const THEME_LABELS: Record<string, string> = {
  'content-design': 'course content and design',
  'english-skills': 'English-language skills',
  'active-learning': 'active learning',
  assessment: 'assessment',
  feedback: 'feedback to students',
  ethics: 'ethics and professional conduct',
};

const CHANNEL_LABELS: Record<string, string> = {
  'curriculum:skills': 'Programme skill map',
  'curriculum:courses': 'Course list and class offerings',
  'curriculum:credits': 'Credit structure',
  'dq-program-score': 'Digital Intelligence (DQ) score',
  'dq-module-profile': 'Digital Intelligence (DQ) module profile',
  'graduate-outcome:employmentRate': 'Graduate employment rate',
  'graduate-outcome:jobRelevance': 'Graduate job relevance',
  'graduate-outcome:furtherStudy': 'Graduates in further study',
  'graduate-outcome:salary': 'Graduate starting salary',
  'class-gpa-distribution': 'Class GPA distribution',
  'enrollment-metric:dropouts': 'Retention — dropouts against intake',
  'enrollment-metric:enrolled': 'Intake',
  'cohort-progression': 'Cohort progression by year in programme',
  'staff-metric:studentFacultyRatio': 'Student-to-staff ratio',
  'staff-metric:rankMix': 'Staff rank mix',
  'staff-metric:research': 'Staff research output',
  'staff-metric:workload': 'Teaching contact hours',
  'pedagogy-assessment:disciplineFit': 'Pedagogy assessment — fit to the discipline',
  'pedagogy-assessment:qaSystem': 'Pedagogy assessment — quality-assurance system',
  'pedagogy-assessment:gaps': 'Pedagogy assessment — gaps found',
  'peer-review:contentModernity': 'Peer review — how current the content is',
  'peer-review:contentGaps': 'Peer review — content gaps against peers',
};

function channelLabel(b: AunqaBindingRef): string {
  const key = channelKey(b);
  const known = CHANNEL_LABELS[key];
  if (known) return known;
  if (b.kind === 'evaluation-theme' && b.theme) {
    return `Student evaluations — ${THEME_LABELS[b.theme] ?? b.theme}`;
  }
  return key;
}

// ── Small formatting helpers ──────────────────────────────────────────

const int = (n: number): string => Math.round(n).toLocaleString('en-US');
const dec = (n: number, places = 2): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
const pctOfFraction = (n: number, places = 1): string => `${dec(n * 100, places)}%`;

const BAND_TONE: Record<AunqaBand, 'success' | 'warning' | 'neutral'> = {
  'well-evidenced': 'success',
  'partly-evidenced': 'warning',
  'no-evidence': 'neutral',
};

function BandBadge({ band }: { band: AunqaBand }) {
  return <Badge tone={BAND_TONE[band]}>{band.replace('-', ' ')}</Badge>;
}

/** A figure and what it is. Used everywhere a channel's headline number
 *  appears, so one number never runs into the next as a single token. */
function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-text-tertiary">{label}</span>
      <span className="font-tabular text-xl font-semibold text-text-primary">{value}</span>
      {note && <span className="text-xs text-text-tertiary">{note}</span>}
    </div>
  );
}

function FigureRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-x-8 gap-y-3">{children}</div>;
}

function rosterScopeNote(scope: RosterScope): string {
  if (scope === 'program') return 'programme roster';
  if (scope === 'department') return 'department roster';
  return 'faculty roster';
}

// ── Per-kind evidence bodies ──────────────────────────────────────────

function CurriculumSkillsBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<CurriculumSkillsValue>(ev);
  if (!v) return null;
  return (
    <div className="flex flex-col gap-3">
      <FigureRow>
        <Figure label="Skills mapped" value={int(v.skillCount)} />
        <Figure
          label="From stated outcomes"
          value={int(v.ploSkillCount)}
          note="taken from the programme's own learning-outcome text"
        />
        <Figure
          label="Major contributors"
          value={int(v.majorContributorCount)}
          note={`${int(v.minorContributorCount)} minor`}
        />
      </FigureRow>
      {v.topSkills.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {v.topSkills.map((s) => (
            <li
              key={s.nameEn}
              className="rounded-md border border-subtle bg-surface-2 px-2 py-1 text-xs"
            >
              <span className="text-text-primary">{s.nameEn}</span>
              {/* The separator carries its own spaces. A padded span alone
                  leaves no whitespace in the text, so the name and the
                  number read as one token to anything that flattens it. */}
              <span className="text-text-tertiary"> · </span>
              <span className="font-tabular text-text-tertiary">
                weight {dec(s.weight, 2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CurriculumCoursesBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<CurriculumCoursesValue>(ev);
  if (!v) return null;
  return (
    <FigureRow>
      <Figure label="Courses extracted" value={int(v.extractedCourseCount)} />
      <Figure
        label="With a graded section"
        value={int(v.gradedCourseCount)}
        note="on the registrar's class record"
      />
      <Figure
        label="Years observed"
        value={
          v.yearsObserved.length === 0
            ? 'none'
            : `${Math.min(...v.yearsObserved)}–${Math.max(...v.yearsObserved)}`
        }
        note="Buddhist Era"
      />
    </FigureRow>
  );
}

function CurriculumCreditsBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<CurriculumCreditsValue>(ev);
  if (!v) return null;
  return (
    <FigureRow>
      <Figure label="Total credits" value={int(v.totalCredits)} note="from the programme record" />
      <Figure
        label="Nominal duration"
        value={v.durationYears === null ? 'not recorded' : `${int(v.durationYears)} years`}
      />
      <Figure
        label="Credits on the extracted course list"
        value={
          v.creditsFromCourseList === null ? 'not recorded' : int(v.creditsFromCourseList)
        }
        note={`across ${int(v.extractedCourseCount)} extracted courses — the list is not a study plan, so it does not have to sum to the total`}
      />
    </FigureRow>
  );
}

function EvaluationThemeBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<EvaluationThemeValue>(ev);
  if (!v) return null;
  // 1-5 Likert, drawn as a share of the scale so the reader is not left
  // to judge whether 4.37 is high.
  const share = Math.max(0, Math.min(1, (v.ratingAvg - 1) / 4));
  return (
    <div className="flex flex-col gap-3">
      <FigureRow>
        <Figure
          label="Respondent-weighted mean"
          value={`${dec(v.ratingAvg, 2)} / 5`}
          note={`${int(v.questionCount)} question${v.questionCount === 1 ? '' : 's'} in this theme`}
        />
        <Figure
          label="Respondents"
          value={int(v.respondentCount)}
          note={`across ${int(v.cellCount)} course-question cells`}
        />
        <Figure
          label="Years observed"
          value={`${v.yearsObserved.first}–${v.yearsObserved.last}`}
          note="Buddhist Era"
        />
      </FigureRow>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="presentation"
      >
        <div className="h-full rounded-full bg-chart-1" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="text-xs text-text-tertiary">
        Bar runs the full 1–5 scale. The instrument&apos;s themes do not partition it — five of its
        questions carry no theme, so a theme mean is not comparable with an overall satisfaction
        score.
      </p>
    </div>
  );
}

function DqProgramScoreBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<DqProgramScoreValue>(ev);
  if (!v) return null;
  return (
    <FigureRow>
      <Figure label="Digital competency mean" value={`${dec(v.rawMean, 1)} / 100`} />
      <Figure label="Scored students" value={int(v.scoredStudents)} />
    </FigureRow>
  );
}

function DqModuleProfileBody({
  ev,
  dqModules,
}: {
  ev: AunqaResolvedEvidence;
  dqModules: DqModule[];
}) {
  const v = read<DqModuleProfileValue>(ev);
  if (!v || v.modules.length === 0) return null;
  const byKey = new Map(dqModules.map((m) => [m.key, m]));
  const axis = (key: string): string => byKey.get(key)?.shortEn ?? key;
  // Null stays null. A 0 would spike into the centre and read as "they
  // scored nothing" rather than "nobody took this module".
  const programPoints: RadarPoint[] = v.modules.map((m) => ({
    label: axis(m.moduleKey),
    value: m.mean,
  }));
  const universityPoints: RadarPoint[] = v.modules.map((m) => ({
    label: axis(m.moduleKey),
    value: m.universityMean,
  }));
  const domain = dqRadarDomain([
    v.modules.map((m) => ({ mean: m.mean })),
    v.modules.map((m) => ({ mean: m.universityMean })),
  ]);
  const hasUniversity = universityPoints.some((p) => p.value !== null);
  return (
    <div className="flex flex-col gap-3">
      <FigureRow>
        <Figure
          label="Module mean"
          value={v.rawMean === null ? 'not published' : `${dec(v.rawMean, 1)} / 100`}
        />
        <Figure label="Scored students" value={int(v.scoredStudents)} />
      </FigureRow>
      <div className="flex flex-wrap items-start gap-4">
        <RadarChartSmall
          points={programPoints}
          seriesLabel="This programme"
          comparisons={
            hasUniversity ? [{ label: 'University', points: universityPoints }] : []
          }
          domain={domain}
          width={320}
          height={260}
        />
        <div className="flex min-w-[200px] flex-1 flex-col gap-2">
          <p className="text-xs text-text-tertiary">
            The radial axis runs {domain[0]}–100, not 0–100. DQ scores cluster near the top of the
            scale, so a full-scale plot reads as a circle — but a shortened axis magnifies the
            differences it shows.
          </p>
          {v.weakest.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-text-tertiary">
                Weakest modules
              </span>
              <ul className="flex flex-col gap-0.5 text-xs">
                {v.weakest.map((w) => (
                  <li key={w.moduleKey} className="flex items-baseline justify-between gap-4">
                    <span className="text-text-secondary">
                      {byKey.get(w.moduleKey)?.nameEn ?? w.moduleKey}
                    </span>
                    <span className="font-tabular text-text-primary">{dec(w.mean, 1)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const OUTCOME_LABEL: Record<GraduateOutcomeValue['field'], string> = {
  employmentRate: 'Employment rate',
  jobRelevance: 'Working in their discipline',
  furtherStudy: 'In further study',
  salary: 'Average starting salary',
};

function GraduateOutcomeBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<GraduateOutcomeValue>(ev);
  if (!v) return null;
  const display =
    v.field === 'salary' ? `${int(v.value)} THB` : pctOfFraction(v.value, 1);
  return (
    <div className="flex flex-col gap-2">
      <FigureRow>
        <Figure
          label={OUTCOME_LABEL[v.field]}
          value={display}
          note={v.field === 'salary' ? 'monthly, self-reported' : undefined}
        />
        <Figure
          label="Graduating cohort"
          value={String(v.graduationYear)}
          note={`${int(v.sampleSize)} graduates surveyed`}
        />
      </FigureRow>
      {v.value === 0 && (
        <p className="text-xs text-warning">
          The survey row holds 0 for this field. Check it against the source before quoting it —
          a stored 0 and an unfilled field look the same here.
        </p>
      )}
    </div>
  );
}

function ClassGpaDistributionBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<ClassGpaDistributionValue>(ev);
  if (!v) return null;
  const maxCourses = Math.max(1, ...v.bands.map((b) => b.courses));
  return (
    <div className="flex flex-col gap-3">
      <FigureRow>
        <Figure
          label="Mean class GPA"
          value={dec(v.averageClassGpa, 2)}
          note="weighted by graded students"
        />
        <Figure
          label="Courses"
          value={int(v.courseCount)}
          note={`${int(v.classCount)} sections · ${int(v.gradedCount)} graded students`}
        />
        <Figure
          label="Years observed"
          value={
            v.yearsObserved.length === 0
              ? 'none'
              : `${Math.min(...v.yearsObserved)}–${Math.max(...v.yearsObserved)}`
          }
          note="Buddhist Era"
        />
      </FigureRow>
      <ul className="flex flex-col gap-1">
        {v.bands.map((b) => (
          <li key={b.band} className="flex items-center gap-3 text-xs">
            <span className="w-20 shrink-0 font-tabular text-text-secondary">{b.band}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
              <span
                className="block h-full rounded-full bg-chart-2"
                style={{ width: `${(b.courses / maxCourses) * 100}%` }}
              />
            </span>
            <span className="w-24 shrink-0 text-right font-tabular text-text-tertiary">
              {int(b.courses)} courses
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EnrollmentMetricBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<EnrollmentMetricValue>(ev);
  if (!v) return null;
  return (
    <div className="flex flex-col gap-3">
      <FigureRow>
        <Figure
          label="Intake"
          value={int(v.enrolled)}
          note={`academic year ${v.academicYear}`}
        />
        <Figure label="Dropouts recorded" value={int(v.dropouts)} />
        <Figure
          label="Dropout share of intake"
          value={`${dec(v.dropoutPct, 1)}%`}
          note="latest year with an intake"
        />
      </FigureRow>
      {v.series.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {v.series.map((y) => (
            <li key={y.academicYear} className="flex items-center gap-3">
              <span className="w-12 shrink-0 font-tabular text-text-secondary">
                {y.academicYear}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                <span
                  className="block h-full rounded-full bg-chart-4"
                  style={{ width: `${Math.min(100, y.dropoutPct)}%` }}
                />
              </span>
              <span className="w-40 shrink-0 text-right font-tabular text-text-tertiary">
                {dec(y.dropoutPct, 1)}% of {int(y.enrolled)} enrolled
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CohortProgressionBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<CohortProgressionValue>(ev);
  if (!v) return null;
  return (
    <div className="flex flex-col gap-3">
      <FigureRow>
        <Figure label="Active students" value={int(v.totalActive)} />
        <Figure label="Within nominal duration" value={int(v.onTrackCount)} />
        <Figure
          label="Past nominal duration"
          value={int(v.delayedCount)}
          note={
            v.delayedPct === null
              ? 'no nominal duration recorded, so no line to be past'
              : `${dec(v.delayedPct, 1)}% of active students`
          }
        />
      </FigureRow>
      <ul className="flex flex-col gap-1 text-xs">
        {v.cohorts.map((c) => (
          <li
            key={`${c.entryYearBE}-${c.yearInProgramme}`}
            className="flex items-center justify-between gap-3 border-b border-subtle pb-1 last:border-b-0"
          >
            <span className="text-text-secondary">
              Entered {c.entryYearBE} · year {c.yearInProgramme} in the programme
            </span>
            <span className="flex items-center gap-2">
              <span className="font-tabular text-text-primary">{int(c.studentCount)}</span>
              <span className="text-text-tertiary">students</span>
              <Badge tone={c.status === 'delayed' ? 'warning' : 'neutral'} size="sm">
                {c.status}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StaffRatioBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<StaffRatioValue>(ev);
  if (!v) return null;
  return (
    <FigureRow>
      <Figure
        label="Students per active staff member"
        // Two places below 1. A faculty-wide roster against a six-student
        // programme gives 0.0098, and one decimal would print it as "0.0"
        // — a measured ratio rendered as the zero this page must never show.
        value={dec(v.studentsPerStaff, v.studentsPerStaff < 1 ? 2 : 1)}
        note={`academic year ${v.academicYear}`}
      />
      <Figure label="Enrolled" value={int(v.enrolled)} />
      <Figure
        label="Active staff"
        value={int(v.activeStaff)}
        note={rosterScopeNote(v.rosterScope)}
      />
    </FigureRow>
  );
}

function StaffRankMixBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<StaffRankMixValue>(ev);
  if (!v) return null;
  const ranks = Object.entries(v.ranks).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-col gap-3">
      <FigureRow>
        <Figure
          label="Active staff"
          value={int(v.activeStaff)}
          note={rosterScopeNote(v.rosterScope)}
        />
        <Figure
          label="Professor or associate professor"
          value={`${dec(v.seniorSharePct, 1)}%`}
        />
        <Figure
          label="Retiring within 5 years"
          value={int(v.retiringWithin5Years)}
          note="on recorded retirement dates"
        />
      </FigureRow>
      {ranks.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {ranks.map(([rank, count]) => (
            <li
              key={rank}
              className="rounded-md border border-subtle bg-surface-2 px-2 py-1 text-xs"
            >
              <span className="text-text-secondary">{rank.replace(/_/g, ' ').toLowerCase()}</span>
              <span className="text-text-tertiary"> · </span>
              <span className="font-tabular text-text-primary">{int(count)} staff</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StaffResearchBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<StaffResearchValue>(ev);
  if (!v) return null;
  return (
    <FigureRow>
      <Figure label="Publications per active staff member" value={dec(v.publicationsPerStaff, 1)} />
      <Figure label="Publications on record" value={int(v.totalPublications)} />
      <Figure
        label="Active staff"
        value={int(v.activeStaff)}
        note={rosterScopeNote(v.rosterScope)}
      />
    </FigureRow>
  );
}

function StaffWorkloadBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<StaffWorkloadValue>(ev);
  if (!v) return null;
  return (
    <FigureRow>
      <Figure
        label="Contact hours per teacher per week"
        value={dec(v.avgContactHrsPerTeacher, 1)}
        note={`academic year ${v.academicYear}`}
      />
      <Figure label="Teachers" value={int(v.teachers)} note={`${int(v.sections)} sections`} />
      <Figure label="Total contact hours per week" value={int(v.totalContactHrsPerWeek)} />
    </FigureRow>
  );
}

function PedagogyDisciplineFitBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<PedagogyDisciplineFitValue>(ev);
  if (!v) return null;
  return (
    <div className="flex flex-col gap-2">
      <FigureRow>
        <Figure
          label="Fit of teaching methods to the discipline"
          value={`${int(v.disciplineFitScore)} / 100`}
        />
        <Figure label="Overall pedagogy score" value={`${int(v.overallScore)} / 100`} />
      </FigureRow>
      <p className="text-xs text-text-tertiary">
        Read from the curriculum document by <span className="font-tabular">{v.methodVersion}</span>
        , which rated its own confidence at {dec(v.confidence, 2)}.
      </p>
    </div>
  );
}

function PedagogyQaSystemBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<PedagogyQaSystemValue>(ev);
  if (!v) return null;
  return (
    <div className="flex flex-col gap-3">
      <FigureRow>
        <Figure label="Quality-assurance score" value={`${int(v.qaScore)} / 100`} />
        <Figure
          label="Framework the document names"
          value={v.framework ?? 'none named'}
          note="the framework the curriculum itself declares"
        />
      </FigureRow>
      {v.continuousImprovementEvidence.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-text-tertiary">
            Continuous-improvement evidence quoted from the document
          </span>
          <ul className="ml-4 list-disc text-xs text-text-secondary">
            {v.continuousImprovementEvidence.map((q, i) => (
              <li key={i} lang="th">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
      {v.stakeholderFeedbackLoops.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-text-tertiary">
            Stakeholder feedback loops quoted from the document
          </span>
          <ul className="ml-4 list-disc text-xs text-text-secondary">
            {v.stakeholderFeedbackLoops.map((q, i) => (
              <li key={i} lang="th">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-text-tertiary">
        Read from the curriculum document by <span className="font-tabular">{v.methodVersion}</span>
        , which rated its own confidence at {dec(v.confidence, 2)}.
      </p>
    </div>
  );
}

const SEVERITY_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = {
  major: 'danger',
  critical: 'danger',
  moderate: 'warning',
  minor: 'neutral',
};

function PedagogyGapsBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<PedagogyGapsValue>(ev);
  if (!v) return null;
  if (v.gapCount === 0) {
    return (
      <p className="text-sm text-text-secondary">
        The assessment ran against the curriculum document and named no gaps. That is a finding, not
        an absence of evidence.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {v.gaps.map((g, i) => (
        <li key={i} className="rounded-md border border-subtle bg-surface-2 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{g.area}</span>
            <Badge tone={SEVERITY_TONE[g.severity.toLowerCase()] ?? 'neutral'} size="sm">
              {g.severity}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-text-secondary">{g.observation}</p>
          <p className="mt-1 text-xs text-text-tertiary">
            Suggested: {g.recommendation}
          </p>
        </li>
      ))}
    </ul>
  );
}

function PeerContentModernityBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<PeerContentModernityValue>(ev);
  if (!v) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-text-tertiary">Verdict</span>
        <Badge tone="neutral">{v.verdict.replace(/_/g, ' ').toLowerCase()}</Badge>
        <span className="text-xs text-text-tertiary">
          against {int(v.peerCountTotal)} comparator programmes
        </span>
        <ConfidenceBadge value={v.confidence} />
      </div>
      <p className="text-sm leading-relaxed text-text-secondary">{v.narrative}</p>
    </div>
  );
}

function PeerContentGapsBody({ ev }: { ev: AunqaResolvedEvidence }) {
  const v = read<PeerContentGapsValue>(ev);
  if (!v) return null;
  if (v.gapCount === 0) {
    return (
      <p className="text-sm text-text-secondary">
        The peer review ran against {int(v.peerCountTotal)} comparator programmes and named no
        content gaps. That is a finding, not an absence of evidence.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-tertiary">
          {int(v.gapCount)} gap{v.gapCount === 1 ? '' : 's'} against {int(v.peerCountTotal)}{' '}
          comparator programmes
        </span>
        <ConfidenceBadge value={v.confidence} />
      </div>
      <ul className="flex flex-col gap-2">
        {v.gaps.map((g, i) => (
          <li key={i} className="rounded-md border border-subtle bg-surface-2 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{g.topic}</span>
              <Badge tone={SEVERITY_TONE[g.severity.toLowerCase()] ?? 'neutral'} size="sm">
                {g.severity}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-text-secondary">At KKU: {g.kkuStatus}</p>
            <p className="mt-1 text-xs text-text-tertiary">Peers: {g.peerExamples}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dispatch on the channel, exactly as the resolvers dispatch on the
 *  binding. A kind with no body here still renders its header, source,
 *  freshness and caveat — never a blank card and never a fabricated
 *  figure. */
function EvidenceBody({
  ev,
  dqModules,
}: {
  ev: AunqaResolvedEvidence;
  dqModules: DqModule[];
}) {
  const key = channelKey(ev.binding);
  if (ev.binding.kind === 'evaluation-theme') return <EvaluationThemeBody ev={ev} />;
  switch (key) {
    case 'curriculum:skills':
      return <CurriculumSkillsBody ev={ev} />;
    case 'curriculum:courses':
      return <CurriculumCoursesBody ev={ev} />;
    case 'curriculum:credits':
      return <CurriculumCreditsBody ev={ev} />;
    case 'dq-program-score':
      return <DqProgramScoreBody ev={ev} />;
    case 'dq-module-profile':
      return <DqModuleProfileBody ev={ev} dqModules={dqModules} />;
    case 'class-gpa-distribution':
      return <ClassGpaDistributionBody ev={ev} />;
    case 'cohort-progression':
      return <CohortProgressionBody ev={ev} />;
    case 'staff-metric:studentFacultyRatio':
      return <StaffRatioBody ev={ev} />;
    case 'staff-metric:rankMix':
      return <StaffRankMixBody ev={ev} />;
    case 'staff-metric:research':
      return <StaffResearchBody ev={ev} />;
    case 'staff-metric:workload':
      return <StaffWorkloadBody ev={ev} />;
    case 'pedagogy-assessment:disciplineFit':
      return <PedagogyDisciplineFitBody ev={ev} />;
    case 'pedagogy-assessment:qaSystem':
      return <PedagogyQaSystemBody ev={ev} />;
    case 'pedagogy-assessment:gaps':
      return <PedagogyGapsBody ev={ev} />;
    case 'peer-review:contentModernity':
      return <PeerContentModernityBody ev={ev} />;
    case 'peer-review:contentGaps':
      return <PeerContentGapsBody ev={ev} />;
    default:
      break;
  }
  if (ev.binding.kind === 'graduate-outcome') return <GraduateOutcomeBody ev={ev} />;
  if (ev.binding.kind === 'enrollment-metric') return <EnrollmentMetricBody ev={ev} />;
  return null;
}

/** The caveat, always on screen beside the figure it qualifies. Never a
 *  tooltip: on this surface the wording of a caveat is the guard against
 *  a QA officer quoting an uncaveated number into a submission. */
function Caveat({ text }: { text: string }) {
  return (
    <p className="mt-2 rounded-md border border-warning/40 bg-warning-subtle px-2.5 py-1.5 text-xs text-warning">
      {text}
    </p>
  );
}

function AvailableEvidence({
  ev,
  dqModules,
}: {
  ev: AunqaResolvedEvidence;
  dqModules: DqModule[];
}) {
  return (
    <Card padding="sm" className="bg-surface-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-text-primary">
          {channelLabel(ev.binding)}
        </span>
        <FreshnessBadge freshnessDate={ev.freshness} label={ev.sourceLabel} />
      </div>
      <EvidenceBody ev={ev} dqModules={dqModules} />
      {ev.caveat && <Caveat text={ev.caveat} />}
      <p className="mt-2 text-xs text-text-tertiary">Source: {ev.sourceLabel}</p>
    </Card>
  );
}

/** "No evidence" — never a 0, never an empty chart. What was looked for,
 *  and where it would have come from. */
function MissingEvidence({ ev }: { ev: AunqaResolvedEvidence }) {
  return (
    <div className="rounded-md border border-dashed border-subtle bg-surface-0 px-2.5 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-text-secondary">
          {channelLabel(ev.binding)}
        </span>
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          no evidence
        </span>
      </div>
      <p className="mt-0.5 text-xs text-text-tertiary">
        Would come from: {ev.sourceLabel}
      </p>
      {ev.caveat && <Caveat text={ev.caveat} />}
    </div>
  );
}

// ── The narrative draft ───────────────────────────────────────────────

function NarrativeDraft({
  programId,
  criterion,
  draft,
  busy,
  onGenerate,
}: {
  programId: string;
  criterion: AunqaCriterion;
  draft: AunqaNarrativeDraft | null;
  busy: boolean;
  onGenerate: () => void;
}) {
  const [reasoningOpen, setReasoningOpen] = React.useState(false);
  const [disagreeOpen, setDisagreeOpen] = React.useState(false);
  const [disagreeText, setDisagreeText] = React.useState('');

  const sources = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const ev of criterion.evidence) {
      if (ev.available && !seen.has(ev.sourceLabel)) seen.set(ev.sourceLabel, ev.sourceLabel);
    }
    return [...seen.values()];
  }, [criterion.evidence]);

  const channels = React.useMemo(() => {
    const seen = new Map<string, AunqaResolvedEvidence>();
    for (const ev of criterion.evidence) {
      const key = channelKey(ev.binding);
      if (!seen.has(key)) seen.set(key, ev);
    }
    return [...seen.entries()];
  }, [criterion.evidence]);

  const onSubmitDisagreement = async (): Promise<void> => {
    if (!disagreeText.trim()) {
      toast.error('Describe your disagreement');
      return;
    }
    const r = await submitDisagreementAction({
      programId,
      sectionKey: `aunqa-criterion-${criterion.criterionId}`,
      aiInferenceId: draft?.aiInferenceId ?? undefined,
      bodyEn: disagreeText,
    });
    if (r.ok) {
      toast.success('Disagreement recorded — thank you');
      setDisagreeOpen(false);
      setDisagreeText('');
    } else {
      toast.error(r.message);
    }
  };

  if (!draft) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle pt-3">
        <p className="max-w-2xl text-xs text-text-tertiary">
          A self-assessment paragraph can be drafted from the evidence above, one criterion at a
          time. It is written to be edited — nothing here is generated until you ask for it.
        </p>
        <Button size="sm" disabled={busy} onClick={onGenerate}>
          {busy ? 'Drafting…' : 'Draft self-assessment'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-subtle pt-3">
      <Banner
        tone="warning"
        title="A draft to edit, not a submission."
        description="Written from the evidence this platform holds, for a QA officer to rewrite. It makes no compliance claim and no AUN-QA rating, and an assessor will ask for the evidence behind every sentence you keep."
      />
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
        {draft.paragraph}
      </p>

      {draft.gaps.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-text-tertiary">
            Sub-criteria this draft could not evidence — you would have to supply these yourself
          </span>
          <ul className="flex flex-col gap-1">
            {draft.gaps.map((g) => (
              <li
                key={g.subCriterionId}
                className="flex flex-col gap-0.5 rounded-md border border-subtle bg-surface-2 px-2.5 py-1.5 text-xs"
              >
                {/* The id sits on its own line rather than beside the
                    sentence: an identifier butted against prose reads as
                    one token, and this is the list a QA officer works
                    from. */}
                <span className="font-tabular font-medium text-text-primary">
                  Sub-criterion {g.subCriterionId}
                </span>
                <span className="text-text-secondary">{g.missing}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
        <ConfidenceBadge value={draft.confidence} />
        <span className="font-tabular">{draft.methodVersion}</span>
        <span>
          grounded in {draft.subCriteriaWithEvidence} of {draft.subCriteriaTotal} sub-criteria
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Button size="xs" variant="ghost" onClick={() => setReasoningOpen((v) => !v)}>
            {reasoningOpen ? 'Hide reasoning' : 'Show reasoning'}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDisagreeOpen(true)}>
            Disagree
          </Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={onGenerate}>
            {busy ? 'Drafting…' : 'Redraft'}
          </Button>
        </span>
      </div>

      {sources.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-text-tertiary">Sources</span>
          <ul className="ml-4 list-disc text-xs text-text-secondary">
            {sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {reasoningOpen && (
        <div className="flex flex-col gap-2 rounded-md border border-subtle bg-surface-2 p-3">
          <span className="text-xs uppercase tracking-wide text-text-tertiary">
            Every channel handed to the model, and whether it resolved
          </span>
          <ul className="flex flex-col gap-1.5 text-xs">
            {channels.map(([key, ev]) => (
              <li key={key} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-tabular text-text-primary">{key}</span>
                  <span
                    className={
                      ev.available ? 'text-success' : 'font-medium text-text-tertiary'
                    }
                  >
                    {ev.available ? 'available' : 'no evidence'}
                  </span>
                </span>
                <span className="text-text-tertiary">{ev.sourceLabel}</span>
                {ev.caveat && <span className="text-warning">{ev.caveat}</span>}
              </li>
            ))}
          </ul>
          <p className="text-text-tertiary">
            The model saw the unavailable channels too — it cannot name what is missing unless it is
            shown what was looked for.
          </p>
          {draft.aiInferenceId && (
            <p className="text-xs text-text-tertiary">
              Logged in <span className="font-tabular">ai_inferences</span> as{' '}
              <span className="font-tabular">{draft.aiInferenceId}</span> — the full prompt and
              response are on that row.
            </p>
          )}
        </div>
      )}

      {disagreeOpen && (
        <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-subtle p-3">
          <div className="text-sm font-semibold">Disagreement with this draft</div>
          <textarea
            className="rounded-md border border-default bg-surface-0 p-2 text-sm"
            rows={3}
            value={disagreeText}
            onChange={(e) => setDisagreeText(e.target.value)}
            placeholder="What is wrong, missing or overclaimed? Specifics help the next prompt version."
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="danger" onClick={() => void onSubmitDisagreement()}>
              Submit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDisagreeOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── One criterion ─────────────────────────────────────────────────────

function CriterionBlock({
  programId,
  criterion,
  dqModules,
  draft,
  busy,
  onGenerate,
}: {
  programId: string;
  criterion: AunqaCriterion;
  dqModules: DqModule[];
  draft: AunqaNarrativeDraft | null;
  busy: boolean;
  onGenerate: () => void;
}) {
  // A channel bound by several sub-criteria of the same criterion resolves
  // once and is rendered once — the repeat carries a pointer to where the
  // figure is, rather than the figure four times over.
  const shownAt = new Map<string, string>();

  return (
    <Section
      id={`criterion-${criterion.criterionId}`}
      title={`Criterion ${criterion.criterionId} — ${criterion.title}`}
      description={`${criterion.subCriteriaWithEvidence} of ${criterion.subCriteriaTotal} sub-criteria have data`}
      actions={<BandBadge band={criterion.band} />}
    >
      <Card>
        <ul className="flex flex-col gap-5">
          {criterion.subCriteria.map((sub) => {
            const available = sub.evidence.filter((e) => e.available);
            const missing = sub.evidence.filter((e) => !e.available);
            return (
              <li key={sub.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-tabular text-sm font-semibold text-text-primary">
                    {sub.id}
                  </span>
                  <span className="text-sm text-text-primary">{sub.title}</span>
                  {sub.hasEvidence ? (
                    <Badge tone="success" size="sm">
                      evidenced
                    </Badge>
                  ) : (
                    <Badge tone="neutral" size="sm">
                      no evidence
                    </Badge>
                  )}
                </div>

                {available.map((ev) => {
                  const key = channelKey(ev.binding);
                  const first = shownAt.get(key);
                  if (first !== undefined) {
                    return (
                      <p key={key} className="text-xs text-text-tertiary">
                        {channelLabel(ev.binding)} — the same figure as under {first} above.
                      </p>
                    );
                  }
                  shownAt.set(key, sub.id);
                  return <AvailableEvidence key={key} ev={ev} dqModules={dqModules} />;
                })}

                {missing.map((ev) => (
                  <MissingEvidence key={channelKey(ev.binding)} ev={ev} />
                ))}
              </li>
            );
          })}
        </ul>

        <div className="mt-5">
          <NarrativeDraft
            programId={programId}
            criterion={criterion}
            draft={draft}
            busy={busy}
            onGenerate={onGenerate}
          />
        </div>
      </Card>
    </Section>
  );
}

// ── The page body ─────────────────────────────────────────────────────

export function AunqaProgramClient({
  analysis,
  dqModules,
  generateNarrative,
}: {
  analysis: AunqaProgramAnalysis;
  dqModules: DqModule[];
  generateNarrative: GenerateNarrative;
}) {
  const [drafts, setDrafts] = React.useState<Record<string, AunqaNarrativeDraft>>({});
  const [busyCriterion, setBusyCriterion] = React.useState<string | null>(null);

  // Never fired on page load, and never for every criterion at once: one
  // criterion per call, because that is how a QA officer writes one up and
  // because six calls per programme across 301 programmes has no reader.
  const onGenerate = React.useCallback(
    (criterionId: string) => {
      setBusyCriterion(criterionId);
      void generateNarrative(criterionId)
        .then((r) => {
          if (r.ok) {
            setDrafts((prev) => ({ ...prev, [criterionId]: r.draft }));
          } else {
            toast.error(r.message);
          }
        })
        .catch((e: unknown) => {
          toast.error(e instanceof Error ? e.message : 'Could not draft the self-assessment');
        })
        .finally(() => setBusyCriterion(null));
    },
    [generateNarrative],
  );

  const shown = analysis.criteria.filter((c) => c.subCriteriaWithEvidence > 0);
  const omitted = analysis.criteria.filter((c) => c.subCriteriaWithEvidence === 0);

  // Completeness is counted over the WHOLE registry, including the criteria
  // omitted below. Counting only what is on screen would flatter a thin
  // programme by dropping its emptiest criteria out of its own denominator.
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-text-tertiary">
              Evidence completeness
            </span>
            <span className="font-tabular text-3xl font-semibold text-text-primary">
              {analysis.subCriteriaWithEvidence} of {analysis.subCriteriaTotal}
            </span>
            <span className="text-sm text-text-secondary">
              sub-criteria across the {analysis.criteria.length} criteria this platform can
              evidence
            </span>
          </div>
          <BandBadge band={analysis.band} />
        </div>
        <p className="mt-4 text-sm text-text-secondary">
          These counts describe <span className="font-medium text-text-primary">our data</span>, not
          the programme. &ldquo;Well-evidenced&rdquo; means the platform holds evidence for most of
          a criterion&apos;s sub-criteria; it says nothing about how well the programme teaches. No
          AUN-QA rating is produced here or anywhere in this platform — assessors award those.
        </p>
        <p className="mt-2 text-xs text-text-tertiary">
          The criteria list has not been checked against the published AUN-QA v4 guide, and no
          curriculum document sampled at KKU names AUN-QA as its framework. Organising this
          evidence along these criteria is an analytical overlay, not a claim the programme makes.
        </p>
      </Card>

      {shown.map((criterion) => (
        <CriterionBlock
          key={criterion.criterionId}
          programId={analysis.program.id}
          criterion={criterion}
          dqModules={dqModules}
          draft={drafts[criterion.criterionId] ?? null}
          busy={busyCriterion === criterion.criterionId}
          onGenerate={() => onGenerate(criterion.criterionId)}
        />
      ))}

      {shown.length === 0 && (
        <Card>
          <p className="text-sm text-text-secondary">
            The platform holds no evidence for any criterion of this programme. Nothing here is a
            zero — every channel was looked for and none resolved.
          </p>
        </Card>
      )}

      {/* One line at the foot, naming what is not on this page — so a
          reader cannot infer that what they see is the whole framework. */}
      <Card padding="sm" className="bg-surface-0">
        <p className="text-xs leading-relaxed text-text-tertiary">
          <span className="font-medium text-text-secondary">Not shown above:</span>{' '}
          {omitted.length > 0 && (
            <>
              {omitted.map((c, i) => (
                <React.Fragment key={c.criterionId}>
                  {i > 0 && ', '}
                  criterion {c.criterionId} ({c.title})
                </React.Fragment>
              ))}
              {omitted.length === 1
                ? ' is omitted because the platform resolved no evidence for it for this programme'
                : ' are omitted because the platform resolved no evidence for them for this programme'}
              ;{' '}
            </>
          )}
          {analysis.unevidencedCriteria.map((c, i) => (
            <React.Fragment key={c.id}>
              {i > 0 && ' and '}
              criterion {c.id} ({c.title})
            </React.Fragment>
          ))}
          {analysis.unevidencedCriteria.length === 1 ? ' is' : ' are'} outside this platform&apos;s
          data for every programme —{' '}
          {analysis.unevidencedCriteria.map((c) => c.whyAbsent).join(' ')}
        </p>
      </Card>
    </div>
  );
}
