// ─────────────────────────────────────────────────────────────────────────────
// jobthai:derive — phases 2 and 3.
//
//   pnpm jobthai:derive                # dry run, reports what it would do
//   pnpm jobthai:derive --apply        # writes occupations + skill matches
//   pnpm jobthai:derive --apply --skip-skills
//
// Idempotent. Occupations upsert on (category, subcategory); skill matches are
// replaced per posting page, so a re-run after the taxonomy grows picks up new
// skills without duplicating old ones.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';

import { prisma } from '@kku/db';

import { deriveOccupations, occupationCode } from '../jobthai/derive-occupations';
import { loadSkillTerms, matchSkillTerms, rollUpOccupationSkills, type PostingSkillMatch } from '../jobthai/match-skills';

const PAGE = 2000;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const skipSkills = process.argv.includes('--skip-skills');
  const t0 = Date.now();

  console.log(`=== jobthai:derive (${apply ? 'APPLY' : 'DRY RUN'}) ===`);

  // ── Phase 2 ──
  const occ = await deriveOccupations(apply);
  console.log(`phase 2 occupations: ${occ.occupations} from ${occ.postings} postings`);
  if (skipSkills) {
    await prisma.$disconnect();
    return;
  }

  // ── Phase 3 ──
  const terms = await loadSkillTerms();
  console.log(`phase 3 search terms: ${terms.length} (from skills + RESOLVED aliases)`);

  const occupations = await prisma.jobThaiOccupation.findMany({ select: { id: true, code: true, postingCount: true } });
  const occByCode = new Map(occupations.map((o) => [o.code, o]));
  const matchesByOccupation = new Map<string, PostingSkillMatch[]>();

  let scanned = 0;
  let withAny = 0;
  const postingSkillRows: Array<{ jobPostingId: string; skillId: string }> = [];

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
      const text = `${p.qualificationRaw ?? ''} ${p.descriptionRaw}`;
      const skillIds = matchSkillTerms(text, terms);
      scanned += 1;
      if (skillIds.length > 0) withAny += 1;
      for (const skillId of skillIds) postingSkillRows.push({ jobPostingId: p.id, skillId });
      if (p.jobCategory && p.jobSubcategory) {
        const code = occupationCode(p.jobCategory, p.jobSubcategory);
        const occRow = occByCode.get(code);
        if (occRow) {
          const list = matchesByOccupation.get(occRow.id) ?? [];
          for (const skillId of skillIds) list.push({ postingId: p.id, skillId, extractedBy: 'ALIAS_MATCHED' });
          matchesByOccupation.set(occRow.id, list);
        }
      }
    }
    console.log(`  scanned ${scanned} postings (${Math.round((Date.now() - t0) / 1000)}s)`);
  }

  const distinctSkills = new Set(postingSkillRows.map((r) => r.skillId));
  console.log(`phase 3: ${postingSkillRows.length} posting-skill links, ${distinctSkills.size} distinct skills`);
  console.log(`phase 3: ${withAny} of ${scanned} postings matched >=1 skill (${((withAny / scanned) * 100).toFixed(1)}%)`);

  if (!apply) {
    await prisma.$disconnect();
    return;
  }

  // Replace links for this source, then insert. createMany is an order of
  // magnitude faster than per-row upserts at this volume.
  await prisma.jobPostingSkill.deleteMany({ where: { jobPosting: { source: 'jobthai' } } });
  for (let i = 0; i < postingSkillRows.length; i += 5000) {
    const chunk = postingSkillRows.slice(i, i + 5000).map((r) => ({ ...r, extractedBy: 'ALIAS_MATCHED' as const, weight: 1 }));
    await prisma.jobPostingSkill.createMany({ data: chunk, skipDuplicates: true });
  }
  console.log(`wrote ${postingSkillRows.length} job_posting_skills`);

  let occSkillRows = 0;
  await prisma.jobThaiOccupationSkill.deleteMany({});
  for (const [occupationId, matches] of matchesByOccupation) {
    const occRow = occupations.find((o) => o.id === occupationId)!;
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
    occSkillRows += rolled.length;
  }
  console.log(`wrote ${occSkillRows} jobthai_occupation_skills`);
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
