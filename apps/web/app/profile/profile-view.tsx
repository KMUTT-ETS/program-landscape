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
import type { AuthorName, ProfileData, PublicationEntry } from '@/lib/profile-types';
import { formatAuthorApa, kkuAuthorsAsAuthorNames } from '@/lib/profile-types';
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
    statHIndex: 'h-index',
    statYearsActive: 'ปีที่ผลิตผลงาน',
    statPeakYear: 'ปีที่ผลิตมากที่สุด',
    statFirstYear: 'ปีแรกที่ตีพิมพ์',
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
    statHIndex: 'h-index',
    statYearsActive: 'Years active',
    statPeakYear: 'Peak year',
    statFirstYear: 'First publication',
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
  publicMode = false,
}: {
  profile: ProfileData | null;
  userEmail: string;
  // When true, render in public-share mode: no email row, no avatar
  // editor, no AI regenerate trigger. Used by /p/[slug].
  publicMode?: boolean;
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
  // Owner surname for highlighting in the publication list — derived
  // from the English name (Latin surname is what shows up in
  // citations from Scopus / OpenAlex / PubMed). Strip honorifics
  // first, then take the last token.
  const ownerSurname = React.useMemo(() => {
    const stripped = profile.basic.fullNameEn.replace(
      /^(Asst\.|Assoc\.|Prof\.|Dr\.|Lect\.)\s*/gi,
      '',
    );
    const stripped2 = stripped.replace(
      /^(Asst\.|Assoc\.|Prof\.|Dr\.|Lect\.)\s*/gi,
      '',
    );
    const tokens = stripped2.trim().split(/\s+/).filter(Boolean);
    return tokens.length > 0
      ? tokens[tokens.length - 1]!.toLocaleLowerCase()
      : null;
  }, [profile.basic.fullNameEn]);
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
        openalexAuthorId={profile.basic.openalexAuthorId}
        avatarUrl={profile.basic.avatarUrl}
        t={t}
        publicMode={publicMode}
      />

      <ExpertiseNarrativeSection
        lang={lang}
        t={t}
        hasFacultyMember={profile.hasFacultyMemberRecord}
        initial={profile.cachedNarrative}
        publicMode={publicMode}
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
          <PublicationsSection
            publications={profile.publications}
            ownerSurname={ownerSurname}
            t={t}
          />
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
  openalexAuthorId,
  avatarUrl,
  t,
  publicMode = false,
}: {
  fullName: string;
  rankLabel: string;
  facultyName: string | null;
  departmentName: string | null;
  email: string;
  orcid: string | null;
  scopusAuthorId: string | null;
  openalexAuthorId: string | null;
  avatarUrl: string | null;
  t: (typeof T)[Lang];
  publicMode?: boolean;
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
      {/* KKU logo — top-right corner, theme-aware. Both image
          variants are rendered; CSS shows the right one based on
          the active theme. The dark variant uses Tailwind's `dark:`
          modifier which resolves against `data-theme="dark"` on
          <html> (configured in tailwind preset). */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-5 top-5 z-10 flex items-start"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/kku-logo-light.png"
          alt=""
          width={42}
          height={75}
          className="block h-20 w-auto opacity-90 dark:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/kku-logo-dark.png"
          alt=""
          width={42}
          height={75}
          className="hidden h-20 w-auto opacity-90 dark:block"
        />
      </div>
      <div className="relative flex flex-col gap-7 p-7 md:flex-row md:items-start">
        {/* Avatar — 216×216 (240 × 0.9). Hero anchor sized to feel
            substantial without crowding the text. Both parent and
            image carry the same explicit Tailwind size (no
            `h-full w-full` percentage). */}
        <div
          {...(publicMode
            ? {}
            : {
                role: 'button',
                tabIndex: 0,
                onClick: () => setEditorOpen(true),
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditorOpen(true);
                  }
                },
                'aria-label': 'Change profile photo',
              })}
          className={`group relative block h-[216px] w-[216px] shrink-0 overflow-hidden rounded-full ring-4 ring-surface-1 shadow-[0_8px_24px_-6px_rgb(255_140_70/0.55)] ${
            publicMode
              ? ''
              : 'cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-default/60'
          }`}
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
          {/* Hover/focus overlay — gentle dim + Camera icon. Hidden in
              publicMode (no upload affordance for public viewers). */}
          {!publicMode && (
            <span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all duration-fast group-hover:bg-black/40 group-hover:opacity-100 group-focus-visible:bg-black/40 group-focus-visible:opacity-100"
            >
              <Camera className="h-11 w-11" strokeWidth={1.6} />
            </span>
          )}
        </div>

        {!publicMode && (
          <AvatarUploader
            currentAvatarUrl={avatarUrl}
            open={editorOpen}
            onClose={() => setEditorOpen(false)}
          />
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-text-primary md:text-[2rem] md:leading-tight">
            {fullName}
          </h1>
          <p className="mt-1.5 text-sm font-medium uppercase tracking-[0.08em] text-accent-default">
            {rankLabel}
          </p>

          {/* Detail grid — uniform alignment via `grid` columns rather
              than per-row flex (which was breaking the email row). */}
          <dl className="mt-5 grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr_max-content_1fr] sm:gap-x-6">
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
            {!publicMode && (
              <>
                <dt className="text-text-tertiary">Email</dt>
                <dd className="truncate font-medium text-text-primary">
                  <a
                    href={`mailto:${email}`}
                    className="hover:text-accent-default hover:underline"
                  >
                    {email}
                  </a>
                </dd>
              </>
            )}
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
                  <a
                    href={`https://www.scopus.com/authid/detail.uri?authorId=${scopusAuthorId}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent-default hover:underline"
                  >
                    {scopusAuthorId}
                  </a>
                </dd>
              </>
            )}
            {openalexAuthorId && (
              <>
                <dt className="text-text-tertiary">OpenAlex ID</dt>
                <dd className="font-mono text-xs text-text-primary">
                  <a
                    href={`https://openalex.org/${openalexAuthorId}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent-default hover:underline"
                  >
                    {openalexAuthorId}
                  </a>
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
  publicMode = false,
}: {
  lang: Lang;
  t: (typeof T)[Lang];
  hasFacultyMember: boolean;
  initial: ProfileData['cachedNarrative'];
  publicMode?: boolean;
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
  // don't burn a duplicate AI call. Skipped in publicMode — public
  // viewers can't authenticate, and we don't burn AI cycles for them.
  const autoFiredRef = React.useRef(false);
  React.useEffect(() => {
    if (publicMode) return;
    if (autoFiredRef.current) return;
    if (data || !hasFacultyMember) return;
    autoFiredRef.current = true;
    void generate();
  }, [data, hasFacultyMember, generate, publicMode]);

  const showInitialState = !data && !loading && !error;

  // In publicMode, hide the entire section if there's no cached
  // narrative — public viewers shouldn't see a "generating…"
  // skeleton or an empty placeholder for content the owner never
  // generated.
  if (publicMode && !data) return null;

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-12 w-12 text-accent-default" aria-hidden />
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
              {!publicMode && (
                <button
                  type="button"
                  onClick={generate}
                  className="ml-auto text-text-tertiary underline hover:text-accent-default"
                >
                  {t.regenerate}
                </button>
              )}
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
          <GraduationCap className="h-12 w-12 text-text-tertiary" aria-hidden />
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
          <Award className="h-12 w-12 text-text-tertiary" aria-hidden />
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
                label={t.statHIndex}
                value={research.hIndex.toLocaleString()}
                accent
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
              <StatTile
                label={t.statFirstYear}
                value={
                  research.earliestYear
                    ? `${research.earliestYear}`
                    : '—'
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
          <BookOpen className="h-12 w-12 text-text-tertiary" aria-hidden />
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
  ownerSurname,
  t,
}: {
  publications: PublicationEntry[];
  ownerSurname: string | null;
  t: (typeof T)[Lang];
}) {
  // Paginated 20 per page. Authors with 100+ papers get a clean
  // page-by-page view instead of one giant scroll. Page index resets
  // to 0 when the publications array reference changes (e.g. after
  // a cache refresh).
  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(publications.length / PAGE_SIZE));
  const [page, setPage] = React.useState(0);
  React.useEffect(() => {
    setPage(0);
  }, [publications]);
  // Clamp the page index — if a refresh shrinks the list, snap back
  // into range without crashing.
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = safePage * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, publications.length);
  const displayed = publications.slice(startIdx, endIdx);

  return (
    <Section
      data-pubs-section=""
      title={
        <span className="flex items-center gap-2">
          <Globe2 className="h-12 w-12 text-text-tertiary" aria-hidden />
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
                    [{startIdx + i + 1}]
                  </span>
                  <div className="min-w-0 flex-1">
                    <PublicationApaLine pub={p} ownerSurname={ownerSurname} />
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
                        <span
                          className="italic"
                          title="Tried kkuscholar, OpenAlex, and Scopus — none returned a co-author list for this paper."
                        >
                          (co-authors could not be fetched)
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
            {totalPages > 1 && (
              <PublicationPager
                page={safePage}
                totalPages={totalPages}
                startIdx={startIdx}
                endIdx={endIdx}
                total={publications.length}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </Card>
    </Section>
  );
}

function PublicationPager({
  page,
  totalPages,
  startIdx,
  endIdx,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  startIdx: number;
  endIdx: number;
  total: number;
  onPageChange: (next: number) => void;
}) {
  // Build a compact page-number row with ellipses for large counts.
  // Strategy: always show first + last; show ±1 around current; "…"
  // bridges the gaps. For ≤7 pages we just list them all.
  const pages: Array<number | 'gap'> = React.useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i);
    }
    const out: Array<number | 'gap'> = [];
    const around = new Set<number>([
      0,
      totalPages - 1,
      page - 1,
      page,
      page + 1,
    ]);
    let last = -2;
    for (let i = 0; i < totalPages; i += 1) {
      if (!around.has(i)) continue;
      if (i - last > 1) out.push('gap');
      out.push(i);
      last = i;
    }
    return out;
  }, [page, totalPages]);

  // Scroll the publication list into view on page change so the
  // user lands at the top of the new page rather than mid-scroll.
  const onPick = (next: number) => {
    if (next === page) return;
    onPageChange(next);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document
          .querySelector('[data-pubs-section]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const btn =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border-subtle px-2 text-xs font-medium text-text-secondary hover:bg-accent-subtle hover:text-accent-default disabled:cursor-not-allowed disabled:opacity-40';
  const btnActive =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-accent-default bg-accent-subtle px-2 text-xs font-semibold text-accent-default';

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-text-tertiary tabular-nums">
        Showing <span className="font-medium text-text-secondary">
          {startIdx + 1}–{endIdx}
        </span>{' '}
        of <span className="font-medium text-text-secondary">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPick(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
          className={btn}
        >
          ‹
        </button>
        {pages.map((p, i) =>
          p === 'gap' ? (
            <span
              key={`gap-${i}`}
              className="px-1 text-xs text-text-tertiary"
              aria-hidden
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPick(p)}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Page ${p + 1}`}
              className={p === page ? btnActive : btn}
            >
              {p + 1}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPick(page + 1)}
          disabled={page >= totalPages - 1}
          aria-label="Next page"
          className={btn}
        >
          ›
        </button>
      </div>
    </div>
  );
}

function PublicationApaLine({
  pub,
  ownerSurname,
}: {
  pub: PublicationEntry;
  /** Lowercased surname of the profile owner — when an author's
   *  family name matches, that author is rendered in <strong> so
   *  readers can spot the owner's position in the byline at a glance. */
  ownerSurname: string | null;
}) {
  // Build the citation directly from the structured author array,
  // bolding the owner. Fall back to legacy `kkuAuthors` strings when
  // the per-paper enrichment didn't populate `authors`.
  const authors: AuthorName[] =
    pub.authors.length > 0 ? pub.authors : kkuAuthorsAsAuthorNames(pub);
  const authorJsx = buildAuthorListJsx(authors, ownerSurname);
  const trailingDot = /[.!?]$/.test(pub.title) ? '' : '.';

  return (
    <p className="text-sm leading-relaxed text-text-primary">
      {authorJsx}
      {`(${pub.year}). ${pub.title}${trailingDot}`}
      {pub.venue && (
        <>
          {' '}
          <em className="not-italic font-medium">{pub.venue}</em>.
        </>
      )}
      {pub.doi && (
        <>
          {' '}
          <a
            href={`https://doi.org/${pub.doi}`}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-accent-default hover:underline"
          >
            {`https://doi.org/${pub.doi}`}
          </a>
        </>
      )}
    </p>
  );
}

/**
 * Render an APA-7 author block as JSX with the owner's name bolded.
 * Mirrors `formatApaAuthorList` from profile-types.ts (commas, &,
 * 21+ ellipsis truncation) but emits React nodes so we can wrap
 * the matching author in <strong>.
 */
function buildAuthorListJsx(
  authors: AuthorName[],
  ownerSurname: string | null,
): React.ReactNode {
  if (authors.length === 0) return null;
  const items = authors
    .map((a) => ({
      text: formatAuthorApa(a),
      isOwner: isOwnerAuthor(a, ownerSurname),
    }))
    .filter((it) => it.text.length > 0);
  if (items.length === 0) return null;

  // APA 7 §9.8: 21+ authors → first 19, ..., last.
  const useEllipsis = items.length > 20;
  const display = useEllipsis ? [...items.slice(0, 19), items[items.length - 1]!] : items;

  const parts: React.ReactNode[] = [];
  display.forEach((item, i) => {
    parts.push(
      item.isOwner ? (
        <strong key={`a${i}`} className="font-semibold">
          {item.text}
        </strong>
      ) : (
        <React.Fragment key={`a${i}`}>{item.text}</React.Fragment>
      ),
    );
    if (i < display.length - 1) {
      const isSecondToLast = i === display.length - 2;
      const sep = isSecondToLast
        ? useEllipsis
          ? ', ... '
          : ', & ' /* serial-Oxford comma + ampersand */
        : ', ';
      parts.push(<React.Fragment key={`s${i}`}>{sep}</React.Fragment>);
    }
  });
  // Trailing period before "(Year)".
  parts.push(<React.Fragment key="trail">. </React.Fragment>);
  return parts;
}

function isOwnerAuthor(a: AuthorName, ownerSurname: string | null): boolean {
  if (!ownerSurname) return false;
  const normalised = (a.family ?? '').trim().toLocaleLowerCase();
  return normalised.length > 0 && normalised === ownerSurname;
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
