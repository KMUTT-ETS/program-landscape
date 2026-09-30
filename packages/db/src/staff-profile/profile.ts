// Staff profile builder — the single implementation behind the /profile page,
// the home-page sparkline and the external staff-profile API
// (POST /api/v1/external/staff-profile). Moved from apps/web/src/lib/
// profile-data.ts on 2026-09-30; the page keeps a thin user-keyed wrapper.
//
// Aggregates everything the resume needs for one staff record:
//
//   - Basic info (rank-prefixed name, position, faculty)
//   - Education / qualification (when populated by HR)
//   - Research summary (paper counts, citations, peak year, top venues)
//   - Programs the staffer teaches in (ProgramFaculty join)
//   - Publication list (ResearchOutput rows, deduped by external ID
//     across Scopus / PubMed / OpenAlex sources)
//
// Returns empty sections for anything the data doesn't fill — the profile
// page renders graceful "no record yet" placeholders rather than
// fabricating content.
import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { teachingTalentForFacultyMember, type TeachingTalentStamp } from '../teaching-talent';
import { decidePublicationsCacheAction, hasScholarImport } from '../publication-source-precedence';
import { SCHOLAR_RESEARCH_OUTPUT_SOURCE } from '../scholar-fetch';
import type {
  CurriculumProgram,
  EducationEntry,
  FacultyRankCode,
  ProfileBasicInfo,
  PublicationEntry,
  PublicationsCacheStatus,
  ResearchBasis,
  ResearchSummary,
  TeachingProfile,
} from '@kku/shared';
import {
  fetchAuthorsByPaper,
  fetchKkuScholarPublicationsByPerson,
  type KkuScholarPublication,
  type PaperLookupKey,
} from './kku-scholar';
import { fetchPublicationsByScopusAuthor, resolveScopusAuthorId } from './scopus';
import { fetchExternalAuthors, fetchExternalAuthorsByMetadata } from './external';
import { summariseTeaching } from './teaching';

const RANK_LABEL: Record<FacultyRankCode, { th: string; en: string; thAbbrev: string; enAbbrev: string }> = {
  PROF: { th: 'ศาสตราจารย์', en: 'Professor', thAbbrev: 'ศ.', enAbbrev: 'Prof.' },
  ASSOC_PROF: { th: 'รองศาสตราจารย์', en: 'Associate Professor', thAbbrev: 'รศ.', enAbbrev: 'Assoc. Prof.' },
  ASST_PROF: { th: 'ผู้ช่วยศาสตราจารย์', en: 'Assistant Professor', thAbbrev: 'ผศ.', enAbbrev: 'Asst. Prof.' },
  LECTURER: { th: 'อาจารย์', en: 'Lecturer', thAbbrev: 'อ.', enAbbrev: 'Lect.' },
};

/** Basic info derivable from the staff record alone. The page adds the
 *  signed-in user's email and avatar; the API adds the staff record's email. */
export type StaffBasicInfo = Omit<ProfileBasicInfo, 'email' | 'avatarUrl'> & {
  /** Rank abbreviation ("รศ." / "Assoc. Prof.") — the same RANK_LABEL entry
   *  the full display names are built from, so the two cannot disagree. */
  rankAbbrevTh: string;
  rankAbbrevEn: string;
};

export interface StaffProfileOptions {
  /** Passed to summariseTeaching: 10 for the page (the default), null for
   *  every course (the external API). */
  courseLimit?: number | null;
  /** Compute the Teaching Talent stamp (default true). The external API
   *  passes false: it never returns the verdict, so computing it is waste. */
  includeTalent?: boolean;
}

export interface StaffProfile {
  facultyMemberId: string;
  isActive: boolean;
  rank: FacultyRankCode;
  nameTh: string;
  nameEn: string;
  kkuEmail: string | null;
  basic: StaffBasicInfo;
  education: EducationEntry[];
  research: ResearchSummary;
  researchBasis: ResearchBasis;
  curriculum: CurriculumProgram[];
  publications: PublicationEntry[];
  publicationsCache: PublicationsCacheStatus;
  /** ISO time the publication list was computed. */
  publicationsFetchedAt: string;
  teaching: TeachingProfile;
  talent: TeachingTalentStamp | null;
}

const DEFAULT_COURSE_LIMIT = 10;

/**
 * Build one staff member's full profile. Returns null when the id matches no
 * staff record. Does NOT filter on isActive — callers decide whether an
 * inactive record is visible (the page resolves active records only; the API
 * follows the client's includeInactive grant).
 */
export async function buildStaffProfile(
  facultyMemberId: string,
  opts: StaffProfileOptions = {},
): Promise<StaffProfile | null> {
  const member = await prisma.facultyMember.findUnique({
    where: { id: facultyMemberId },
    include: {
      faculty: { select: { nameTh: true, nameEn: true } },
      department: { select: { nameTh: true, nameEn: true } },
    },
  });
  if (!member) return null;

  const [programs, papers, ds2003Rows] = await Promise.all([
    prisma.programFaculty.findMany({
      where: { facultyMemberId: member.id },
      include: {
        program: {
          include: { faculty: { select: { nameTh: true, nameEn: true } } },
        },
      },
      orderBy: [{ role: 'asc' }, { program: { code: 'asc' } }],
    }),
    // Pull every ResearchOutput linked to this faculty member. We dedupe
    // below by external ID since the same paper can land twice (once
    // per source — Scopus + PubMed both index medical papers).
    prisma.researchOutput.findMany({
      where: { facultyMemberId: member.id },
      orderBy: { year: 'desc' },
    }),
    // DS2003 (UNICON staff education history) — bridged via the
    // citizenIdHash that kku-hr stamped on FacultyMember. May be
    // empty when DS2003 hasn't observed this person, in which case
    // we fall back to the legacy academicQualification parser below.
    member.citizenIdHash
      ? prisma.staffEducationHistory.findMany({
          where: { citizenIdHash: member.citizenIdHash },
          orderBy: [{ gradYear: 'desc' }],
        })
      : Promise.resolve([]),
  ]);

  const curriculum: CurriculumProgram[] = programs.map((pf) => ({
    programId: pf.program.id,
    code: pf.program.code,
    nameTh: pf.program.nameTh,
    nameEn: pf.program.nameEn,
    level: pf.program.level,
    facultyNameTh: pf.program.faculty.nameTh,
    facultyNameEn: pf.program.faculty.nameEn,
    role: pf.role,
  }));

  // Build education entries — DS2003 is authoritative when present;
  // fall back to the freeform academicQualification parser otherwise.
  const education = ds2003Rows.length > 0
    ? ds2003Rows.map(ds2003ToEducationEntry)
    : parseEducation(member.academicQualification);

  // Which source builds the list is decided by `hasScholarImport`, and
  // `computePublications` below carries both shapes:
  //
  //   - No Scholar import → the historic two-source merge. Live Scopus
  //     (with the kkuscholar mirror behind it) is canonical for WHICH
  //     papers and for author lists; the local ResearchOutput rows fill
  //     gaps — legacy OpenAlex imports, IEEE and specialty conferences
  //     kkuscholar does not track.
  //   - Scholar has imported → the local rows ARE the list, and no live
  //     library read is made.
  //
  // Either way the enrichment passes (DOI bridge, then the OpenAlex /
  // Scopus metadata fallback) still run, and the FULLY-ENRICHED array is
  // what lands in `staff_publications_cache` — warm paths are ~50ms
  // against a cold path of seconds.
  //
  // Cache TTL = CACHE_FRESH_MS, so new `research_outputs` rows written
  // by a scheduled connector wait for the turnover. Rows written by a
  // Scholar sync do NOT: the runner invalidates the row and
  // `decidePublicationsCacheAction` treats that as a miss.
  const dedupedLocal = dedupePublications(papers);
  // `papers` is every research row on this staff record, so it carries the
  // `source` values the precedence rule reads. Passing the rows rather than
  // a boolean keeps the rule in one place — see `hasScholarImport` in
  // publication-source-precedence.ts for why it is keyed on rows.
  const scholarIsPrimary = hasScholarImport(papers);
  const pubs = await loadPublicationsWithCache(member.id, () =>
    computePublications(member, dedupedLocal, scholarIsPrimary),
  );

  // Both read the evaluation/registrar cubes for this one person; run
  // them together rather than serially.
  const [teaching, talent] = await Promise.all([
    summariseTeaching(
      { id: member.id, kkuEmail: member.kkuEmail },
      { courseLimit: opts.courseLimit === undefined ? DEFAULT_COURSE_LIMIT : opts.courseLimit },
    ),
    opts.includeTalent === false ? Promise.resolve(null) : teachingTalentForFacultyMember(member.id),
  ]);

  return {
    facultyMemberId: member.id,
    isActive: member.isActive,
    rank: member.rank,
    nameTh: member.nameTh,
    nameEn: member.nameEn,
    kkuEmail: member.kkuEmail,
    basic: buildMemberBasicInfo(member, education),
    education,
    research: summariseResearch(pubs.papers),
    // The constant, not a literal: the source-precedence rule owns the name.
    researchBasis: (scholarIsPrimary ? SCHOLAR_RESEARCH_OUTPUT_SOURCE : 'library') as ResearchBasis,
    curriculum,
    publications: pubs.papers,
    publicationsCache: pubs.status,
    publicationsFetchedAt: pubs.fetchedAt,
    teaching,
    talent,
  };
}

/**
 * The page's user → staff-record bridge: HR employeeId first (set by the SSO
 * callback), then the Thai name with honorifics stripped (for users who
 * predate employeeId capture). Active records only — the page has never
 * shown an inactive one.
 */
export async function resolveFacultyMemberForUser(user: {
  employeeId: string | null;
  name: string | null;
}): Promise<string | null> {
  if (user.employeeId) {
    const byEmployee = await prisma.facultyMember.findFirst({
      where: { employeeId: user.employeeId, isActive: true },
      select: { id: true },
    });
    if (byEmployee) return byEmployee.id;
  }
  if (user.name) {
    const stripped = stripTitlePrefixes(user.name);
    if (stripped) {
      const byName = await prisma.facultyMember.findFirst({
        where: { nameTh: stripped, isActive: true },
        select: { id: true },
      });
      if (byName) return byName.id;
    }
  }
  return null;
}

/**
 * Map a DS2003 row to the page-facing EducationEntry. The grad-level
 * is normalised: when the source has a derived `gradLevelName` we use
 * it; otherwise we fall back to the curriculum string itself.
 */
function ds2003ToEducationEntry(row: {
  gradYear: string | null;
  gradLevelName: string | null;
  gradCurriculum: string | null;
  gradProgram: string | null;
  gradInstitute: string | null;
  gradCountryId: string | null;
}): EducationEntry {
  // DS2003 stores BE years as strings ("2538"). Convert to number;
  // null when unparseable. We keep BE rather than CE because that's
  // how the source stores it AND how Thai readers expect to see it.
  const yearNum = row.gradYear ? Number(row.gradYear) : NaN;
  return {
    qualification: row.gradCurriculum ?? row.gradLevelName ?? '—',
    level: row.gradLevelName,
    major: row.gradProgram,
    institute: row.gradInstitute,
    countryCode: row.gradCountryId,
    year: Number.isFinite(yearNum) ? yearNum : null,
    source: 'unicon-ds2003',
  };
}

/** The staff-record fields the publication pipeline reads. */
interface PublicationMember {
  id: string;
  nameEn: string;
  nameTh: string;
  employeeCode: string;
  scopusAuthorId: string | null;
}

/**
 * Build the enriched publication list for one staff member.
 *
 * The single implementation behind BOTH cache callers — the profile builder
 * and the home-page sparkline — because they share one `staff_publications_cache`
 * row per staff record.
 *
 * `scholarIsPrimary` decides which of two shapes this takes:
 *
 *   false — the historic path. Live Scopus by author id, kkuscholar mirror
 *           behind it, merged with the local rows as a gap-filler.
 *
 *   true  — the Scholar runner has imported for this person, so the live
 *           library read is NOT made and the list is built from the local
 *           record alone. Author lists still come from the kkuscholar DOI
 *           bridge and the OpenAlex/Scopus metadata fallback inside
 *           `mergeAndEnrichPublications`; what is dropped is the library's
 *           claim over WHICH PAPERS the list contains, not the enrichment.
 *
 * Why the live read has to go rather than merely lose a tie-break: a Scholar
 * row carries no DOI, no Scopus id and no PMID, so the merge's dedupe keys
 * cannot recognise that a live Scopus hit and a Scholar row are one paper. Left
 * in, both are listed. See @kku/db `publication-source-precedence` for the rule
 * and what it deliberately does not do.
 */
async function computePublications(
  member: PublicationMember,
  dedupedLocal: PublicationEntry[],
  scholarIsPrimary: boolean,
): Promise<PublicationEntry[]> {
  const ownerSurname = lastTokenOf(member.nameEn);
  const ownerGiven = firstTokenOf(member.nameEn);

  if (scholarIsPrimary) {
    return mergeAndEnrichPublications([], dedupedLocal, ownerSurname, ownerGiven);
  }

  // Primary path: pull every paper from Scopus by AU-ID. ~2-3s with full
  // per-paper author lists, vs the kkuscholar mirror's 30-45s.
  //
  // Profile-page-only — bulk modules (cockpit, gap-analyzer, benchmarking)
  // continue reading from kkuscholar to stay under Scopus's 20k-req/week
  // institutional rate limit.
  //
  // Resolution order for the Scopus author id:
  //   1. FacultyMember.scopusAuthorId (cached from a prior visit or seeded
  //      by the kku-research connector).
  //   2. Live Scopus author search by name + KKU affiliation — cached back
  //      to the FacultyMember row so subsequent cold-cache loads skip it.
  let scopusAuthorId = member.scopusAuthorId;
  if (!scopusAuthorId && ownerSurname && ownerGiven) {
    const resolved = await resolveScopusAuthorId({
      surnameEn: ownerSurname,
      givenEn: ownerGiven,
    }).catch(() => null);
    if (resolved) {
      scopusAuthorId = resolved.authorId;
      // Fire-and-forget cache write so the next cold load skips the
      // resolution. Failures are not actionable.
      void prisma.facultyMember
        .update({
          where: { id: member.id },
          data: { scopusAuthorId: resolved.authorId },
        })
        .catch(() => undefined);
    }
  }

  const scopusPapers = scopusAuthorId
    ? await fetchPublicationsByScopusAuthor(scopusAuthorId)
    : [];

  // kkuscholar fallback — only fire when Scopus came up empty. Covers
  // Thai-only researchers + medical faculty whose primary footprint is in
  // TCI / PubMed rather than Scopus.
  const fallbackPapers =
    scopusPapers.length === 0
      ? await fetchKkuScholarPublicationsByPerson({
          kkuScholarPersonId: scholarPersonIdFromEmployeeCode(member.employeeCode),
          surnameEn: ownerSurname,
          givenNameEn: ownerGiven,
          surnameTh: lastTokenOf(member.nameTh),
          givenNameTh: firstTokenOf(member.nameTh),
        })
      : [];

  return mergeAndEnrichPublications(
    [...scopusPapers, ...fallbackPapers],
    dedupedLocal,
    ownerSurname,
    ownerGiven,
  );
}

/**
 * Merge kkuscholar (canonical) + local ResearchOutput (gap-filler).
 * Dedup by DOI > scopusDocId > pmid. kkuscholar's author list always
 * wins when both sources have a paper.
 *
 * For local-only papers (i.e. ones kkuscholar doesn't carry — typically
 * IEEE conferences, Thai-language proceedings, or pre-2010 records) we
 * try a per-paper DOI bridge to recover authors; if that also misses,
 * the paper falls back to its single-KKU-author rendering.
 */
async function mergeAndEnrichPublications(
  scholarPapers: KkuScholarPublication[],
  localPapers: PublicationEntry[],
  ownerSurname: string | null,
  ownerGiven: string | null,
): Promise<PublicationEntry[]> {
  // Index scholarPapers by every external-id flavour they carry.
  const byDoi = new Map<string, KkuScholarPublication>();
  const byScopus = new Map<string, KkuScholarPublication>();
  const byPmid = new Map<string, KkuScholarPublication>();
  for (const p of scholarPapers) {
    if (p.doi) byDoi.set(p.doi.toLowerCase(), p);
    if (p.scopusDocId) byScopus.set(p.scopusDocId, p);
    if (p.pmid) byPmid.set(p.pmid, p);
  }

  // Track which scholarPapers we've already returned (so we know which
  // local papers are duplicates of scholarPapers).
  const claimedScholar = new Set<string>();

  // Pass 1 — every local paper either resolves to a scholar paper
  // (use the scholar version with full authors) OR stands alone (try
  // DOI bridge, otherwise fall back to KKU-only rendering).
  const enrichedLocal: PublicationEntry[] = [];
  const localUnresolved: PublicationEntry[] = [];
  for (const lp of localPapers) {
    const scopusDocId = lp.scopusId ? lp.scopusId.replace(/^2-s2\.0-/, '') : null;
    const match =
      (lp.doi && byDoi.get(lp.doi.toLowerCase())) ||
      (scopusDocId && byScopus.get(scopusDocId)) ||
      (lp.pmid && byPmid.get(lp.pmid)) ||
      null;
    if (match) {
      claimedScholar.add(match.id);
      enrichedLocal.push(applyScholarAuthorsToLocal(lp, match));
    } else {
      localUnresolved.push(lp);
    }
  }

  // Pass 2 — for unresolved local papers, run the DOI bridge.
  if (localUnresolved.length > 0) {
    const keys: PaperLookupKey[] = localUnresolved.map((p) => ({
      id: p.id,
      scopusDocId: p.scopusId ? p.scopusId.replace(/^2-s2\.0-/, '') : null,
      pmid: p.pmid,
      doi: p.doi ? p.doi.toLowerCase() : null,
    }));
    const byPaper = await fetchAuthorsByPaper(keys);
    for (const p of localUnresolved) {
      const fromBridge = byPaper.get(p.id);
      if (fromBridge && fromBridge.length > 0) {
        enrichedLocal.push({
          ...p,
          authors: fromBridge.map((a) => ({
            family: a.surname,
            given: a.givenName,
            initials: a.initials,
          })),
          authorsAreComplete: true,
        });
      } else {
        enrichedLocal.push({ ...p, authors: [], authorsAreComplete: false });
      }
    }
  }

  // Pass 3 — every scholarPaper that didn't get claimed by a local row
  // becomes a brand-new PublicationEntry. These are the back-catalogue
  // papers (1997+) that the local DB doesn't have.
  const scholarOnly: PublicationEntry[] = [];
  for (const sp of scholarPapers) {
    if (claimedScholar.has(sp.id)) continue;
    const hasAuthors = sp.authors.length > 0;
    scholarOnly.push({
      id: sp.id,
      year: sp.year,
      title: sp.title,
      venue: sp.venue,
      citations: sp.citations,
      doi: sp.doi,
      scopusId: sp.scopusDocId ? `2-s2.0-${sp.scopusDocId}` : null,
      pmid: sp.pmid,
      openalexId: null,
      // Preserve the original source — Scopus / PubMed / ISI / TCI
      // — so the UI can show provenance correctly.
      type: sp.source,
      kkuAuthors: [],
      authors: hasAuthors
        ? sp.authors.map((a) => ({
            family: a.surname,
            given: a.givenName,
            initials: a.initials,
          }))
        : [],
      authorsAreComplete: hasAuthors,
      source: `live:${sp.source}`,
      scholarPaperId: null,
    });
  }

  const all = [...enrichedLocal, ...scholarOnly];

  // Pass 4 — external-API fallback. Any paper STILL without authors
  // gets a chained set of attempts:
  //
  //   (a) DOI lookup on OpenAlex → Scopus (when paper has a DOI).
  //   (b) Metadata search on OpenAlex → Scopus by title + owner
  //       surname (verified: result must contain the owner). Used
  //       when DOI is missing OR (a) returned nothing.
  //
  // Sequential per paper, short per-call timeouts. Successful
  // resolutions bake into the per-user cache so the next 24h of
  // loads serve instantly without hitting these APIs again.
  for (const p of all) {
    if (p.authorsAreComplete || p.authors.length > 0) continue;
    let resolved: { surname: string; givenName: string | null; initials: string | null }[] | null = null;

    // (a) DOI lookup
    if (p.doi) {
      try {
        const ext = await fetchExternalAuthors(p.doi);
        if (ext && ext.authors.length > 0) resolved = ext.authors;
      } catch (err) {
        console.warn(
          `[staff-profile] DOI author fetch failed for doi=${p.doi}:`,
          (err as Error).message,
        );
      }
    }

    // (b) Metadata search — only when DOI didn't resolve AND we have
    // a usable surname to verify the match. Title is required for the
    // search query.
    if (!resolved && ownerSurname && p.title.trim()) {
      try {
        const ext = await fetchExternalAuthorsByMetadata({
          title: p.title,
          ownerSurname,
          ownerGiven,
          year: p.year,
          venue: p.venue,
        });
        if (ext && ext.authors.length > 0) resolved = ext.authors;
      } catch (err) {
        console.warn(
          `[staff-profile] metadata-search author fetch failed for "${p.title.slice(0, 50)}":`,
          (err as Error).message,
        );
      }
    }

    if (resolved) {
      p.authors = resolved.map((a) => ({
        family: a.surname,
        given: a.givenName,
        initials: a.initials,
      }));
      p.authorsAreComplete = true;
    }
  }

  // Final order — by year desc, citations desc within year.
  all.sort((a, b) => b.year - a.year || b.citations - a.citations);
  return all;
}

function applyScholarAuthorsToLocal(
  local: PublicationEntry,
  scholar: KkuScholarPublication,
): PublicationEntry {
  // Some scholar papers have metadata (title, venue, year) but no
  // resolved authors — kkuscholar curators add author rows as a
  // separate pass. Don't fake-stamp `authorsAreComplete: true` on
  // those; leave the local fallback in place.
  const hasScholarAuthors = scholar.authors.length > 0;
  return {
    ...local,
    venue: local.venue ?? scholar.venue,
    citations: Math.max(local.citations, scholar.citations),
    doi: local.doi ?? scholar.doi,
    authors: hasScholarAuthors
      ? scholar.authors.map((a) => ({
          family: a.surname,
          given: a.givenName,
          initials: a.initials,
        }))
      : local.authors,
    authorsAreComplete: hasScholarAuthors ? true : local.authorsAreComplete,
  };
}

/** When a FacultyMember was backfilled from kkuscholar, its
 *  employeeCode is `kkupub_<id>` and `<id>` is the kkuscholar
 *  people.id. For HR-imported rows (`hr_<hash>`) we have no direct
 *  scholar id and fall back to name resolution. */
function scholarPersonIdFromEmployeeCode(code: string): number | null {
  const m = code.match(/^kkupub_(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function firstTokenOf(s: string | null | undefined): string | null {
  if (!s) return null;
  const tok = s.trim().split(/\s+/);
  return tok[0] ?? null;
}

function lastTokenOf(s: string | null | undefined): string | null {
  if (!s) return null;
  const tok = s.trim().split(/\s+/);
  return tok.length > 0 ? tok[tok.length - 1]! : null;
}

function buildMemberBasicInfo(
  member: {
    rank: FacultyRankCode;
    nameTh: string;
    nameEn: string;
    academicQualification: string | null;
    orcid: string | null;
    scopusAuthorId: string | null;
    openalexAuthorId: string | null;
    scholarProfileId: string | null;
    faculty: { nameTh: string; nameEn: string } | null;
    department: { nameTh: string; nameEn: string } | null;
  },
  education: EducationEntry[],
): StaffBasicInfo {
  // Detect "Dr." style qualification from the resolved education
  // entries OR from the legacy academicQualification string. Adds a
  // "ดร." / "Dr." after the rank prefix.
  const hasDoctorate =
    education.some((e) =>
      /ph\.?\s*d|doctor|doctoral|ปริญญาเอก|ดุษฎีบัณฑิต|ดร\./i.test(
        `${e.qualification} ${e.level ?? ''}`,
      ),
    ) || /ph\.?\s*d|ปริญญาเอก|ดร\./i.test(member.academicQualification ?? '');
  const rank = RANK_LABEL[member.rank];
  const dr = hasDoctorate ? ' ดร.' : '';
  const drEn = hasDoctorate ? ' Dr.' : '';
  return {
    fullNameTh: `${rank.thAbbrev}${dr} ${member.nameTh}`.replace(/\s+/g, ' ').trim(),
    fullNameEn: `${rank.enAbbrev}${drEn} ${member.nameEn}`.replace(/\s+/g, ' ').trim(),
    rankLabelTh: rank.th,
    rankLabelEn: rank.en,
    rankAbbrevTh: rank.thAbbrev,
    rankAbbrevEn: rank.enAbbrev,
    facultyNameTh: member.faculty?.nameTh ?? null,
    facultyNameEn: member.faculty?.nameEn ?? null,
    departmentNameTh: member.department?.nameTh ?? null,
    departmentNameEn: member.department?.nameEn ?? null,
    orcid: member.orcid,
    scopusAuthorId: member.scopusAuthorId,
    openalexAuthorId: member.openalexAuthorId,
    scholarProfileId: member.scholarProfileId,
  };
}

/**
 * Legacy fallback parser — used only when DS2003 has no rows for a
 * given staffer. Best-effort split of `FacultyMember.academicQualification`
 * (a freeform string) into pseudo-DS2003 entries.
 */
function parseEducation(qualification: string | null): EducationEntry[] {
  if (!qualification || !qualification.trim()) return [];
  const lines = qualification
    .split(/[\n;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const yearMatch = line.match(/(?:^|[^0-9])(19|20)(\d{2})(?:[^0-9]|$)/);
    const year = yearMatch ? Number(yearMatch[1]! + yearMatch[2]!) : null;
    return {
      qualification: line,
      level: null,
      major: null,
      institute: null,
      countryCode: null,
      year,
      source: 'fallback' as const,
    };
  });
}

export function emptyResearchSummary(): ResearchSummary {
  return {
    totalPapers: 0,
    totalCitations: 0,
    hIndex: 0,
    peakYear: null,
    peakYearCount: 0,
    topVenues: [],
    earliestYear: null,
    latestYear: null,
    yearsActive: null,
  };
}

function summariseResearch(publications: PublicationEntry[]): ResearchSummary {
  if (publications.length === 0) return emptyResearchSummary();
  const totalCitations = publications.reduce((sum, p) => sum + p.citations, 0);
  const yearCounts = new Map<number, number>();
  const venueCounts = new Map<string, number>();
  for (const p of publications) {
    yearCounts.set(p.year, (yearCounts.get(p.year) ?? 0) + 1);
    if (p.venue) venueCounts.set(p.venue, (venueCounts.get(p.venue) ?? 0) + 1);
  }
  let peakYear: number | null = null;
  let peakYearCount = 0;
  for (const [year, n] of yearCounts) {
    if (n > peakYearCount) {
      peakYear = year;
      peakYearCount = n;
    }
  }
  const topVenues = [...venueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([venue, count]) => ({ venue, count }));
  const years = publications.map((p) => p.year).filter(Number.isFinite);
  const earliestYear = years.length > 0 ? Math.min(...years) : null;
  const latestYear = years.length > 0 ? Math.max(...years) : null;
  const yearsActive =
    earliestYear !== null && latestYear !== null
      ? Math.max(1, latestYear - earliestYear + 1)
      : null;
  return {
    totalPapers: publications.length,
    totalCitations,
    hIndex: computeHIndex(publications.map((p) => p.citations)),
    peakYear,
    peakYearCount,
    topVenues,
    earliestYear,
    latestYear,
    yearsActive,
  };
}

/**
 * h-index = the largest h such that h papers have each been cited at
 * least h times. Computed from a list of citation counts.
 *
 *   citations = [10, 8, 5, 4, 3, 2] → h = 4
 *     (4 papers cited >= 4 times: 10, 8, 5, 4)
 */
function computeHIndex(citations: number[]): number {
  const sorted = [...citations].sort((a, b) => b - a);
  let h = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i]! >= i + 1) h = i + 1;
    else break;
  }
  return h;
}

interface ResearchOutputRow {
  id: string;
  year: number;
  type: string;
  title: string;
  venue: string | null;
  citations: number;
  scopusId: string | null;
  openalexId: string | null;
  pmid: string | null;
  doi: string | null;
  kkuAuthorName: string | null;
  source: string | null;
  scholarPaperId: string | null;
}

/**
 * Dedupe ResearchOutput rows by external ID. The same paper lands
 * once per source (Scopus AND PubMed AND OpenAlex), each with its
 * own row. Group on the strongest available key — DOI > scopusId >
 * pmid > openalexId — and merge.
 */
function dedupePublications(rows: ResearchOutputRow[]): PublicationEntry[] {
  const grouped = new Map<string, ResearchOutputRow[]>();
  for (const r of rows) {
    const key =
      (r.doi && `doi:${r.doi.toLowerCase()}`) ||
      (r.scopusId && `scopus:${r.scopusId}`) ||
      (r.pmid && `pmid:${r.pmid}`) ||
      (r.openalexId && `oa:${r.openalexId}`) ||
      `id:${r.id}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(r);
    else grouped.set(key, [r]);
  }
  const out: PublicationEntry[] = [];
  for (const bucket of grouped.values()) {
    // Use the row with the highest citation count as the "canonical"
    // record. Different sources sometimes report different citation
    // counts; prefer the larger.
    const canonical = bucket.reduce((best, cur) =>
      cur.citations > best.citations ? cur : best,
    );
    const kkuAuthors = Array.from(
      new Set(bucket.map((r) => r.kkuAuthorName).filter((n): n is string => !!n)),
    );
    out.push({
      id: canonical.id,
      year: canonical.year,
      title: canonical.title,
      venue: canonical.venue,
      citations: canonical.citations,
      doi: canonical.doi,
      scopusId: canonical.scopusId,
      pmid: canonical.pmid,
      openalexId: canonical.openalexId,
      type: canonical.type,
      kkuAuthors,
      // Filled by enrichPublicationsWithAuthors() after dedup runs;
      // empty here so the pure-dedup function stays side-effect-free.
      authors: [],
      authorsAreComplete: false,
      source: canonical.source,
      scholarPaperId: canonical.scholarPaperId,
    });
  }
  // Sort by year desc, then citations desc within year.
  out.sort((a, b) => b.year - a.year || b.citations - a.citations);
  return out;
}

const TITLE_PREFIXES = new Set([
  'นาย', 'นาง', 'นางสาว', 'น.ส.', 'น.ส',
  'ดร.', 'ดร', 'ผศ.', 'ผศ', 'ผศ.ดร.', 'ผศ.ดร',
  'รศ.', 'รศ', 'รศ.ดร.', 'รศ.ดร', 'ศ.', 'ศ', 'ศ.ดร.', 'ศ.ดร',
  'อ.', 'อ',
]);

export function stripTitlePrefixes(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && TITLE_PREFIXES.has(tokens[0]!)) {
    tokens.shift();
  }
  return tokens.join(' ');
}

// Cache TTL — how long a row counts as "fresh enough" before the
// stale-while-revalidate path fires a background refresh. 24h is a
// reasonable default; publications don't change by the minute.
const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

// In-process guard preventing the same staff record from spawning multiple
// concurrent background refreshes (common when several profile-page
// loads land on the same Node worker within a short window).
const inFlightRefreshes = new Set<string>();

interface CachedPublications {
  papers: PublicationEntry[];
  status: PublicationsCacheStatus;
  fetchedAt: string;
}

/**
 * Stale-while-revalidate loader for a staff record's enriched publication
 * list. The `compute` callback runs the full pipeline (kkuscholar
 * fetch + DOI bridge + dedupe + enrichment) and is invoked only on
 * cache miss or background refresh — warm paths return immediately
 * from local Postgres.
 *
 *   - Cache hit: returns the cached payload immediately. If the row
 *     is older than CACHE_FRESH_MS, schedules a fire-and-forget
 *     background refresh (the next page load picks up new data).
 *   - Cache INVALIDATED: a row the Scholar runner backdated is treated
 *     as a miss, so a sync's result is on the very next load.
 *   - Cache miss: blocks on `compute()` and writes the cache row.
 *
 * Also reports how the list was served (`hit` / `stale` / `miss`) and when
 * it was computed, so callers never need a second freshness decision.
 *
 * Errors during background refresh are logged but never thrown.
 */
async function loadPublicationsWithCache(
  facultyMemberId: string,
  compute: () => Promise<PublicationEntry[]>,
): Promise<CachedPublications> {
  const cached = await prisma.staffPublicationsCache.findUnique({
    where: { facultyMemberId },
  });

  // The three-way decision — miss / serve / serve-and-revalidate — is a pure
  // function in publication-source-precedence.ts so the invalidation branch
  // can be tested without a database. Its doc comment carries the reasoning;
  // the short version is that a row the Scholar runner just invalidated must
  // NOT take the stale-while-revalidate path, or the page load that follows a
  // sync shows the list from before it.
  const action = decidePublicationsCacheAction({
    cachedFetchedAtMs: cached?.fetchedAt.getTime() ?? null,
    nowMs: Date.now(),
    freshForMs: CACHE_FRESH_MS,
  });

  if (cached && action !== 'compute') {
    if (action === 'serve-and-revalidate' && !inFlightRefreshes.has(facultyMemberId)) {
      inFlightRefreshes.add(facultyMemberId);
      // Fire-and-forget — does NOT block the current request.
      void (async () => {
        try {
          await writeCache(facultyMemberId, await compute());
        } catch (err) {
          console.warn(
            `[staff-profile] background publications refresh failed for member=${facultyMemberId}:`,
            (err as Error).message,
          );
        } finally {
          inFlightRefreshes.delete(facultyMemberId);
        }
      })();
    }
    return {
      papers: cached.payloadJson as unknown as PublicationEntry[],
      status: action === 'serve' ? 'hit' : 'stale',
      fetchedAt: cached.fetchedAt.toISOString(),
    };
  }

  // Cache miss — block on the live pipeline and write the row.
  const fresh = await compute();
  const fetchedAt = await writeCache(facultyMemberId, fresh);
  return { papers: fresh, status: 'miss', fetchedAt };
}

async function writeCache(facultyMemberId: string, papers: PublicationEntry[]): Promise<string> {
  const row = await prisma.staffPublicationsCache.upsert({
    where: { facultyMemberId },
    update: {
      payloadJson: papers as unknown as Prisma.InputJsonValue,
      paperCount: papers.length,
      fetchedAt: new Date(),
    },
    create: {
      facultyMemberId,
      payloadJson: papers as unknown as Prisma.InputJsonValue,
      paperCount: papers.length,
    },
    select: { fetchedAt: true },
  });
  return row.fetchedAt.toISOString();
}

// ─── Home-page publications snapshot ──────────────────────────────────
// Publications-per-year for the home page sparkline. Goes through the same
// loadPublicationsWithCache path as the profile builder — same
// stale-while-revalidate semantics, same Scopus resolver, same kkuscholar
// fallback:
//
//   - Cache hit + fresh: returns immediately (~5ms).
//   - Cache hit + stale: returns the stale data immediately AND fires
//     a background refresh against live Scopus. The next page load
//     picks up the new data.
//   - Cache miss: blocks on the full pipeline (~3-5s with Scopus
//     AU-ID lookup). Caches the result so subsequent loads are fast.

export interface StaffPublicationsSnapshot {
  byYear: Array<{ year: number; count: number }>;
  totalPapers: number;
  fetchedAt: string;
  /** True when served from a cache row past CACHE_FRESH_MS (a background
   *  refresh is running) — the home page shows a subtle "refreshing…" hint. */
  isStale: boolean;
}

export async function getStaffPublicationsSnapshot(
  facultyMemberId: string,
): Promise<StaffPublicationsSnapshot | null> {
  const member = await prisma.facultyMember.findUnique({
    where: { id: facultyMemberId },
    select: { id: true, nameEn: true, nameTh: true, employeeCode: true, scopusAuthorId: true },
  });
  if (!member) return null;

  // Local ResearchOutput rows — bounded by the per-author paper count, and
  // the input to the source-precedence rule, since it carries each row's
  // `source`.
  const localPapers = await prisma.researchOutput.findMany({
    where: { facultyMemberId: member.id },
    orderBy: { year: 'desc' },
  });
  const dedupedLocal = dedupePublications(localPapers);

  // Same compute, through the same function, writing the same row as
  // buildStaffProfile — two implementations would take turns overwriting it
  // and the profile list would flip depending on which page loaded last.
  const pubs = await loadPublicationsWithCache(member.id, () =>
    computePublications(member, dedupedLocal, hasScholarImport(localPapers)),
  );

  const byYearMap = new Map<number, number>();
  for (const p of pubs.papers) {
    if (typeof p.year === 'number') byYearMap.set(p.year, (byYearMap.get(p.year) ?? 0) + 1);
  }
  return {
    byYear: [...byYearMap.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
    totalPapers: pubs.papers.length,
    fetchedAt: pubs.fetchedAt,
    isStale: pubs.status === 'stale',
  };
}
