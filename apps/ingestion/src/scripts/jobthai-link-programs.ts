// ─────────────────────────────────────────────────────────────────────────────
// jobthai:link-programs — the programme ↔ occupation bridge.
//
//   pnpm jobthai:link-programs               # dry run
//   pnpm jobthai:link-programs --apply       # write ProgramJobThaiLink
//   pnpm jobthai:link-programs --inspect 12  # print links for hand-checking
//
// Two independent paths per programme, then combined. Idempotent: links are
// replaced wholesale for each programme on a re-run.
//
// Every row is stamped with an ingestion run. Omitting that is what left 6,224
// program_demand_matches invisible to realDataWhere().
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';

import {
  prisma,
  combineLinkSources,
  eligiblePostingLevels,
  matchFieldToProgramme,
  scoreFieldOfStudyLink,
  scoreSkillOverlapLink,
  JOBTHAI_BRIDGE_VERSION,
  JOBTHAI_MIN_POSTINGS_FOR_SIGNAL,
  MAX_PROGRAMMES_PER_FIELD,
  MIN_POSTINGS_PER_LINK,
} from '@kku/db';

interface PlannedLink {
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

async function resolveRunId(): Promise<string | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug: 'jobthai' } },
    orderBy: { completedAt: 'desc' },
    select: { id: true },
  });
  return run?.id ?? null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const inspectIdx = process.argv.indexOf('--inspect');
  const inspectN = inspectIdx === -1 ? 0 : Number(process.argv[inspectIdx + 1] ?? 12);

  const programmes = await prisma.program.findMany({
    where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    select: { id: true, code: true, nameTh: true, nameEn: true, level: true },
    orderBy: { code: 'asc' },
  });

  const occupations = await prisma.jobThaiOccupation.findMany({
    select: {
      id: true, category: true, subcategory: true, postingCount: true,
      skills: { select: { skillId: true } },
    },
  });

  // Per occupation, the fields of study its postings state, split by the
  // posting's own education floor — that split IS the honest-signal gate.
  const fieldRows = await prisma.$queryRaw<Array<{
    job_category: string; job_subcategory: string; min_education_level: string;
    field: string; postings: bigint;
  }>>`
    SELECT job_category, job_subcategory, min_education_level::text AS min_education_level,
           unnest(required_fields_raw) AS field, COUNT(*)::bigint AS postings
    FROM job_postings
    WHERE source = 'jobthai' AND job_category IS NOT NULL AND job_subcategory IS NOT NULL
    GROUP BY 1, 2, 3, 4`;

  const byOccupation = new Map<string, Array<{ level: string; field: string; postings: number }>>();
  for (const r of fieldRows) {
    const key = `${r.job_category}|${r.job_subcategory}`;
    const list = byOccupation.get(key) ?? [];
    list.push({ level: r.min_education_level, field: r.field, postings: Number(r.postings) });
    byOccupation.set(key, list);
  }

  // A field matching many programmes carries no discriminating power. "Science"
  // matches 135 of 297; the median field matches 2. Without this filter the
  // bridge emitted Geotechnology -> Food Science because "technology" appears in
  // both. Computed here rather than hardcoded so it tracks the programme list.
  const allFields = new Set<string>();
  for (const list of byOccupation.values()) for (const r of list) allFields.add(r.field);
  const promiscuous = new Set<string>();
  for (const f of allFields) {
    let hits = 0;
    for (const p of programmes) {
      if (matchFieldToProgramme(f, `${p.nameTh ?? ''} ${p.nameEn ?? ''}`)) hits += 1;
      if (hits > MAX_PROGRAMMES_PER_FIELD) break;
    }
    if (hits > MAX_PROGRAMMES_PER_FIELD) promiscuous.add(f);
  }
  console.log(`fields rejected as too generic: ${promiscuous.size} of ${allFields.size}`);

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

    for (const occ of occupations) {
      const rows = byOccupation.get(`${occ.category}|${occ.subcategory}`) ?? [];
      // ── field path, gated on the POSTING's education floor ──
      const eligible = rows.filter((r) => levels.has(r.level));
      const distinctFields = new Set(eligible.map((r) => r.field));
      const matched = [...distinctFields].filter((f) => !promiscuous.has(f) && matchFieldToProgramme(f, name));
      const fieldPostings = eligible
        .filter((r) => matched.includes(r.field))
        .reduce((s, r) => s + r.postings, 0);
      const fieldScore = scoreFieldOfStudyLink({
        matchedFields: matched.length,
        totalFieldsForOccupation: distinctFields.size,
      });

      // ── skill path ──
      const occSkills = new Set(occ.skills.map((s) => s.skillId));
      const shared = [...occSkills].filter((s) => taught.has(s));
      // Denominator is what the PROGRAMME teaches — see scoreSkillOverlapLink.
      const skillScore = scoreSkillOverlapLink({ sharedSkills: shared.length, taughtSkills: taught.size });

      const combined = combineLinkSources({ fieldScore, skillScore });
      if (!combined) continue;

      // Postings behind the link. The field path counts its own matched
      // postings; a skill-only link is backed by the occupation's eligible
      // postings, since that is the population the demand set came from.
      const eligiblePostings = eligible.reduce((s, r) => s + r.postings, 0);
      const postingCount = combined.linkSource === 'skill-overlap' ? eligiblePostings : fieldPostings;
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
          matched.length > 0
            ? `สาขาที่ตรงกัน: ${matched.slice(0, 6).join(', ')}`
            : `ทักษะที่ตรงกัน ${shared.length} จาก ${occSkills.size} รายการ`,
      });
      perProgramme.set(p.id, (perProgramme.get(p.id) ?? 0) + postingCount);
    }
  }

  const bySource = planned.reduce<Record<string, number>>((acc, l) => {
    acc[l.linkSource] = (acc[l.linkSource] ?? 0) + 1;
    return acc;
  }, {});
  const linkedProgrammes = new Set(planned.map((l) => l.programId));
  const clearFloor = [...perProgramme.entries()].filter(([, n]) => n >= JOBTHAI_MIN_POSTINGS_FOR_SIGNAL);
  const postgrad = programmes.filter((p) => ['MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA'].includes(String(p.level)));
  const postgradLinked = postgrad.filter((p) => linkedProgrammes.has(p.id));

  console.log(`=== jobthai:link-programs (${apply ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`programmes            : ${programmes.length}`);
  console.log(`occupations           : ${occupations.length}`);
  console.log(`links planned         : ${planned.length}  ${JSON.stringify(bySource)}`);
  console.log(`programmes with a link: ${linkedProgrammes.size}`);
  console.log(`  ...clearing the ${JOBTHAI_MIN_POSTINGS_FOR_SIGNAL}-posting floor: ${clearFloor.length}`);
  console.log(`postgraduate programmes: ${postgrad.length}, of which linked: ${postgradLinked.length}`);
  console.log(`  (expect near-zero — only 41 postings state a postgraduate minimum; that is the gate working)`);

  if (inspectN > 0) {
    console.log('\n─── sample links for hand-checking ───');
    const sample = [...planned].sort((a, b) => b.score - a.score).filter((_, i) => i % Math.max(1, Math.floor(planned.length / inspectN)) === 0).slice(0, inspectN);
    for (const l of sample) {
      console.log(`  ${l.score.toFixed(2)} ${l.linkSource.padEnd(15)} ${l.postingCount.toString().padStart(5)} postings`);
      console.log(`      ${l.programCode} ${l.programName} [${l.programLevel}]`);
      console.log(`      -> ${l.occupationLabel}`);
      console.log(`      ${l.evidenceTh}`);
    }
  }

  if (!apply) {
    console.log('\nDRY RUN — pass --apply to write.');
    await prisma.$disconnect();
    return;
  }

  const runId = await resolveRunId();
  if (!runId) {
    console.error('No SUCCEEDED jobthai ingestion run to attribute these links to. Run the connector first.');
    process.exit(1);
  }

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
        ingestionRunId: runId,
      })),
      skipDuplicates: true,
    });
    written += chunk.length;
  }
  console.log(`\nwrote ${written} program_jobthai_links (run ${runId})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
