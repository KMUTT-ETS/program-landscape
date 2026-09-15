'use client';

import { memo, useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Badge,
  Card,
  FreshnessBadge,
  ProvenanceButton,
  RightPanel,
  Segmented,
  SegmentedList,
  SegmentedTrigger,
  TrendLine,
} from '@kku/ui';
import type { ApiMeta } from '@kku/shared';
import { USAGE_FALLBACK_META } from './types';
import type {
  FacultyOptionT,
  ProgramUsageT,
  ProgramViewerT,
  UsageActivity,
  UsageData,
  UserTimelineT,
  UserUsageT,
} from './types';

// ─────────────────────────────────────────────────────────────────────────
// Platform usage — every section renders from data the server already
// fetched. `UsageSections` is a pure function of `UsageData` precisely so a
// test can render it without a DOM, a session or the api; `UsageClient` adds
// the two things that genuinely need the browser — the URL-backed window
// controls, and the two drill-down panels.
//
// The drill-downs go through the web route handlers under
// /api/usage-detail/*, not straight at /api/v1: dev has no reverse proxy in
// front of NestJS, so a same-origin browser call to /api/v1 404s there while
// working in prod. Same reasoning as the page-view beacon's proxy.
//
// Design follows the evidence-page language: the data card is the quietest
// layer, its number is the loud one, and absent data is grey rather than red
// — a section with nothing in it describes OUR recording coverage, not a
// failure of the thing being measured.
// ─────────────────────────────────────────────────────────────────────────

// Exported so a test can pin this map to USAGE_MODULES: the route-coverage
// guard only stops a new folder landing in `other`, it does not stop a new
// module rendering here as a raw slug.
export const MODULE_LABEL: Record<string, string> = {
  home: 'Home',
  cockpit: 'Portfolio Cockpit',
  'deep-dive': 'Program Deep-Dive',
  gap: 'Gap Analyzer',
  benchmarking: 'Benchmarking',
  scenarios: 'Scenario Planner',
  decisions: 'Decisions',
  analyst: 'AI Analyst',
  trends: 'Trends Radar',
  risk: 'Risk Management',
  education: 'Education',
  staff: 'Staff',
  skills: 'Skills',
  'teaching-learning': 'Teaching & Learning',
  dashboards: 'Dashboards',
  admin: 'Admin console',
  docs: 'Reference',
  profile: 'Profile',
  'public-profile': 'Public profile',
  inbox: 'Inbox',
  usage: 'Platform usage',
  other: 'Other',
};

const FAMILY_LABEL: Record<string, string> = {
  export: 'PDF exports',
  'ai-brief': 'AI briefs',
  scenario: 'Scenario edits',
  decision: 'Decision workspace',
  pipeline: 'Pipeline runs',
  upload: 'Uploads',
  other: 'Other actions',
};

const WINDOW_LABEL: Record<number, string> = {
  7: '7 days',
  30: '30 days',
  90: '90 days',
  365: '1 year',
};

function pct(cur: number, prev: number): string {
  if (prev === 0) return cur === 0 ? 'no change' : 'none in the previous window';
  const change = Math.round(((cur - prev) / prev) * 100);
  return `${change >= 0 ? '+' : ''}${change}% vs previous window`;
}

/** The unit word that separates a count from the next one. Never drop it —
 *  two bare tabular numbers side by side read as a single value. */
function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/** "1 person", "4 people" — `plural()` cannot reach an irregular plural. */
function people(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`;
}

/** The small bordered control used throughout the page's card headers. */
const MINI_BUTTON =
  'rounded-md border border-subtle px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40';

function fmtDwell(ms: number | null): string {
  if (ms === null) return 'not enough data';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sec`;
  return `${Math.floor(s / 60)} min ${s % 60} sec`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * The Bangkok calendar day of an instant.
 *
 * `iso.slice(0, 10)` is the UTC date, which for the seven hours after Bangkok
 * midnight is the PREVIOUS day — so a boundary the rest of the page states in
 * Bangkok days would be stated a day early every evening.
 */
function fmtBangkokDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/**
 * What a failed drill-down actually means, in the reader's own terms.
 *
 * "HTTP 403" tells an administrator looking at a name that is right there on
 * the page nothing about why the detail behind it will not open, and the three
 * cases have genuinely different remedies.
 */
function describeStatus(status: number, subject: 'person' | 'programme'): string {
  if (status === 403) return 'you no longer have permission to see it';
  if (status === 404)
    return subject === 'person'
      ? 'that person is no longer in the directory'
      : 'that programme is no longer in the catalogue';
  if (status === 400) return 'the window is wider than raw page views cover';
  return `HTTP ${status}`;
}

/** Grey, never red — an empty section is a gap in what we recorded. */
function Absent({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-text-tertiary">{children}</p>;
}

/**
 * "The service did not answer" and "nothing was recorded" are different
 * facts, and only one of them is about the platform's usage. A null envelope
 * must never render as an empty one: an aggregate that failed to load would
 * otherwise deny, in the page's own voice, that anybody opened anything.
 */
function Rows<T>({
  envelope,
  what,
  empty,
  children,
}: {
  envelope: { data: T[]; meta: ApiMeta } | null;
  /** Names this card in the unavailable line, e.g. "Module figures". */
  what: string;
  empty: React.ReactNode;
  children: (rows: T[]) => React.ReactNode;
}) {
  if (envelope === null)
    return <Absent>{what} are unavailable — the usage service did not answer.</Absent>;
  if (envelope.data.length === 0) return <Absent>{empty}</Absent>;
  return <>{children(envelope.data)}</>;
}

/**
 * Every section carries its own provenance button and its own freshness
 * stamp, per the Council-readiness rules. The stamp is the page's render
 * time rather than anything from the envelope: `meta.freshnessDate` is null
 * for /usage because none of these figures is an ingested dataset with an
 * "as of" date — they are computed from page_views and audit_logs at read
 * time, so when the page was built IS their freshness.
 */
function SectionHead({
  title,
  note,
  meta,
  computedAt,
  action,
}: {
  title: string;
  /** A node rather than a string: the access log's carries a toggle link. */
  note?: React.ReactNode;
  meta?: ApiMeta;
  computedAt: string;
  /** A filter control for this card, placed beside the freshness stamp. */
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          {meta ? <ProvenanceButton title={title} meta={meta} size="xs" /> : null}
        </div>
        {note ? <p className="mt-1 text-xs text-text-tertiary">{note}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {action}
        <FreshnessBadge freshnessDate={computedAt} label="these figures" />
      </div>
    </div>
  );
}

/**
 * The faculty options for the by-programme filter: the catalogue, plus any
 * faculty the by-viewer-faculty aggregate names that the catalogue does not
 * (a non-ACADEMIC unit whose staff read programme pages), plus the selected
 * id if it is in neither — an unrecognised `?facultyId=` would otherwise
 * leave the select showing a blank row while the list below stayed filtered.
 */
function facultyChoices(data: UsageData): FacultyOptionT[] {
  const byId = new Map<string, FacultyOptionT>();
  for (const f of data.facultyOptions) byId.set(f.id, f);
  for (const f of data.faculties?.data ?? []) {
    if (f.facultyId && !byId.has(f.facultyId)) {
      byId.set(f.facultyId, {
        id: f.facultyId,
        nameEn: f.nameEn ?? f.nameTh ?? f.facultyId,
        nameTh: f.nameTh ?? '',
      });
    }
  }
  if (data.facultyId && !byId.has(data.facultyId)) {
    byId.set(data.facultyId, { id: data.facultyId, nameEn: data.facultyId, nameTh: '' });
  }
  return [...byId.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
}

function Figure({ label, value, delta }: { label: string; value: number; delta: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
        {label}
      </span>
      <span className="font-tabular text-2xl font-semibold leading-none text-text-primary">
        {value.toLocaleString()}
      </span>
      <span className="text-[11px] text-text-tertiary">{delta}</span>
    </div>
  );
}

function UsageSectionsImpl({
  data,
  onOpenUser,
  onOpenProgram,
  onFacultyChange,
  onActivityChange,
  onPageChange,
  searchSlot,
}: {
  data: UsageData;
  onOpenUser?: (u: UserUsageT) => void;
  onOpenProgram?: (p: ProgramUsageT) => void;
  /** '' clears the filter. Omitted when there is no router to navigate with. */
  onFacultyChange?: (facultyId: string) => void;
  /** Switches the access log between people-who-read and everyone-active. */
  onActivityChange?: (activity: UsageActivity) => void;
  /** Moves the access log to a 1-based page. */
  onPageChange?: (page: number) => void;
  /** The access log's search control. It carries the half-typed term, so it
   *  has to be a stateful client leaf — it is passed in rather than rendered
   *  here so this component stays a pure function of `UsageData`. */
  searchSlot?: React.ReactNode;
}) {
  const summary = data.summary?.data;
  const summaryMeta = data.summary?.meta ?? USAGE_FALLBACK_META;
  const windowLabel = WINDOW_LABEL[data.days] ?? `${data.days} days`;
  const choices = facultyChoices(data);
  const selectedFaculty = choices.find((f) => f.id === data.facultyId) ?? null;
  // The access log is paged in SQL, so the rows on screen are one page of
  // `total` — which is why every count in this card comes off the envelope
  // rather than off `rows.length`.
  const usersPage = data.users?.data ?? null;
  const userRows = usersPage?.rows ?? [];
  const userTotal = usersPage?.total ?? 0;
  const signinOnly = usersPage?.signinOnly ?? 0;
  const pageSize = usersPage?.pageSize ?? 25;
  const pageNumber = usersPage?.page ?? 1;
  const firstOnPage = (pageNumber - 1) * pageSize + 1;
  const lastOnPage = (pageNumber - 1) * pageSize + userRows.length;
  // Empty copy has to name the filter that could be producing the emptiness:
  // "nothing was recorded" and "nothing was recorded from the accounts you
  // left in" are different facts, and only the second has a control on screen
  // that changes it.
  const noViews = data.excludeAdmins
    ? 'No page views from non-admin accounts in this window.'
    : 'No page views recorded in this window.';

  return (
    <div className="flex flex-col gap-6">
      {/* ── Summary band ───────────────────────────────────────────── */}
      <Card padding="md">
        <SectionHead
          title={`Activity over the last ${windowLabel}`}
          note={
            summary?.recordedSince
              ? `Page views recorded since ${summary.recordedSince}. Sign-ins come from the audit log, which covers the whole window.`
              : 'No page views have been recorded yet. Sign-ins still come from the audit log.'
          }
          meta={summaryMeta}
          computedAt={data.computedAt}
        />
        {summary ? (
          <>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
              <Figure
                label="Active users"
                value={summary.current.activeUsers}
                delta={pct(summary.current.activeUsers, summary.previous.activeUsers)}
              />
              <Figure
                label="Page views"
                value={summary.current.views}
                delta={pct(summary.current.views, summary.previous.views)}
              />
              <Figure
                label="Sessions"
                value={summary.current.sessions}
                delta={pct(summary.current.sessions, summary.previous.sessions)}
              />
              <Figure
                label="Sign-ins"
                value={summary.current.signins}
                delta={pct(summary.current.signins, summary.previous.signins)}
              />
              <Figure
                label="AI calls"
                value={summary.current.aiCalls}
                delta={pct(summary.current.aiCalls, summary.previous.aiCalls)}
              />
            </div>
            <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-2 border-t border-subtle pt-4 text-xs">
              <div className="flex flex-col gap-0.5">
                <dt className="text-text-tertiary">Sign-ins today</dt>
                <dd className="font-tabular text-text-secondary">
                  {summary.signinsToday.toLocaleString()}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-text-tertiary">Median time on a page</dt>
                <dd className="font-tabular text-text-secondary">
                  {fmtDwell(summary.medianDwellMs)}
                </dd>
              </div>
              {summary.window.rollupFrom ? (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-tertiary">Daily roll-ups used before</dt>
                  <dd className="font-tabular text-text-secondary">
                    {fmtBangkokDay(summary.window.rollupFrom)}
                  </dd>
                </div>
              ) : null}
              {data.canSeeDetail ? (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-tertiary">AI spend</dt>
                  <dd>
                    <Link href="/admin/ai-cost" className="text-accent-default hover:underline">
                      Cost breakdown
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : (
          <Absent>Summary figures are unavailable — the usage service did not answer.</Absent>
        )}
      </Card>

      {/* ── Daily active users ─────────────────────────────────────── */}
      <Card padding="md">
        <SectionHead
          title="Daily active users"
          note="Last 30 Bangkok days, whatever window is selected above. A user is active on a day they viewed a page or signed in."
          meta={summaryMeta}
          computedAt={data.computedAt}
        />
        {!summary ? (
          <Absent>Daily activity is unavailable — the usage service did not answer.</Absent>
        ) : summary.dailyActiveUsers.length === 0 ? (
          <Absent>
            {data.excludeAdmins
              ? 'No activity from non-admin accounts in the last 30 days.'
              : 'No activity recorded in the last 30 days.'}
          </Absent>
        ) : (
          <div className="h-[224px]">
            <TrendLine
              data={summary.dailyActiveUsers.map((d) => ({
                x: d.day.slice(5),
                'Active users': d.users,
                'Sign-ins': d.signins,
              }))}
              series={['Active users', 'Sign-ins']}
              ariaLabel="Daily active users and sign-ins over the last 30 days"
            />
          </div>
        )}
      </Card>

      {/* ── By module ──────────────────────────────────────────────── */}
      <Card padding="md">
        <SectionHead
          title="By module"
          note="Which parts of the platform get opened. Dwell is the time to the next view and is available only for the last 120 days."
          meta={data.modules?.meta ?? USAGE_FALLBACK_META}
          computedAt={data.computedAt}
        />
        <Rows envelope={data.modules} what="Module figures" empty={noViews}>
          {(moduleRows) => {
            const maxModuleViews = Math.max(1, ...moduleRows.map((m) => m.views));
            return (
              <table className="w-full text-sm [&_th]:whitespace-nowrap">
                <thead className="text-left text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                  <tr>
                    <th scope="col" className="py-1 font-semibold">
                      Module
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Views
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Users
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Sessions
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Median dwell
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {moduleRows.map((m) => (
                    <tr key={m.module} className="border-t border-subtle">
                      <td className="py-2 pr-6">
                        <div className="flex items-center gap-4">
                          <span className="w-40 shrink-0 truncate text-text-secondary">
                            {MODULE_LABEL[m.module] ?? m.module}
                          </span>
                          <span className="h-1.5 min-w-[60px] flex-1 rounded-full bg-surface-2">
                            <span
                              className="block h-1.5 rounded-full bg-accent"
                              style={{ width: `${Math.max(2, (m.views / maxModuleViews) * 100)}%` }}
                            />
                          </span>
                        </div>
                      </td>
                      <td className="py-2 text-right font-tabular text-text-primary">
                        {m.views.toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-tabular text-text-secondary">
                        {m.users.toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-tabular text-text-secondary">
                        {m.sessions.toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-tabular text-text-tertiary">
                        {fmtDwell(m.medianDwellMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }}
        </Rows>
      </Card>

      {/* ── By programme ───────────────────────────────────────────── */}
      <Card padding="md">
        <SectionHead
          title="By programme"
          note={
            selectedFaculty
              ? `Programme pages opened in this window, busiest first — ${selectedFaculty.nameEn} only. Top 20 of up to 50 returned.`
              : 'Programme pages opened in this window, busiest first. Top 20 of up to 50 returned.'
          }
          meta={data.programs?.meta ?? USAGE_FALLBACK_META}
          computedAt={data.computedAt}
          action={
            <>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <span className="uppercase tracking-wide">Faculty</span>
                <select
                  className="kku-select"
                  aria-label="Filter programmes by faculty"
                  value={data.facultyId ?? ''}
                  onChange={(e) => onFacultyChange?.(e.target.value)}
                >
                  <option value="">All faculties</option>
                  {choices.map((f) => (
                    // Both names where both exist: the catalogue is Thai-first
                    // in everyday use, and an English-only option list makes
                    // the reader translate before they can pick.
                    <option key={f.id} value={f.id}>
                      {f.nameTh ? `${f.nameEn} · ${f.nameTh}` : f.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              {data.facultyId ? (
                <button
                  type="button"
                  onClick={() => onFacultyChange?.('')}
                  className="rounded-md border border-subtle px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
                >
                  Clear
                </button>
              ) : null}
            </>
          }
        />
        <Rows
          envelope={data.programs}
          what="Programme figures"
          empty={
            selectedFaculty
              ? `No ${selectedFaculty.nameEn} programme pages were opened ${data.excludeAdmins ? 'by non-admin accounts ' : ''}in this window.`
              : `No programme pages were opened ${data.excludeAdmins ? 'by non-admin accounts ' : ''}in this window.`
          }
        >
          {(programRows) => (
            <ul className="flex flex-col text-sm">
              {programRows.slice(0, 20).map((p) => {
                // The query LEFT JOINs programs, so a view of a programme that
                // has since been removed comes back with every catalogue column
                // null. Say so and do not link — the deep-dive would 404.
                const known = p.code !== null || p.nameEn !== null || p.nameTh !== null;
                const label = (
                  <>
                    <span className="font-mono text-xs text-text-tertiary">
                      {p.code ?? p.programId}
                    </span>
                    <span className="px-2 text-text-tertiary">·</span>
                    {p.nameEn ?? p.nameTh ?? 'no longer in the catalogue'}
                    {/* Both names where the catalogue has both — the Thai one
                        is what the programme is called in the room. */}
                    {p.nameEn && p.nameTh ? (
                      <span className="text-xs text-text-tertiary"> · {p.nameTh}</span>
                    ) : null}
                    {p.facultyTh ? (
                      <span className="text-xs text-text-tertiary"> · {p.facultyTh}</span>
                    ) : null}
                  </>
                );
                return (
                  <li
                    key={p.programId}
                    className="flex flex-wrap items-center justify-between gap-4 border-t border-subtle py-2 first:border-t-0"
                  >
                    {known ? (
                      <Link
                        href={`/programs/${p.programId}`}
                        className="min-w-0 flex-1 truncate text-text-secondary hover:underline"
                      >
                        {label}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-text-tertiary">{label}</span>
                    )}
                    <span className="flex shrink-0 items-center gap-4 text-xs">
                      <span className="font-tabular text-text-primary">
                        {p.views.toLocaleString()} {plural(p.views, 'view')}
                      </span>
                      <span className="font-tabular text-text-tertiary">
                        {p.users.toLocaleString()} {plural(p.users, 'user')}
                      </span>
                      {data.canSeeDetail && onOpenProgram ? (
                        <button
                          type="button"
                          onClick={() => onOpenProgram(p)}
                          className="rounded-md border border-subtle px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
                        >
                          Who viewed
                        </button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Rows>
      </Card>

      {/* ── By faculty + by role ───────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card padding="md">
          <SectionHead
            title="By faculty"
            note="The viewer's own faculty, not the faculty they were reading about."
            meta={data.faculties?.meta ?? USAGE_FALLBACK_META}
            computedAt={data.computedAt}
          />
          <Rows
            envelope={data.faculties}
            what="Faculty figures"
            empty={
              data.excludeAdmins
                ? 'No activity from non-admin accounts attributable to a faculty in this window.'
                : 'No activity attributable to a faculty in this window.'
            }
          >
            {(facultyRows) => (
              <ul className="flex flex-col text-sm">
                {facultyRows.map((f) => (
                  <li
                    key={f.facultyId ?? 'no-faculty'}
                    className="flex items-center justify-between gap-4 border-t border-subtle py-2 first:border-t-0"
                  >
                    <span className="min-w-0 truncate text-text-secondary">
                      {f.nameTh ?? f.nameEn ?? 'No faculty on the account'}
                      {f.nameTh && f.nameEn ? (
                        <span className="text-xs text-text-tertiary"> · {f.nameEn}</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-4 text-xs">
                      <span className="font-tabular text-text-primary">
                        {f.users.toLocaleString()} {plural(f.users, 'user')}
                      </span>
                      <span className="font-tabular text-text-tertiary">
                        {f.views.toLocaleString()} {plural(f.views, 'view')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Rows>
        </Card>

        <Card padding="md">
          <SectionHead
            title="By role"
            note="The role the view was rendered under. Impersonated views are never counted."
            meta={data.roles?.meta ?? USAGE_FALLBACK_META}
            computedAt={data.computedAt}
          />
          <Rows
            envelope={data.roles}
            what="Role figures"
            empty={
              data.excludeAdmins
                ? 'No activity recorded for any non-admin role in this window.'
                : 'No activity recorded for any role in this window.'
            }
          >
            {(roleRows) => (
              <ul className="flex flex-col text-sm">
                {roleRows.map((r) => (
                  <li
                    key={r.role}
                    className="flex flex-wrap items-center justify-between gap-4 border-t border-subtle py-2 first:border-t-0"
                  >
                    <span className="min-w-0 truncate text-text-secondary">{r.role}</span>
                    <span className="flex shrink-0 items-center gap-4 text-xs">
                      <span className="font-tabular text-text-primary">
                        {r.users.toLocaleString()} {plural(r.users, 'user')}
                      </span>
                      <span className="font-tabular text-text-tertiary">
                        {r.views.toLocaleString()} {plural(r.views, 'view')}
                      </span>
                      <span className="font-tabular text-text-tertiary">
                        {r.signins.toLocaleString()} {plural(r.signins, 'sign-in')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Rows>
        </Card>
      </div>

      {/* ── Actions ────────────────────────────────────────────────── */}
      <Card padding="md">
        <SectionHead
          title="Actions"
          note="Things people did rather than read, taken from the audit log. Sign-ins and housekeeping are excluded."
          meta={data.actions?.meta ?? USAGE_FALLBACK_META}
          computedAt={data.computedAt}
        />
        <Rows
          envelope={data.actions}
          what="Action figures"
          empty={
            data.excludeAdmins
              ? 'No recorded actions from non-admin accounts in this window.'
              : 'No recorded actions in this window.'
          }
        >
          {(actionRows) => (
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {actionRows.map((a) => (
                <li key={a.family} className="rounded-lg border border-subtle p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                    {FAMILY_LABEL[a.family] ?? a.family}
                  </div>
                  <div className="mt-1 font-tabular text-xl font-semibold leading-none text-text-primary">
                    {a.count.toLocaleString()}
                  </div>
                  <div className="mt-1 text-[11px] text-text-tertiary">
                    by {a.users.toLocaleString()} {a.users === 1 ? 'person' : 'people'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Rows>
      </Card>

      {/* ── Access log — usage:read:detail only ────────────────────── */}
      {/* Rendered whenever the viewer may see it, not only when it loaded:
          a card that vanishes on a failed fetch takes its own explanation
          with it, and reads as "this permission is gone". */}
      {data.canSeeDetail ? (
        <Card padding="md">
          <SectionHead
            title="Access log"
            note={
              // A failed fetch has no counts, and `userTotal` falls back to 0
              // — so the counted wording would report "0 people opened pages"
              // as a finding about the platform, next to a body that says the
              // service did not answer. Say only what is still true.
              data.users === null ? (
                'Named individuals, over the selected window.'
              ) : (
                <>
                  {data.activity === 'all' ? (
                    <>
                      <span className="font-medium text-text-secondary">
                        {people(userTotal)} active
                      </span>{' '}
                      in this window · showing sign-ins too{' '}
                      <button
                        type="button"
                        onClick={() => onActivityChange?.('views')}
                        className="text-accent-default hover:underline"
                      >
                        Only people who opened pages
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-text-secondary">
                        {people(userTotal)} opened pages
                      </span>{' '}
                      in this window
                      {signinOnly > 0 ? (
                        <>
                          {' · '}
                          <span className="font-medium text-text-secondary">
                            {signinOnly.toLocaleString()} more signed in but opened no page
                          </span>{' '}
                          <button
                            type="button"
                            onClick={() => onActivityChange?.('all')}
                            className="text-accent-default hover:underline"
                          >
                            Include them
                          </button>
                        </>
                      ) : null}
                    </>
                  )}
                  {data.q ? <> · matching “{data.q}”</> : null}. Open a row for that person&apos;s
                  session-by-session timeline.
                </>
              )
            }
            meta={data.users?.meta ?? USAGE_FALLBACK_META}
            computedAt={data.computedAt}
            action={searchSlot}
          />
          {data.users === null ? (
            <Absent>The access log is unavailable — the usage service did not answer.</Absent>
          ) : userRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm [&_th]:whitespace-nowrap">
                <thead className="text-left text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                  <tr>
                    <th scope="col" className="py-1 font-semibold">
                      Person
                    </th>
                    <th scope="col" className="py-1 font-semibold">
                      Role
                    </th>
                    <th scope="col" className="py-1 font-semibold">
                      Faculty
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Views
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Sessions
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Sign-ins
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Actions
                    </th>
                    <th scope="col" className="py-1 font-semibold">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {userRows.map((u) => (
                    <tr key={u.userId} className="border-t border-subtle hover:bg-surface-2">
                      <td className="py-2 pr-6">
                        {onOpenUser ? (
                          <button
                            type="button"
                            onClick={() => onOpenUser(u)}
                            className="block max-w-[220px] truncate text-left text-text-secondary hover:underline"
                          >
                            {u.name ?? u.email}
                          </button>
                        ) : (
                          <span className="block max-w-[220px] truncate text-text-secondary">
                            {u.name ?? u.email}
                          </span>
                        )}
                        <span className="block max-w-[220px] truncate text-xs text-text-tertiary">
                          {u.email}
                        </span>
                      </td>
                      <td className="py-2 pr-6 text-xs text-text-secondary">{u.role}</td>
                      <td className="py-2 pr-6 text-xs text-text-tertiary">{u.facultyTh ?? '—'}</td>
                      <td className="py-2 text-right font-tabular text-text-primary">
                        {u.views.toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-tabular text-text-secondary">
                        {u.sessions.toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-tabular text-text-secondary">
                        {u.signins.toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-tabular text-text-secondary">
                        {u.actions.toLocaleString()}
                      </td>
                      <td className="py-2 pl-6 text-xs text-text-tertiary">
                        {fmtDateTime(u.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* A pager only where there is more than one page. The range is
                  computed from the rows actually returned, not from
                  page × pageSize, so the last page reads "126–128 of 128". */}
              {userTotal > pageSize ? (
                <div className="mt-3 flex items-center justify-between gap-4 border-t border-subtle pt-3 text-[11px] text-text-tertiary">
                  <span className="font-tabular">
                    {firstOnPage.toLocaleString()}–{lastOnPage.toLocaleString()} of{' '}
                    {userTotal.toLocaleString()}
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={pageNumber <= 1}
                      onClick={() => onPageChange?.(pageNumber - 1)}
                      className={MINI_BUTTON}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={lastOnPage >= userTotal}
                      onClick={() => onPageChange?.(pageNumber + 1)}
                      className={MINI_BUTTON}
                    >
                      Next
                    </button>
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <Absent>
              {userTotal > 0 ? (
                // Rows are empty but people match: the reader is past the end
                // of the list, usually from a bookmarked `?page=`. Every other
                // branch here would tell them nobody was active, which the
                // count beside it contradicts — and none offers a way back.
                <>
                  Page {pageNumber.toLocaleString()} is past the end of this list —{' '}
                  {people(userTotal)} {userTotal === 1 ? 'matches' : 'match'} the current filters.{' '}
                  <button
                    type="button"
                    onClick={() => onPageChange?.(1)}
                    className="text-accent-default hover:underline"
                  >
                    Back to the first page
                  </button>
                </>
              ) : data.activity === 'views' && signinOnly > 0 ? (
                // The one emptiness with a remedy on screen: people WERE here,
                // they just never opened a page. Saying only "nobody" would
                // deny activity the very next click can show — and it must
                // carry the search term, since the remedy is only the right
                // one for the list the reader is actually looking at.
                <>
                  Nobody{data.q ? ` matching “${data.q}”` : ''} opened a page in this window;{' '}
                  {people(signinOnly)} signed in.{' '}
                  <button
                    type="button"
                    onClick={() => onActivityChange?.('all')}
                    className="text-accent-default hover:underline"
                  >
                    Include them
                  </button>
                </>
              ) : data.q ? (
                `Nobody matching “${data.q}” has been active in this window.`
              ) : data.excludeAdmins ? (
                'No non-admin account has been active in this window.'
              ) : (
                'Nobody has been active in this window.'
              )}
            </Absent>
          )}
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Memoised because `UsageClient` re-renders on every panel open, every fetch
 * settling and every keystroke in the search box, while this subtree depends
 * on nothing but the server-fetched `data` — which does not change until the
 * URL does.
 */
export const UsageSections = memo(UsageSectionsImpl);

/**
 * The access log's search box. Its own leaf because it holds the half-typed
 * term: the page only re-reads when the term is submitted, so the input has
 * to remember what has been typed in the meantime, and `UsageSections` must
 * stay free of state to remain renderable from plain data in a test.
 */
function UsageSearch({
  initial,
  onSearch,
}: {
  initial: string | null;
  onSearch: (q: string) => void;
}) {
  const [term, setTerm] = useState(initial ?? '');
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(term.trim());
      }}
    >
      <input
        type="search"
        value={term}
        maxLength={80}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Name or email…"
        aria-label="Search the access log"
        className="rounded-md border border-default bg-surface-1 px-3 py-1.5 text-xs text-text-primary"
      />
      <button
        type="submit"
        className="rounded-md border border-subtle px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
      >
        Search
      </button>
      {initial ? (
        <button
          type="button"
          onClick={() => {
            setTerm('');
            onSearch('');
          }}
          className="rounded-md border border-subtle px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}

export function UsageClient({ data }: { data: UsageData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [openUser, setOpenUser] = useState<UserUsageT | null>(null);
  const [timeline, setTimeline] = useState<UserTimelineT | null>(null);
  const [openProgram, setOpenProgram] = useState<ProgramUsageT | null>(null);
  const [viewers, setViewers] = useState<ProgramViewerT[] | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  /**
   * Which drill-down request is the current one.
   *
   * The two panels share `detailError`, and either fetch can take as long as
   * the reader takes to click the next row. Without a token, a slow first
   * request lands after a fast second and paints one person's timeline under
   * another person's name — the worst possible failure on a page whose whole
   * subject is who did what.
   */
  const detailToken = useRef(0);

  // Patches the URL rather than rebuilding it, so every control keeps the
  // others' state. An empty value removes the key: `?facultyId=` would be a
  // filter on the empty string as far as a reader of the URL is concerned.
  //
  // Changing anything OTHER than the page drops the page: page 4 of a
  // 128-person list is page 0 of a 3-person search, and keeping the number
  // across a filter change lands the reader on an empty table that looks like
  // "no matches" rather than "past the end".
  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (value === '') params.delete(key);
      else params.set(key, value);
      if (key !== 'page') params.delete('page');
      const qs = params.toString();
      router.replace(qs === '' ? pathname : `${pathname}?${qs}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const openUserPanel = useCallback(
    async (u: UserUsageT) => {
      const token = ++detailToken.current;
      // One panel at a time: they occupy the same slot, and two stacked
      // drawers leave the reader unsure which name the content belongs to.
      setOpenProgram(null);
      setViewers(null);
      setOpenUser(u);
      setTimeline(null);
      setDetailError(null);
      try {
        const res = await fetch(
          `/api/usage-detail/users/${encodeURIComponent(u.userId)}?days=${data.detailDays}`,
        );
        if (!res.ok) throw new Error(describeStatus(res.status, 'person'));
        const body = (await res.json()) as { data: UserTimelineT };
        if (detailToken.current === token) setTimeline(body.data);
      } catch (e) {
        if (detailToken.current === token)
          setDetailError(`Could not load this timeline — ${(e as Error).message}.`);
      }
    },
    [data.detailDays],
  );

  const openProgramPanel = useCallback(
    async (p: ProgramUsageT) => {
      const token = ++detailToken.current;
      setOpenUser(null);
      setTimeline(null);
      setOpenProgram(p);
      setViewers(null);
      setDetailError(null);
      try {
        const res = await fetch(
          `/api/usage-detail/programs/${encodeURIComponent(p.programId)}/viewers?days=${data.detailDays}`,
        );
        if (!res.ok) throw new Error(describeStatus(res.status, 'programme'));
        const body = (await res.json()) as { data: ProgramViewerT[] };
        if (detailToken.current === token) setViewers(body.data);
      } catch (e) {
        if (detailToken.current === token)
          setDetailError(`Could not load this viewer list — ${(e as Error).message}.`);
      }
    },
    [data.detailDays],
  );

  const handleFacultyChange = useCallback(
    (facultyId: string) => setParam('facultyId', facultyId),
    [setParam],
  );
  const handleSearch = useCallback((q: string) => setParam('q', q), [setParam]);
  // `views` is the default, so it is expressed by the key's ABSENCE rather
  // than by `?activity=views` — the shared URL then says only what was chosen.
  const handleActivityChange = useCallback(
    (activity: UsageActivity) => setParam('activity', activity === 'all' ? 'all' : ''),
    [setParam],
  );
  const handlePageChange = useCallback(
    (page: number) => setParam('page', page <= 1 ? '' : String(page)),
    [setParam],
  );

  // The drill-downs read raw page_views, which retention sweeps; the api
  // refuses a window wider than that, so the server already narrowed it.
  // Say so rather than let the panel quietly disagree with the page.
  const detailNote =
    data.detailDays === data.days
      ? null
      : `Raw page views are not kept for a full year, so this panel covers the last ${WINDOW_LABEL[data.detailDays] ?? `${data.detailDays} days`} rather than the ${WINDOW_LABEL[data.days] ?? `${data.days} days`} selected above.`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-6">
        <Segmented value={String(data.days)} onValueChange={(v) => setParam('days', v)}>
          <SegmentedList aria-label="Time window">
            {[7, 30, 90, 365].map((d) => (
              <SegmentedTrigger key={d} value={String(d)}>
                {WINDOW_LABEL[d]}
              </SegmentedTrigger>
            ))}
          </SegmentedList>
        </Segmented>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={data.excludeAdmins}
            onChange={(e) => setParam('excludeAdmins', String(e.target.checked))}
            className="size-icon-sm"
          />
          Exclude admin accounts
        </label>
      </div>

      <UsageSections
        data={data}
        onOpenUser={data.canSeeDetail ? openUserPanel : undefined}
        onOpenProgram={data.canSeeDetail ? openProgramPanel : undefined}
        onFacultyChange={handleFacultyChange}
        onActivityChange={data.canSeeDetail ? handleActivityChange : undefined}
        onPageChange={data.canSeeDetail ? handlePageChange : undefined}
        searchSlot={
          data.canSeeDetail ? (
            <UsageSearch
              // Remount on a submitted term change so the box shows what the
              // page is actually filtered by after a Clear or a back button.
              key={data.q ?? ''}
              initial={data.q}
              onSearch={handleSearch}
            />
          ) : null
        }
      />

      <RightPanel
        open={openProgram !== null}
        onOpenChange={(o) => {
          if (!o) setOpenProgram(null);
        }}
        title={
          openProgram
            ? `Who viewed ${openProgram.code ?? openProgram.nameEn ?? 'this programme'}`
            : ''
        }
      >
        {detailNote ? <p className="mb-4 text-xs text-text-tertiary">{detailNote}</p> : null}
        {detailError ? (
          <p className="text-sm text-text-tertiary">{detailError}</p>
        ) : viewers === null ? (
          <p className="text-sm text-text-tertiary">Loading…</p>
        ) : viewers.length === 0 ? (
          <p className="text-sm text-text-tertiary">Nobody opened this programme in this window.</p>
        ) : (
          <ul className="flex flex-col text-sm">
            {viewers.map((v) => (
              <li
                key={v.userId}
                className="flex items-center justify-between gap-4 border-t border-subtle py-2 first:border-t-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-text-secondary">{v.name ?? v.email}</span>
                  <span className="block truncate text-xs text-text-tertiary">{v.role}</span>
                </span>
                <span className="shrink-0 font-tabular text-xs text-text-primary">
                  {v.views.toLocaleString()} {plural(v.views, 'view')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RightPanel>

      <RightPanel
        open={openUser !== null}
        onOpenChange={(o) => {
          if (!o) setOpenUser(null);
        }}
        title={openUser ? (openUser.name ?? openUser.email) : ''}
      >
        {detailNote ? <p className="mb-4 text-xs text-text-tertiary">{detailNote}</p> : null}
        {detailError ? (
          <p className="text-sm text-text-tertiary">{detailError}</p>
        ) : timeline === null ? (
          <p className="text-sm text-text-tertiary">Loading…</p>
        ) : timeline.days.length === 0 ? (
          <p className="text-sm text-text-tertiary">No activity in this window.</p>
        ) : (
          <div className="flex flex-col gap-6 text-sm">
            {timeline.days.map((d) => (
              <div key={d.day}>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                  {d.day}
                </div>
                {d.sessions.map((session) => (
                  <div key={session.startedAt} className="mb-4 rounded-lg border border-subtle p-4">
                    <div className="mb-2 text-[11px] text-text-tertiary">
                      {fmtTime(session.startedAt)} – {fmtTime(session.endedAt)}
                      <span className="px-2">·</span>
                      {session.events.length} {session.events.length === 1 ? 'event' : 'events'}
                    </div>
                    <ul className="flex flex-col gap-1">
                      {session.events.map((e, i) => (
                        <li key={`${e.at}-${i}`} className="flex items-center gap-2">
                          <span className="w-12 shrink-0 font-tabular text-[11px] text-text-tertiary">
                            {fmtTime(e.at)}
                          </span>
                          <Badge
                            tone={
                              e.kind === 'signin'
                                ? 'success'
                                : e.kind === 'action'
                                  ? 'accent'
                                  : 'neutral'
                            }
                            size="sm"
                          >
                            {e.kind}
                          </Badge>
                          <span className="min-w-0 truncate text-text-secondary">{e.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </RightPanel>
    </div>
  );
}
