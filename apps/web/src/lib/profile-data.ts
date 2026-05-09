// Profile-page data fetcher. Bridges the logged-in User to their
// FacultyMember row (via HR `employeeId`), then aggregates everything
// the resume needs in one server-side call:
//
//   - Basic info (rank-prefixed name, position, faculty)
//   - Education / qualification (when populated by HR)
//   - Research summary (paper counts, citations, peak year, top venues)
//   - Programs the staffer teaches in (ProgramFaculty join)
//   - Publication list (ResearchOutput rows, deduped by external ID
//     across Scopus / PubMed / OpenAlex sources)
//
// Returns a `null` block for any section the data doesn't fill — the
// profile page renders graceful "no record yet" placeholders rather
// than fabricating content.

import { Prisma, prisma } from '@kku/db';
import type {
  AuthorName,
  FacultyRankCode,
  ProfileBasicInfo,
  EducationEntry,
  ResearchSummary,
  CurriculumProgram,
  PublicationEntry,
  ProfileData,
} from './profile-types';
import {
  fetchAuthorsByPaper,
  fetchKkuScholarPublicationsByPerson,
  type KkuScholarPublication,
  type PaperLookupKey,
} from './kku-publications';
import {
  fetchPublicationsByScopusAuthor,
  resolveScopusAuthorId,
} from './scopus-publications';
import {
  fetchExternalAuthors,
  fetchExternalAuthorsByMetadata,
} from './external-publications';

// Re-export the client-safe types so existing server-side callers
// continue to import them from here.
export type {
  FacultyRankCode,
  ProfileBasicInfo,
  EducationEntry,
  ResearchSummary,
  CurriculumProgram,
  PublicationEntry,
  ProfileData,
};

const RANK_LABEL: Record<FacultyRankCode, { th: string; en: string; thAbbrev: string; enAbbrev: string }> = {
  PROF: { th: 'ศาสตราจารย์', en: 'Professor', thAbbrev: 'ศ.', enAbbrev: 'Prof.' },
  ASSOC_PROF: { th: 'รองศาสตราจารย์', en: 'Associate Professor', thAbbrev: 'รศ.', enAbbrev: 'Assoc. Prof.' },
  ASST_PROF: { th: 'ผู้ช่วยศาสตราจารย์', en: 'Assistant Professor', thAbbrev: 'ผศ.', enAbbrev: 'Asst. Prof.' },
  LECTURER: { th: 'อาจารย์', en: 'Lecturer', thAbbrev: 'อ.', enAbbrev: 'Lect.' },
};

interface UserLookup {
  id: string;
  email: string;
  name: string | null;
  employeeId: string | null;
  faculty: { nameTh: string; nameEn: string } | null;
}

/**
 * Build the profile-page payload for a signed-in user. Returns null
 * when the User row can't be located — the page renders an "account
 * not yet provisioned" placeholder in that case.
 */
export async function getProfileData(userId: string): Promise<ProfileData | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      employeeId: true,
      avatarStorageKey: true,
      avatarUpdatedAt: true,
      faculty: { select: { nameTh: true, nameEn: true } },
    },
  });
  if (!user) return null;

  // Build the avatar URL — null when no photo uploaded. The
  // `?v=<timestamp>` cache-buster forces the browser to refetch
  // after a new upload without needing manual reload.
  const avatarUrl = user.avatarStorageKey
    ? `/api/profile/avatar/${user.id}?v=${user.avatarUpdatedAt?.getTime() ?? 0}`
    : null;

  // FacultyMember bridge: prefer employeeId (set by SSO callback);
  // fall back to a Thai-name match if the user predates the
  // employeeId capture (no longer needed once everyone re-logs).
  let member = user.employeeId
    ? await prisma.facultyMember.findFirst({
        where: { employeeId: user.employeeId, isActive: true },
        include: {
          faculty: { select: { nameTh: true, nameEn: true } },
          department: { select: { nameTh: true, nameEn: true } },
        },
      })
    : null;
  if (!member && user.name) {
    // Fallback — try the Thai name after stripping common honorifics.
    const stripped = stripTitlePrefixes(user.name);
    if (stripped) {
      member = await prisma.facultyMember.findFirst({
        where: { nameTh: stripped, isActive: true },
        include: {
          faculty: { select: { nameTh: true, nameEn: true } },
          department: { select: { nameTh: true, nameEn: true } },
        },
      });
    }
  }

  // Cached AI narrative — keyed by (userId, methodVersion). We pick
  // the latest row for this user regardless of method version so a
  // version bump doesn't blank the page; new requests will write a
  // fresh row with the current method.
  const cachedNarrativeRow = await prisma.userExpertiseNarrative.findFirst({
    where: { userId: user.id },
    orderBy: { generatedAt: 'desc' },
  });
  const cachedNarrative = cachedNarrativeRow
    ? {
        narrativeTh: cachedNarrativeRow.narrativeTh,
        narrativeEn: cachedNarrativeRow.narrativeEn,
        expertiseKeywordsTh: cachedNarrativeRow.expertiseKeywordsTh,
        expertiseKeywordsEn: cachedNarrativeRow.expertiseKeywordsEn,
        confidence: cachedNarrativeRow.confidence,
        generatedAt: cachedNarrativeRow.generatedAt.toISOString(),
        methodVersion: cachedNarrativeRow.methodVersion,
      }
    : null;

  if (!member) {
    // Graceful degradation: render the basic section with whatever's
    // on the User row + empty sections for everything else.
    return {
      hasFacultyMemberRecord: false,
      basic: buildBasicInfo(user, null, [], avatarUrl),
      education: [],
      research: emptyResearchSummary(),
      curriculum: [],
      publications: [],
      cachedNarrative,
    };
  }

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

  // Two publication sources, merged by DOI / scopusId / pmid:
  //
  //   (a) kkuscholar mirror — direct query by KKU person identity
  //       (employeeCode `kkupub_<personId>` → people.id, else by
  //       English name). Returns FULL author lists going back as far
  //       as kkuscholar carries (often 1997+).
  //   (b) Local ResearchOutput rows — captures legacy OpenAlex-imported
  //       papers + IEEE/specialty conferences kkuscholar doesn't track.
  //
  // (a) is canonical; (b) fills gaps. Papers in both are deduped by
  // their strongest external id; (a)'s author list wins.
  //
  // The kkuscholar query + DOI bridge fallback together cost ~30s
  // cold (live LAN queries to a Postgres mirror at 10.130.2.151).
  // We cache the FULLY-ENRICHED publication array in
  // `user_publications_cache` and serve from local Postgres on warm
  // paths — ~50ms instead of ~30s.
  //
  // Cache TTL = CACHE_FRESH_MS. Newer rows in our local
  // `research_outputs` between refreshes won't appear until the
  // cache turns over; that's an acceptable freshness tradeoff for
  // a 24h window.
  const dedupedLocal = dedupePublications(papers);
  const ownerSurname = lastTokenOf(member.nameEn);
  const ownerGiven = firstTokenOf(member.nameEn);
  const publications = await loadPublicationsWithCache(user.id, async () => {
    // Primary path: pull every paper from Scopus by AU-ID. ~2-3s
    // with full per-paper author lists, vs the kkuscholar mirror's
    // 30-45s.
    //
    // Profile-page-only — bulk modules (cockpit, gap-analyzer,
    // benchmarking) continue reading from kkuscholar to stay under
    // Scopus's 20k-req/week institutional rate limit.
    //
    // Resolution order for the Scopus author id:
    //   1. FacultyMember.scopusAuthorId (cached from a prior visit
    //      or seeded by the kku-research connector).
    //   2. Live Scopus author search by name + KKU affiliation —
    //      cached back to the FacultyMember row so subsequent
    //      cold-cache loads skip resolution.
    let scopusAuthorId = member.scopusAuthorId;
    if (!scopusAuthorId && ownerSurname && ownerGiven) {
      const resolved = await resolveScopusAuthorId({
        surnameEn: ownerSurname,
        givenEn: ownerGiven,
      }).catch(() => null);
      if (resolved) {
        scopusAuthorId = resolved.authorId;
        // Fire-and-forget cache write so the next cold load skips
        // the resolution. Failures are not actionable.
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

    // kkuscholar fallback — only fire when Scopus came up empty.
    // Covers Thai-only researchers + medical faculty whose primary
    // footprint is in TCI / PubMed rather than Scopus.
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
  });

  const research = summariseResearch(publications);
  const basic = buildBasicInfo(user, member, education, avatarUrl);

  return {
    hasFacultyMemberRecord: true,
    basic,
    education,
    research,
    curriculum,
    publications,
    cachedNarrative,
  };
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
          `[profile-data] DOI author fetch failed for doi=${p.doi}:`,
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
          `[profile-data] metadata-search author fetch failed for "${p.title.slice(0, 50)}":`,
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

function buildBasicInfo(
  user: UserLookup,
  member: {
    rank: FacultyRankCode;
    nameTh: string;
    nameEn: string;
    academicQualification: string | null;
    orcid: string | null;
    scopusAuthorId: string | null;
    openalexAuthorId: string | null;
    faculty: { nameTh: string; nameEn: string } | null;
    department: { nameTh: string; nameEn: string } | null;
  } | null,
  education: EducationEntry[],
  avatarUrl: string | null,
): ProfileBasicInfo {
  // Detect "Dr." style qualification from the resolved education
  // entries OR from the legacy academicQualification string. Adds a
  // "ดร." / "Dr." after the rank prefix.
  const hasDoctorate =
    education.some((e) =>
      /ph\.?\s*d|doctor|doctoral|ปริญญาเอก|ดุษฎีบัณฑิต|ดร\./i.test(
        `${e.qualification} ${e.level ?? ''}`,
      ),
    ) || /ph\.?\s*d|ปริญญาเอก|ดร\./i.test(member?.academicQualification ?? '');

  if (member) {
    const rank = RANK_LABEL[member.rank];
    const dr = hasDoctorate ? ' ดร.' : '';
    const drEn = hasDoctorate ? ' Dr.' : '';
    return {
      fullNameTh: `${rank.thAbbrev}${dr} ${member.nameTh}`.replace(/\s+/g, ' ').trim(),
      fullNameEn: `${rank.enAbbrev}${drEn} ${member.nameEn}`.replace(/\s+/g, ' ').trim(),
      rankLabelTh: rank.th,
      rankLabelEn: rank.en,
      facultyNameTh: member.faculty?.nameTh ?? null,
      facultyNameEn: member.faculty?.nameEn ?? null,
      departmentNameTh: member.department?.nameTh ?? null,
      departmentNameEn: member.department?.nameEn ?? null,
      email: user.email,
      orcid: member.orcid,
      scopusAuthorId: member.scopusAuthorId,
      openalexAuthorId: member.openalexAuthorId,
      avatarUrl,
    };
  }
  // No FacultyMember match — render whatever's on the User row.
  return {
    fullNameTh: user.name ?? user.email,
    fullNameEn: user.name ?? user.email,
    rankLabelTh: '—',
    rankLabelEn: '—',
    facultyNameTh: user.faculty?.nameTh ?? null,
    facultyNameEn: user.faculty?.nameEn ?? null,
    departmentNameTh: null,
    departmentNameEn: null,
    email: user.email,
    orcid: null,
    scopusAuthorId: null,
    openalexAuthorId: null,
    avatarUrl,
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

function emptyResearchSummary(): ResearchSummary {
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

function stripTitlePrefixes(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && TITLE_PREFIXES.has(tokens[0]!)) {
    tokens.shift();
  }
  return tokens.join(' ');
}

// `formatApa` lives in `./profile-types` so client components can use
// it without dragging Prisma into the browser bundle. Re-exported here
// for callers that already pull `getProfileData` from this module.
export { formatApa } from './profile-types';

// Cache TTL — how long a row counts as "fresh enough" before the
// stale-while-revalidate path fires a background refresh. 24h is a
// reasonable default; publications don't change by the minute.
const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

// In-process guard preventing the same user from spawning multiple
// concurrent background refreshes (common when several profile-page
// loads land on the same Node worker within a short window).
const inFlightRefreshes = new Set<string>();

/**
 * Stale-while-revalidate loader for the user's enriched publication
 * list. The `compute` callback runs the full pipeline (kkuscholar
 * fetch + DOI bridge + dedupe + enrichment) and is invoked only on
 * cache miss or background refresh — warm paths return immediately
 * from local Postgres.
 *
 *   - Cache hit: returns the cached payload immediately. If the row
 *     is older than CACHE_FRESH_MS, schedules a fire-and-forget
 *     background refresh (the next page load picks up new data).
 *   - Cache miss: blocks on `compute()` and writes the cache row.
 *
 * Errors during background refresh are logged but never thrown.
 */
async function loadPublicationsWithCache(
  userId: string,
  compute: () => Promise<PublicationEntry[]>,
): Promise<PublicationEntry[]> {
  const cached = await prisma.userPublicationsCache.findUnique({
    where: { userId },
  });

  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt.getTime();
    if (ageMs > CACHE_FRESH_MS && !inFlightRefreshes.has(userId)) {
      inFlightRefreshes.add(userId);
      // Fire-and-forget — does NOT block the current request.
      void (async () => {
        try {
          const fresh = await compute();
          await writeCache(userId, fresh);
        } catch (err) {
          console.warn(
            `[profile-data] background publications refresh failed for user=${userId}:`,
            (err as Error).message,
          );
        } finally {
          inFlightRefreshes.delete(userId);
        }
      })();
    }
    return cached.payloadJson as unknown as PublicationEntry[];
  }

  // Cache miss — block on the live pipeline and write the row.
  const fresh = await compute();
  await writeCache(userId, fresh);
  return fresh;
}

async function writeCache(
  userId: string,
  papers: PublicationEntry[],
): Promise<void> {
  await prisma.userPublicationsCache.upsert({
    where: { userId },
    update: {
      payloadJson: papers as unknown as Prisma.InputJsonValue,
      paperCount: papers.length,
      fetchedAt: new Date(),
    },
    create: {
      userId,
      payloadJson: papers as unknown as Prisma.InputJsonValue,
      paperCount: papers.length,
    },
  });
}
