import {
  prisma,
  combineLinkSources,
  eligiblePostingLevels,
  matchFieldToProgramme,
  scoreFieldOfStudyLink,
  scoreSkillOverlapLink,
  distinctiveDemand,
  skillOverlapCounts,
  matchedPostingCounts,
  JOBTHAI_BRIDGE_VERSION,
  JOBTHAI_MIN_POSTINGS_FOR_SIGNAL,
  MAX_PROGRAMMES_PER_FIELD,
  MIN_POSTINGS_PER_LINK,
} from '@kku/db';

import { deriveOccupations, occupationCode } from './derive-occupations';
import { loadSkillTerms, matchSkillTerms, rollUpOccupationSkills, type PostingSkillMatch } from './match-skills';

// ─────────────────────────────────────────────────────────────────────────────
// JobThai derived layers — occupations, skill matches and programme links.
//
// Everything downstream of job_postings is DERIVED from whatever postings exist
// right now: jobthai_occupations, job_posting_skills, jobthai_occupation_skills
// and program_jobthai_links. Until 2026-09-13 these were rebuilt only by two
// operator scripts, so uploading or deleting a file left every programme on
// the old (or, on a fresh install, empty) demand with no hint why — found on
// prod, where 47,631 postings loaded and every Deep-Dive still read "No JobThai
// demand signal". The connector now calls refreshJobThaiDerived() at the end of
// each run once no batch is pending; the scripts remain for dry runs.
//
// Deliberately NOT here: the skill-taxonomy dedupe (a one-off repair, not a
// function of the files) and the AI curriculum match (it costs money per
// programme and is run by the pipeline).
// ─────────────────────────────────────────────────────────────────────────────

export type RefreshLog = (line: string) => void;

const PAGE = 2000;

export interface DeriveSummary {
  occupations: number;
  staleOccupationsRemoved: number;
  postings: number;
  postingSkillLinks: number;
  occupationSkillRows: number;
  postingsWithAnySkill: number;
}

/** Phases 2 + 3: occupations from postings, then deterministic skill matching. */
export async function deriveJobThai(opts: { apply: boolean; skipSkills?: boolean; log?: RefreshLog }): Promise<DeriveSummary> {
  const log = opts.log ?? (() => undefined);
  const t0 = Date.now();

  const occ = await deriveOccupations(opts.apply);
  log(`occupations: ${occ.occupations} from ${occ.postings} postings`);

  // An occupation whose postings were all deleted is not demand any more.
  // Upsert alone would leave it with its old posting count and skills.
  let staleOccupationsRemoved = 0;
  if (opts.apply) {
    const rows = await prisma.jobPosting.findMany({
      where: { source: 'jobthai', jobCategory: { not: null }, jobSubcategory: { not: null } },
      select: { jobCategory: true, jobSubcategory: true },
      distinct: ['jobCategory', 'jobSubcategory'],
    });
    const live = new Set(rows.map((r) => occupationCode(r.jobCategory!, r.jobSubcategory!)));
    const all = await prisma.jobThaiOccupation.findMany({ select: { id: true, code: true } });
    const stale = all.filter((o) => !live.has(o.code)).map((o) => o.id);
    if (stale.length > 0) {
      await prisma.jobThaiOccupation.deleteMany({ where: { id: { in: stale } } });
      staleOccupationsRemoved = stale.length;
      log(`removed ${stale.length} occupation(s) with no remaining postings`);
    }
  }

  const summary: DeriveSummary = {
    occupations: occ.occupations,
    staleOccupationsRemoved,
    postings: occ.postings,
    postingSkillLinks: 0,
    occupationSkillRows: 0,
    postingsWithAnySkill: 0,
  };
  if (opts.skipSkills) return summary;

  const terms = await loadSkillTerms();
  log(`search terms: ${terms.length} (skills + RESOLVED aliases)`);

  const occupations = await prisma.jobThaiOccupation.findMany({ select: { id: true, code: true, postingCount: true } });
  const occByCode = new Map(occupations.map((o) => [o.code, o]));
  const matchesByOccupation = new Map<string, PostingSkillMatch[]>();
  const postingSkillRows: Array<{ jobPostingId: string; skillId: string }> = [];
  let scanned = 0;

  for (let skip = 0; ; skip += PAGE) {
    const page = await prisma.jobPosting.findMany({
      where: { source: 'jobthai' },
      select: { id: true, jobCategory: true, jobSubcategory: true, qualificationRaw: true, descriptionRaw: true },
      orderBy: { id: 'asc' },
      skip,
      take: PAGE,
    });
    if (page.length === 0) break;
    for (const p of page) {
      const skillIds = matchSkillTerms(`${p.qualificationRaw ?? ''} ${p.descriptionRaw}`, terms);
      scanned += 1;
      if (skillIds.length > 0) summary.postingsWithAnySkill += 1;
      for (const skillId of skillIds) postingSkillRows.push({ jobPostingId: p.id, skillId });
      if (p.jobCategory && p.jobSubcategory) {
        const occRow = occByCode.get(occupationCode(p.jobCategory, p.jobSubcategory));
        if (occRow) {
          const list = matchesByOccupation.get(occRow.id) ?? [];
          for (const skillId of skillIds) list.push({ postingId: p.id, skillId, extractedBy: 'ALIAS_MATCHED' });
          matchesByOccupation.set(occRow.id, list);
        }
      }
    }
    log(`scanned ${scanned} postings (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  summary.postingSkillLinks = postingSkillRows.length;

  if (!opts.apply) return summary;

  // Replace links for this source, then insert. createMany is an order of
  // magnitude faster than per-row upserts at this volume.
  await prisma.jobPostingSkill.deleteMany({ where: { jobPosting: { source: 'jobthai' } } });
  for (let i = 0; i < postingSkillRows.length; i += 5000) {
    const chunk = postingSkillRows.slice(i, i + 5000).map((r) => ({ ...r, extractedBy: 'ALIAS_MATCHED' as const, weight: 1 }));
    await prisma.jobPostingSkill.createMany({ data: chunk, skipDuplicates: true });
  }

  await prisma.jobThaiOccupationSkill.deleteMany({});
  const occById = new Map(occupations.map((o) => [o.id, o]));
  for (const [occupationId, matches] of matchesByOccupation) {
    const occRow = occById.get(occupationId)!;
    const rolled = rollUpOccupationSkills({ occupationPostingCount: occRow.postingCount, matches });
    if (rolled.length === 0) continue;
    await prisma.jobThaiOccupationSkill.createMany({
      data: rolled.map((r) => ({
        jobThaiOccupationId: occupationId,
        skillId: r.skillId,
        postingCount: r.postingCount,
        share: r.share,
        extractedBy: r.extractedBy,
      })),
      skipDuplicates: true,
    });
    summary.occupationSkillRows += rolled.length;
  }
  log(`wrote ${summary.postingSkillLinks} job_posting_skills, ${summary.occupationSkillRows} jobthai_occupation_skills`);
  return summary;
}

export interface PlannedLink {
  programId: string;
  programCode: string;
  programName: string;
  programLevel: string;
  occupationId: string;
  occupationLabel: string;
  linkSource: string;
  score: number;
  postingCount: number;
  evidenceTh: string;
}

export interface LinkPlan {
  planned: PlannedLink[];
  programmes: number;
  occupations: number;
  genericSkills: number;
  promiscuousFields: number;
  totalFields: number;
  linkedProgrammes: number;
  clearingFloor: number;
  postgraduateProgrammes: number;
  postgraduateLinked: number;
  bySource: Record<string, number>;
}

/** The programme ↔ occupation bridge (jobthai-bridge.v2), computed from current data. */
export async function planJobThaiLinks(): Promise<LinkPlan> {
  const programmes = await prisma.program.findMany({
    where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    select: { id: true, code: true, nameTh: true, nameEn: true, level: true },
    orderBy: { code: 'asc' },
  });

  const occupations = await prisma.jobThaiOccupation.findMany({
    select: {
      id: true, category: true, subcategory: true, postingCount: true,
      skills: { select: { skillId: true, share: true } },
    },
  });
  // v2: demand at the posting-share floor, generic skills set aside.
  const { demandedByOccupation, generic } = distinctiveDemand(
    occupations.flatMap((o) => o.skills.map((s) => ({ occupationId: o.id, skillId: s.skillId, share: s.share }))),
    occupations.length,
  );

  // One entry per POSTING with its education floor and stated fields; v1
  // unnested fields and summed per field, counting a two-field posting twice.
  const postingRows = await prisma.jobPosting.findMany({
    where: { source: 'jobthai', jobCategory: { not: null }, jobSubcategory: { not: null } },
    select: { jobCategory: true, jobSubcategory: true, minEducationLevel: true, requiredFieldsRaw: true },
  });
  const byOccupation = new Map<string, Array<{ level: string; fields: string[] }>>();
  for (const r of postingRows) {
    const key = `${r.jobCategory}|${r.jobSubcategory}`;
    const list = byOccupation.get(key) ?? [];
    list.push({ level: String(r.minEducationLevel), fields: r.requiredFieldsRaw });
    byOccupation.set(key, list);
  }

  // A field matching many programmes carries no discriminating power. "Science"
  // matched 135 of 297; the median field matches 2. Computed from the current
  // programme list rather than hardcoded.
  const allFields = new Set<string>();
  for (const list of byOccupation.values()) for (const r of list) for (const f of r.fields) allFields.add(f);
  const promiscuous = new Set<string>();
  for (const f of allFields) {
    let hits = 0;
    for (const p of programmes) {
      if (matchFieldToProgramme(f, `${p.nameTh ?? ''} ${p.nameEn ?? ''}`)) hits += 1;
      if (hits > MAX_PROGRAMMES_PER_FIELD) break;
    }
    if (hits > MAX_PROGRAMMES_PER_FIELD) promiscuous.add(f);
  }

  const programSkills = await prisma.programSkill.findMany({ select: { programId: true, skillId: true } });
  const skillsByProgramme = new Map<string, Set<string>>();
  for (const ps of programSkills) {
    const set = skillsByProgramme.get(ps.programId) ?? new Set<string>();
    set.add(ps.skillId);
    skillsByProgramme.set(ps.programId, set);
  }

  const planned: PlannedLink[] = [];
  const perProgramme = new Map<string, number>();

  for (const p of programmes) {
    const levels = new Set(eligiblePostingLevels(String(p.level)));
    const taught = skillsByProgramme.get(p.id) ?? new Set<string>();
    const name = `${p.nameTh ?? ''} ${p.nameEn ?? ''}`;
    const fieldMatch = new Map<string, boolean>();
    const matchesField = (f: string): boolean => {
      let m = fieldMatch.get(f);
      if (m === undefined) {
        m = !promiscuous.has(f) && matchFieldToProgramme(f, name);
        fieldMatch.set(f, m);
      }
      return m;
    };

    for (const occ of occupations) {
      const rows = byOccupation.get(`${occ.category}|${occ.subcategory}`) ?? [];
      const counts = matchedPostingCounts({ postings: rows, levels, matchesField });
      const fieldScore = scoreFieldOfStudyLink(counts);

      const demanded = demandedByOccupation.get(occ.id) ?? new Set<string>();
      const overlap = skillOverlapCounts({ taught, demanded, generic });
      const skillScore = scoreSkillOverlapLink(overlap);

      const combined = combineLinkSources({ fieldScore, skillScore });
      if (!combined) continue;

      // A skill-only link is backed by the occupation's eligible postings, the
      // population its demand set came from; a field link by its matches.
      const postingCount = combined.linkSource === 'skill-overlap' ? counts.eligiblePostings : counts.matchedPostings;
      if (postingCount < MIN_POSTINGS_PER_LINK) continue;

      planned.push({
        programId: p.id,
        programCode: p.code,
        programName: (p.nameTh ?? p.nameEn ?? '').slice(0, 40),
        programLevel: String(p.level),
        occupationId: occ.id,
        occupationLabel: `${occ.category} / ${occ.subcategory}`,
        linkSource: combined.linkSource,
        score: combined.score,
        postingCount,
        evidenceTh:
          counts.matchedFields.length > 0
            ? `สาขาที่ตรงกัน: ${counts.matchedFields.slice(0, 6).join(', ')}`
            : `ทักษะเฉพาะที่ตรงกัน ${overlap.sharedSkills} จาก ${overlap.taughtSkills} ทักษะที่สอน`,
      });
      perProgramme.set(p.id, (perProgramme.get(p.id) ?? 0) + postingCount);
    }
  }

  const linkedProgrammes = new Set(planned.map((l) => l.programId));
  const postgrad = programmes.filter((p) => ['MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA'].includes(String(p.level)));
  return {
    planned,
    programmes: programmes.length,
    occupations: occupations.length,
    genericSkills: generic.size,
    promiscuousFields: promiscuous.size,
    totalFields: allFields.size,
    linkedProgrammes: linkedProgrammes.size,
    clearingFloor: [...perProgramme.values()].filter((n) => n >= JOBTHAI_MIN_POSTINGS_FOR_SIGNAL).length,
    postgraduateProgrammes: postgrad.length,
    postgraduateLinked: postgrad.filter((p) => linkedProgrammes.has(p.id)).length,
    bySource: planned.reduce<Record<string, number>>((acc, l) => {
      acc[l.linkSource] = (acc[l.linkSource] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

/** Replaces every programme link. Every row carries the run it came from. */
export async function writeJobThaiLinks(planned: ReadonlyArray<PlannedLink>, runId: string): Promise<number> {
  await prisma.programJobThaiLink.deleteMany({});
  let written = 0;
  for (let i = 0; i < planned.length; i += 2000) {
    const chunk = planned.slice(i, i + 2000);
    await prisma.programJobThaiLink.createMany({
      data: chunk.map((l) => ({
        programId: l.programId,
        jobThaiOccupationId: l.occupationId,
        linkSource: l.linkSource,
        score: l.score,
        postingCount: l.postingCount,
        evidenceTh: l.evidenceTh,
        methodVersion: JOBTHAI_BRIDGE_VERSION,
        // Without this realDataWhere() hides every link.
        ingestionRunId: runId,
      })),
      skipDuplicates: true,
    });
    written += chunk.length;
  }
  return written;
}

export interface RefreshSummary {
  derive: DeriveSummary;
  linksWritten: number;
  linkedProgrammes: number;
  clearingFloor: number;
  durationMs: number;
}

/** Rebuilds every JobThai derived layer from the postings that exist now. */
export async function refreshJobThaiDerived(opts: { runId: string; log?: RefreshLog }): Promise<RefreshSummary> {
  const t0 = Date.now();
  const derive = await deriveJobThai({ apply: true, log: opts.log });
  const plan = await planJobThaiLinks();
  const linksWritten = await writeJobThaiLinks(plan.planned, opts.runId);
  opts.log?.(`links: ${linksWritten} across ${plan.linkedProgrammes} programme(s), ${plan.clearingFloor} clearing the posting floor`);
  return { derive, linksWritten, linkedProgrammes: plan.linkedProgrammes, clearingFloor: plan.clearingFloor, durationMs: Date.now() - t0 };
}
