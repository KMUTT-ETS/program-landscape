'use client';

import * as React from 'react';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Section,
  Skeleton,
} from '@kku/ui';
import { BookOpen, Camera, GraduationCap, Sparkles, Globe2, Award } from 'lucide-react';
import type { ProfileData, PublicationEntry } from '@/lib/profile-types';
import { formatApa } from '@/lib/profile-types';
import { AvatarUploader } from './avatar-uploader';

// Profile-page client component. Owns:
//   - TH/EN toggle (visible string flips, but the data-bilingual fields
//     show whichever language matches the toggle).
//   - Lazy-loaded AI expertise narrative (POST /api/profile-narrative).
//
// All static data comes pre-rendered from the server component.

type Lang = 'th' | 'en';

interface NarrativeResponse {
  narrative: {
    narrativeTh: string;
    narrativeEn: string;
    expertiseKeywordsTh: string[];
    expertiseKeywordsEn: string[];
    confidence: number;
  };
}

const T = {
  th: {
    pageTitle: 'โปรไฟล์ของฉัน',
    pageSubtitle: 'ประวัติและผลงานทางวิชาการ',
    notProvisioned:
      'ยังไม่พบบันทึกบุคลากรของคุณในระบบ — ระบบจะเชื่อมโยงข้อมูลจากฝ่ายทรัพยากรบุคคลในการเข้าใช้งานครั้งถัดไป หากปัญหายังคงอยู่กรุณาติดต่อผู้ดูแลระบบ',
    sectionAbout: 'สรุปความเชี่ยวชาญ',
    sectionAboutHelp: 'สังเคราะห์โดย AI จากประวัติการศึกษาและผลงานวิจัย',
    sectionEducation: 'ประวัติการศึกษา',
    sectionResearch: 'สรุปผลงานวิจัย',
    sectionCurriculum: 'หลักสูตรที่รับผิดชอบ',
    sectionPublications: 'รายการผลงานตีพิมพ์',
    publicationsHelp: 'รูปแบบ APA · เรียงจากใหม่ไปเก่า',
    statPapers: 'ผลงาน',
    statCitations: 'การอ้างอิง',
    statYearsActive: 'ปีที่ผลิตผลงาน',
    statPeakYear: 'ปีที่ผลิตมากที่สุด',
    rolesGroup: 'บทบาท',
    role_COORDINATOR: 'อาจารย์ผู้รับผิดชอบหลักสูตร',
    role_CORE: 'อาจารย์ประจำหลักสูตร',
    role_SUPPORT: 'อาจารย์ผู้สอน',
    generateNarrative: 'สรุปด้วย AI',
    regenerate: 'สร้างใหม่',
    generating: 'กำลังสรุป…',
    publishedIn: 'ในวารสาร',
    citations: 'การอ้างอิง',
    noEducation: 'ยังไม่มีบันทึกประวัติการศึกษา',
    noResearch: 'ยังไม่มีบันทึกผลงานวิจัย',
    noCurriculum: 'ยังไม่มีบันทึกการรับผิดชอบหลักสูตร',
    noPublications: 'ยังไม่มีรายการผลงานตีพิมพ์',
    yearsLabel: 'ปี',
    expertiseKeywords: 'คำสำคัญ',
    facultyLabel: 'คณะ',
    departmentLabel: 'ภาควิชา',
    languageToggle: 'EN',
    languageToggleAria: 'เปลี่ยนเป็นภาษาอังกฤษ',
  },
  en: {
    pageTitle: 'My profile',
    pageSubtitle: 'Academic resume and research record',
    notProvisioned:
      'Your staff record is not yet linked in the system — it will be reconciled from HR on your next sign-in. Contact your administrator if the issue persists.',
    sectionAbout: 'Expertise summary',
    sectionAboutHelp: 'Synthesised by AI from education and research record',
    sectionEducation: 'Education',
    sectionResearch: 'Research summary',
    sectionCurriculum: 'Programs taught',
    sectionPublications: 'Publications',
    publicationsHelp: 'APA format · most recent first',
    statPapers: 'Papers',
    statCitations: 'Citations',
    statYearsActive: 'Years active',
    statPeakYear: 'Peak year',
    rolesGroup: 'Role',
    role_COORDINATOR: 'Program coordinator',
    role_CORE: 'Core faculty',
    role_SUPPORT: 'Teaching faculty',
    generateNarrative: 'Summarise with AI',
    regenerate: 'Regenerate',
    generating: 'Summarising…',
    publishedIn: 'in',
    citations: 'citations',
    noEducation: 'No education record on file',
    noResearch: 'No research output recorded',
    noCurriculum: 'Not currently listed on any program',
    noPublications: 'No publications recorded',
    yearsLabel: 'years',
    expertiseKeywords: 'Keywords',
    facultyLabel: 'Faculty',
    departmentLabel: 'Department',
    languageToggle: 'TH',
    languageToggleAria: 'Switch to Thai',
  },
} as const;

const ROLE_ORDER: Array<'COORDINATOR' | 'CORE' | 'SUPPORT'> = [
  'COORDINATOR',
  'CORE',
  'SUPPORT',
];

export function ProfileView({
  profile,
  userEmail,
}: {
  profile: ProfileData | null;
  userEmail: string;
}) {
  const [lang, setLang] = React.useState<Lang>('en');
  const t = T[lang];

  if (!profile) {
    return (
      <>
        <PageHeader
          title={t.pageTitle}
          subtitle={t.pageSubtitle}
          actions={<LangToggle lang={lang} onChange={setLang} />}
        />
        <Section>
          <EmptyState
            title={lang === 'th' ? 'ไม่พบบันทึก' : 'No record found'}
            description={t.notProvisioned}
          />
        </Section>
      </>
    );
  }

  const fullName =
    lang === 'th' ? profile.basic.fullNameTh : profile.basic.fullNameEn;
  const rankLabel =
    lang === 'th' ? profile.basic.rankLabelTh : profile.basic.rankLabelEn;
  const facultyName =
    lang === 'th'
      ? profile.basic.facultyNameTh
      : profile.basic.facultyNameEn;
  const deptName =
    lang === 'th'
      ? profile.basic.departmentNameTh
      : profile.basic.departmentNameEn;

  return (
    <>
      <PageHeader
        title={t.pageTitle}
        subtitle={t.pageSubtitle}
        actions={<LangToggle lang={lang} onChange={setLang} />}
      />

      <ProfileHero
        fullName={fullName}
        rankLabel={rankLabel}
        facultyName={facultyName}
        departmentName={deptName}
        email={userEmail}
        orcid={profile.basic.orcid}
        scopusAuthorId={profile.basic.scopusAuthorId}
        avatarUrl={profile.basic.avatarUrl}
        t={t}
      />

      <ExpertiseNarrativeSection
        lang={lang}
        t={t}
        hasFacultyMember={profile.hasFacultyMemberRecord}
        initial={profile.cachedNarrative}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <EducationSection
            education={profile.education}
            lang={lang}
            t={t}
          />
          <ResearchSummarySection research={profile.research} t={t} />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <CurriculumSection curriculum={profile.curriculum} lang={lang} t={t} />
          <PublicationsSection publications={profile.publications} t={t} />
        </div>
      </div>
    </>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────

function ProfileHero({
  fullName,
  rankLabel,
  facultyName,
  departmentName,
  email,
  orcid,
  scopusAuthorId,
  avatarUrl,
  t,
}: {
  fullName: string;
  rankLabel: string;
  facultyName: string | null;
  departmentName: string | null;
  email: string;
  orcid: string | null;
  scopusAuthorId: string | null;
  avatarUrl: string | null;
  t: (typeof T)[Lang];
}) {
  const initials = fullName
    .replace(/^(ผศ\.|รศ\.|ศ\.|ดร\.|อ\.|Asst\.|Assoc\.|Prof\.|Dr\.|Lect\.)\s*/gi, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  const [editorOpen, setEditorOpen] = React.useState(false);

  return (
    <Card className="relative mb-6 overflow-hidden" elevation="lg">
      {/* Decorative gradient backdrop — large soft coral wash on the
          right edge gives the hero a sense of depth without competing
          with content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent-subtle/40 via-transparent to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-default/10 blur-3xl"
      />
      <div className="relative flex flex-col gap-7 p-7 md:flex-row md:items-start">
        {/* Avatar — 216×216 (240 × 0.9). Hero anchor sized to feel
            substantial without crowding the text. Both parent and
            image carry the same explicit Tailwind size (no
            `h-full w-full` percentage). */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setEditorOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setEditorOpen(true);
            }
          }}
          aria-label="Change profile photo"
          className="group relative block h-[216px] w-[216px] shrink-0 cursor-pointer overflow-hidden rounded-full ring-4 ring-surface-1 shadow-[0_8px_24px_-6px_rgb(255_140_70/0.55)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-default/60"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              width={216}
              height={216}
              className="block h-[216px] w-[216px] object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-[216px] w-[216px] items-center justify-center bg-gradient-to-br from-accent-default to-accent-hover text-6xl font-bold uppercase tracking-wider text-accent-fg"
            >
              {initials || fullName.slice(0, 1).toUpperCase()}
            </span>
          )}
          {/* Hover/focus overlay — gentle dim + Camera icon. */}
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all duration-fast group-hover:bg-black/40 group-hover:opacity-100 group-focus-visible:bg-black/40 group-focus-visible:opacity-100"
          >
            <Camera className="h-11 w-11" strokeWidth={1.6} />
          </span>
        </div>

        <AvatarUploader
          currentAvatarUrl={avatarUrl}
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
        />

        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-text-primary md:text-[2rem] md:leading-tight">
            {fullName}
          </h1>
          <p className="mt-1.5 text-sm font-medium uppercase tracking-[0.08em] text-accent-default">
            {rankLabel}
          </p>

          {/* Detail grid — uniform alignment via `grid` columns rather
              than per-row flex (which was breaking the email row). */}
          <dl className="mt-5 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr_max-content_1fr] sm:gap-x-6">
            {facultyName && (
              <>
                <dt className="text-text-tertiary">{t.facultyLabel}</dt>
                <dd className="font-medium text-text-primary">{facultyName}</dd>
              </>
            )}
            {departmentName && (
              <>
                <dt className="text-text-tertiary">{t.departmentLabel}</dt>
                <dd className="font-medium text-text-primary">{departmentName}</dd>
              </>
            )}
            <dt className="text-text-tertiary">Email</dt>
            <dd className="truncate font-medium text-text-primary">
              <a
                href={`mailto:${email}`}
                className="hover:text-accent-default hover:underline"
              >
                {email}
              </a>
            </dd>
            {orcid && (
              <>
                <dt className="text-text-tertiary">ORCID</dt>
                <dd className="font-mono text-xs text-text-primary">
                  <a
                    href={`https://orcid.org/${orcid}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent-default hover:underline"
                  >
                    {orcid}
                  </a>
                </dd>
              </>
            )}
            {scopusAuthorId && (
              <>
                <dt className="text-text-tertiary">Scopus ID</dt>
                <dd className="font-mono text-xs text-text-primary">
                  {scopusAuthorId}
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>
    </Card>
  );
}

// ─── Expertise narrative (lazy-loaded AI) ────────────────────────────────

function ExpertiseNarrativeSection({
  lang,
  t,
  hasFacultyMember,
  initial,
}: {
  lang: Lang;
  t: (typeof T)[Lang];
  hasFacultyMember: boolean;
  initial: ProfileData['cachedNarrative'];
}) {
  const [data, setData] = React.useState<NarrativeResponse['narrative'] | null>(
    initial
      ? {
          narrativeTh: initial.narrativeTh,
          narrativeEn: initial.narrativeEn,
          expertiseKeywordsTh: initial.expertiseKeywordsTh,
          expertiseKeywordsEn: initial.expertiseKeywordsEn,
          confidence: initial.confidence,
        }
      : null,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const generate = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/profile-narrative', { method: 'POST' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const body = (await res.json()) as NarrativeResponse;
      setData(body.narrative);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fire on first mount when no cached narrative exists. Guard
  // against React StrictMode double-mount in dev with a ref so we
  // don't burn a duplicate AI call.
  const autoFiredRef = React.useRef(false);
  React.useEffect(() => {
    if (autoFiredRef.current) return;
    if (data || !hasFacultyMember) return;
    autoFiredRef.current = true;
    void generate();
  }, [data, hasFacultyMember, generate]);

  const showInitialState = !data && !loading && !error;

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-default" aria-hidden />
          {t.sectionAbout}
        </span>
      }
      description={t.sectionAboutHelp}
    >
      <Card
        className="relative overflow-hidden p-6"
        elevation="lg"
      >
        {/* Subtle gradient accent — frames the AI block as a featured panel. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-default/40 to-transparent"
        />
        {showInitialState && hasFacultyMember && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
            <p className="pt-2 text-xs text-text-tertiary">{t.generating}</p>
          </div>
        )}

        {showInitialState && !hasFacultyMember && (
          <p className="text-sm text-text-secondary">
            {lang === 'th'
              ? 'AI ยังไม่มีข้อมูลเพียงพอที่จะสร้างบทสรุปได้ — ระบบจะเชื่อมโยงข้อมูลของคุณในการเข้าใช้งานครั้งถัดไป'
              : 'AI does not yet have enough record to summarise — your data will be linked on the next sign-in.'}
          </p>
        )}

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
            <Skeleton className="h-4 w-9/12" />
            <p className="pt-2 text-xs text-text-tertiary">{t.generating}</p>
          </div>
        )}

        {error && !loading && (
          <div className="text-sm text-danger-default">
            {error}
            <button
              type="button"
              onClick={generate}
              className="ml-2 underline"
            >
              retry
            </button>
          </div>
        )}

        {data && !loading && (
          <div className="space-y-4">
            <p className="whitespace-pre-line text-[0.95rem] leading-relaxed text-text-primary">
              {lang === 'th' ? data.narrativeTh : data.narrativeEn}
            </p>
            {((lang === 'th' ? data.expertiseKeywordsTh : data.expertiseKeywordsEn) ?? [])
              .length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="text-xs uppercase tracking-wider text-text-tertiary">
                  {t.expertiseKeywords}:
                </span>
                {(lang === 'th'
                  ? data.expertiseKeywordsTh
                  : data.expertiseKeywordsEn
                ).map((k) => (
                  <Badge key={k} tone="accent">
                    {k}
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-3 pt-2 text-xs">
              {initial && (
                <span className="text-text-tertiary">
                  {lang === 'th' ? 'อัปเดตล่าสุด' : 'Last updated'}{' '}
                  {formatRelativeTime(initial.generatedAt, lang)}
                </span>
              )}
              <button
                type="button"
                onClick={generate}
                className="ml-auto text-text-tertiary underline hover:text-accent-default"
              >
                {t.regenerate}
              </button>
            </div>
          </div>
        )}
      </Card>
    </Section>
  );
}

function formatRelativeTime(iso: string, lang: Lang): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return lang === 'th' ? 'เมื่อสักครู่' : 'just now';
  if (minutes < 60) return lang === 'th' ? `${minutes} นาทีที่แล้ว` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return lang === 'th' ? `${hours} ชั่วโมงที่แล้ว` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return lang === 'th' ? `${days} วันที่แล้ว` : `${days}d ago`;
  const months = Math.round(days / 30);
  return lang === 'th' ? `${months} เดือนที่แล้ว` : `${months}mo ago`;
}

// ─── Education ───────────────────────────────────────────────────────────

function EducationSection({
  education,
  lang,
  t,
}: {
  education: ProfileData['education'];
  lang: Lang;
  t: (typeof T)[Lang];
}) {
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-text-tertiary" aria-hidden />
          {t.sectionEducation}
        </span>
      }
    >
      <Card className="p-5">
        {education.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t.noEducation}</p>
        ) : (
          <ol className="space-y-4">
            {education.map((entry, i) => (
              <li
                key={i}
                className="flex flex-col gap-1 border-b border-border-subtle pb-3 last:border-b-0 last:pb-0"
              >
                <span className="text-sm font-semibold text-text-primary">
                  {entry.qualification}
                </span>
                {entry.major && entry.major !== entry.qualification && (
                  <span className="text-xs text-text-secondary">
                    {entry.major}
                  </span>
                )}
                {entry.institute && (
                  <span className="text-xs text-text-tertiary">
                    {entry.institute}
                    {entry.countryCode && ` · ${entry.countryCode}`}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {education.some((e) => e.source === 'fallback') && (
          <p className="mt-3 text-[11px] text-text-tertiary">
            {lang === 'th'
              ? 'ข้อมูลจากระบบ HR (ระบบ UNICON DS2003 ไม่พบบันทึก)'
              : 'Source: HR free-text qualification (UNICON DS2003 record not yet linked)'}
          </p>
        )}
      </Card>
    </Section>
  );
}

// ─── Research summary ────────────────────────────────────────────────────

function ResearchSummarySection({
  research,
  t,
}: {
  research: ProfileData['research'];
  t: (typeof T)[Lang];
}) {
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Award className="h-4 w-4 text-text-tertiary" aria-hidden />
          {t.sectionResearch}
        </span>
      }
    >
      <Card className="p-5" elevation="lg">
        {research.totalPapers === 0 ? (
          <p className="text-sm text-text-tertiary">{t.noResearch}</p>
        ) : (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-3">
              <StatTile
                label={t.statPapers}
                value={research.totalPapers.toLocaleString()}
                accent
              />
              <StatTile
                label={t.statCitations}
                value={research.totalCitations.toLocaleString()}
              />
              <StatTile
                label={t.statYearsActive}
                value={
                  research.yearsActive
                    ? `${research.yearsActive}`
                    : '—'
                }
                suffix={research.yearsActive ? t.yearsLabel : undefined}
              />
              <StatTile
                label={t.statPeakYear}
                value={research.peakYear ? `${research.peakYear}` : '—'}
                suffix={
                  research.peakYear
                    ? `${research.peakYearCount} papers`
                    : undefined
                }
              />
            </dl>
            {research.topVenues.length > 0 && (
              <div className="border-t border-border-subtle pt-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
                  Top venues
                </h3>
                <ul className="mt-3 space-y-2">
                  {research.topVenues.map((v) => (
                    <li
                      key={v.venue}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 truncate text-text-primary">
                        {v.venue}
                      </span>
                      <Badge tone="neutral" size="sm">
                        {v.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>
    </Section>
  );
}

function StatTile({
  label,
  value,
  suffix,
  accent = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        'rounded-lg border border-border-subtle p-3 transition-colors ' +
        (accent
          ? 'bg-gradient-to-br from-accent-subtle/50 to-transparent'
          : 'bg-surface-2/40')
      }
    >
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
        {label}
      </dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        <span
          className={
            'text-2xl font-bold tabular-nums leading-none ' +
            (accent ? 'text-accent-default' : 'text-text-primary')
          }
        >
          {value}
        </span>
        {suffix && (
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
            {suffix}
          </span>
        )}
      </dd>
    </div>
  );
}

// ─── Curriculum ──────────────────────────────────────────────────────────

function CurriculumSection({
  curriculum,
  lang,
  t,
}: {
  curriculum: ProfileData['curriculum'];
  lang: Lang;
  t: (typeof T)[Lang];
}) {
  const grouped = React.useMemo(() => {
    const out: Record<
      'COORDINATOR' | 'CORE' | 'SUPPORT',
      ProfileData['curriculum']
    > = {
      COORDINATOR: [],
      CORE: [],
      SUPPORT: [],
    };
    for (const c of curriculum) out[c.role].push(c);
    return out;
  }, [curriculum]);

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-text-tertiary" aria-hidden />
          {t.sectionCurriculum}
        </span>
      }
    >
      <Card className="p-5">
        {curriculum.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t.noCurriculum}</p>
        ) : (
          <div className="space-y-5">
            {ROLE_ORDER.map((role) => {
              const list = grouped[role];
              if (list.length === 0) return null;
              const roleLabel = t[`role_${role}` as const];
              return (
                <div key={role}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    {roleLabel} ({list.length})
                  </h3>
                  <ul className="divide-y divide-border-subtle">
                    {list.map((p) => (
                      <li
                        key={p.programId}
                        className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-text-primary">
                            {lang === 'th' ? p.nameTh : p.nameEn}
                          </div>
                          <div className="text-xs text-text-tertiary">
                            {p.code} ·{' '}
                            {lang === 'th'
                              ? p.facultyNameTh
                              : p.facultyNameEn}
                          </div>
                        </div>
                        <Badge tone="neutral" size="sm" className="self-start sm:self-auto">
                          {prettyLevel(p.level)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </Section>
  );
}

function prettyLevel(level: string): string {
  switch (level) {
    case 'BACHELOR':
      return 'BSc';
    case 'MASTER':
      return 'MSc';
    case 'DOCTORAL':
      return 'PhD';
    case 'HIGHER_GRAD_DIPLOMA':
      return 'Higher Grad. Dip.';
    default:
      return level;
  }
}

// ─── Publications (APA) ──────────────────────────────────────────────────

function PublicationsSection({
  publications,
  t,
}: {
  publications: PublicationEntry[];
  t: (typeof T)[Lang];
}) {
  // Show first 25 on initial render; "show all" reveals the rest. Keeps
  // the page snappy for prolific authors (some KKU faculty have 200+).
  const [showAll, setShowAll] = React.useState(false);
  const displayed = showAll ? publications : publications.slice(0, 25);

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-text-tertiary" aria-hidden />
          {t.sectionPublications} ({publications.length})
        </span>
      }
      description={t.publicationsHelp}
    >
      <Card className="p-5">
        {publications.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t.noPublications}</p>
        ) : (
          <>
            <ol className="space-y-4">
              {displayed.map((p, i) => (
                <li
                  key={p.id}
                  className="flex gap-3 border-b border-border-subtle pb-3 last:border-b-0"
                >
                  <span className="shrink-0 select-none pt-0.5 text-xs tabular-nums text-text-tertiary">
                    [{i + 1}]
                  </span>
                  <div className="min-w-0 flex-1">
                    <PublicationApaLine pub={p} />
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
                      <span className="tabular-nums">{p.year}</span>
                      {p.citations > 0 && (
                        <Badge tone="neutral" size="sm">
                          {p.citations} {t.citations}
                        </Badge>
                      )}
                      <Badge tone="neutral" size="sm">
                        {p.type}
                      </Badge>
                      {p.authors.length > 0 && (
                        <span>
                          {p.authors.length} authors
                        </span>
                      )}
                      {!p.authorsAreComplete && (
                        <span className="italic" title="Co-authors not yet linked from kkuscholar mirror.">
                          (KKU authors only)
                        </span>
                      )}
                      {p.scopusId && (
                        <span className="font-mono">Scopus:{p.scopusId}</span>
                      )}
                      {p.pmid && (
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-accent-default hover:underline"
                        >
                          PubMed:{p.pmid}
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {publications.length > 25 && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAll((s) => !s)}
                  className="text-sm text-accent-default hover:underline"
                >
                  {showAll
                    ? `Show first 25`
                    : `Show all ${publications.length} publications`}
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </Section>
  );
}

function PublicationApaLine({ pub }: { pub: PublicationEntry }) {
  // formatApa returns a string like:
  //   "Author. (Year). Title. *Venue*. https://doi.org/..."
  // Render it with the venue italicised + DOI as a link.
  const apa = formatApa(pub);
  // Split on the first occurrence of "*" pair to recover the venue span.
  const venueMatch = apa.match(/\*([^*]+)\*/);
  const doiMatch = apa.match(/(https:\/\/doi\.org\/\S+)/);
  let head = apa;
  let venue: string | null = null;
  let tail = '';
  if (venueMatch) {
    head = apa.slice(0, venueMatch.index);
    venue = venueMatch[1] ?? null;
    tail = apa.slice((venueMatch.index ?? 0) + venueMatch[0].length);
  }
  let tailText = tail;
  let doiHref: string | null = null;
  if (doiMatch && tail.includes(doiMatch[0])) {
    doiHref = doiMatch[0];
    tailText = tail.replace(doiMatch[0], '').trim();
  }
  return (
    <p className="text-sm leading-relaxed text-text-primary">
      {head}
      {venue && <em className="not-italic font-medium">{venue}</em>}
      {venue && '.'}
      {tailText && ' ' + tailText}
      {doiHref && (
        <>
          {' '}
          <a
            href={doiHref}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-accent-default hover:underline"
          >
            {doiHref}
          </a>
        </>
      )}
    </p>
  );
}

// ─── TH/EN toggle ────────────────────────────────────────────────────────

function LangToggle({
  lang,
  onChange,
}: {
  lang: Lang;
  onChange: (next: Lang) => void;
}) {
  const t = T[lang];
  const next: Lang = lang === 'th' ? 'en' : 'th';
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={t.languageToggleAria}
      aria-label={t.languageToggleAria}
      className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-raised px-2.5 py-1 text-xs font-semibold text-text-primary transition-colors hover:bg-accent-subtle hover:text-accent-default"
    >
      <Globe2 className="h-3.5 w-3.5" aria-hidden />
      {t.languageToggle}
    </button>
  );
}
