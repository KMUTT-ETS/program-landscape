// ─────────────────────────────────────────────────────────────────────────────
// programs:overlap — program-overlap.v1 scoring (spec §5, §8, §9).
//
//   pnpm programs:overlap                       # dry run, every level: computes, writes nothing
//   pnpm programs:overlap --level=BACHELOR      # one level
//   pnpm programs:overlap --apply               # write a full-portfolio run per level
//   pnpm programs:overlap --apply --no-ai       # ... without the AI recommendation wording
//   pnpm programs:overlap --calibrate           # READ-ONLY calibration report (spec §9)
//
// Needs `pnpm programs:overlap-prep --apply` first: without PLOs, course
// vectors and market profiles only the structure layer can score.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Inline env-file loader rather than `dotenv/config`: dotenv is not a
// dependency, and this script is esbuild-bundled for the prod ingestion image,
// where the environment comes from the container and this is a no-op.
loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import {
  prisma,
  cosine,
  loadOverlapProgrammes,
  majorCourses,
  serviceCourseCodes,
  OVERLAP_THRESHOLDS,
  PROGRAM_OVERLAP_VERSION,
  type OverlapCourse,
  type OverlapLoadCoverage,
  type OverlapProgramme,
  type PairScore,
  type ProgramLevel,
} from '@kku/db';

// createIngestionAiService is the ONLY sanctioned way to build an AiService in
// an ingestion script — it wires the model-override resolver.
import { createIngestionAiService } from '../lib/ai-service';
import {
  LEVELS,
  planRunPairs,
  runOverlapRecommendations,
  runProgramOverlap,
  summarise,
  summariseHistogram,
  type Distribution,
  type RunDistributions,
} from '../program-overlap/run';

// ── Formatting ──────────────────────────────────────────────────────────────

const LAYER_ROWS: Array<{ key: keyof RunDistributions; label: string; digits: number }> = [
  { key: 'structure', label: 'structure (0–100)', digits: 1 },
  { key: 'content', label: 'content (0–100)', digits: 1 },
  { key: 'outcome', label: 'outcome (0–100)', digits: 1 },
  { key: 'index', label: 'overlap index', digits: 1 },
  { key: 'containment', label: 'containment (both dirs)', digits: 1 },
  { key: 'market', label: 'market similarity', digits: 1 },
  { key: 'bestCourse', label: 'best course cosine/pair', digits: 3 },
  { key: 'bestPlo', label: 'best PLO cosine/pair', digits: 3 },
];

function distRow(label: string, d: Distribution | null, digits: number): string {
  const name = label.padEnd(30);
  if (!d) return `   ${name}     n=0   (no data)`;
  const f = (x: number): string => x.toFixed(digits).padStart(7);
  return `   ${name}${String(d.n).padStart(6)} ${f(d.p10)} ${f(d.p25)} ${f(d.p50)} ${f(d.p75)} ${f(d.p90)} ${f(d.max)}`;
}

function distHeader(): string {
  const h = (x: string): string => x.padStart(7);
  return `   ${''.padEnd(30)}${'n'.padStart(6)} ${h('p10')} ${h('p25')} ${h('p50')} ${h('p75')} ${h('p90')} ${h('max')}`;
}

function printDistributions(d: RunDistributions): void {
  console.log(distHeader());
  for (const r of LAYER_ROWS) console.log(distRow(r.label, d[r.key], r.digits));
}

function printCoverage(c: OverlapLoadCoverage): void {
  console.log(`   programmes ${c.programmes} · with courses ${c.withCourses} · with embedded courses ${c.withEmbeddedCourses}` +
    ` · with described courses ${c.withDescribedCourses} · with PLOs ${c.withPlos} · with market vector ${c.withMarketVector}` +
    ` · with active staff ${c.withActiveStaff}`);
  console.log(`   course rows ${c.courses} · embedded ${c.embeddedCourses} · described ${c.describedCourses}`);
}

const num = (x: number | null, digits = 1): string => (x === null ? '—' : x.toFixed(digits));
const clip = (s: string | null, n = 60): string => {
  if (!s) return '—';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ── Calibration (read-only) ─────────────────────────────────────────────────

/** mulberry32 — small seeded PRNG so the sample is the same on every run. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePairs<T>(xs: readonly T[], n: number, seed: number): T[] {
  const arr = [...xs];
  const rnd = seededRandom(seed);
  const k = Math.min(n, arr.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, k);
}

const CALIBRATION_SAMPLE = 200;
const CALIBRATION_SEED = 20261003;

interface BestMatchSample {
  courseDescription: number[];
  courseName: number[];
  plo: number[];
  pairsSampled: number;
  pairsEligible: number;
}

/** Per-item best matches over a seeded sample of pairs: each embedded major
 *  course (not shared by code) against the other programme's, split by basis,
 *  and each PLO against the other programme's PLOs. */
function bestMatchSample(
  pairs: readonly PairScore[],
  byId: ReadonlyMap<string, OverlapProgramme>,
  embedded: ReadonlyMap<string, OverlapCourse[]>,
): BestMatchSample {
  const eligible = pairs.filter((s) => {
    const a = byId.get(s.programAId)!, b = byId.get(s.programBId)!;
    const courses = embedded.get(a.id)!.length > 0 && embedded.get(b.id)!.length > 0;
    const plos = a.plos.length > 0 && b.plos.length > 0;
    return courses || plos;
  });
  const out: BestMatchSample = { courseDescription: [], courseName: [], plo: [], pairsSampled: 0, pairsEligible: eligible.length };
  const sample = samplePairs(eligible, CALIBRATION_SAMPLE, CALIBRATION_SEED);
  out.pairsSampled = sample.length;
  for (const s of sample) {
    const a = byId.get(s.programAId)!, b = byId.get(s.programBId)!;
    const shared = new Set(s.evidence.sharedCourses.map((c) => c.code));
    const candA = embedded.get(a.id)!.filter((c) => !shared.has(c.code));
    const candB = embedded.get(b.id)!.filter((c) => !shared.has(c.code));
    for (const [from, to] of [[candA, candB], [candB, candA]] as const) {
      if (!to.length) continue;
      for (const c of from) {
        let best = -Infinity;
        let bestOther: OverlapCourse | null = null;
        for (const o of to) {
          const sim = cosine(c.vector!, o.vector!);
          if (sim > best) { best = sim; bestOther = o; }
        }
        (c.described && bestOther!.described ? out.courseDescription : out.courseName).push(best);
      }
    }
    for (const [from, to] of [[a.plos, b.plos], [b.plos, a.plos]] as const) {
      if (!to.length) continue;
      for (const p of from) out.plo.push(Math.max(...to.map((o) => cosine(p.vector, o.vector))));
    }
  }
  return out;
}

function printPair(s: PairScore, byId: ReadonlyMap<string, OverlapProgramme>, faculty: ReadonlyMap<string, string>): void {
  const side = (p: OverlapProgramme): string =>
    `${p.code} ${clip(p.nameTh, 50)}${p.nameEn ? ` (${clip(p.nameEn, 50)})` : ''} · ${faculty.get(p.facultyId) ?? p.facultyId}` +
    `${p.language ? ` · ${p.language}` : ''}`;
  const a = byId.get(s.programAId)!, b = byId.get(s.programBId)!;
  console.log(`\n   [${num(s.overlapIndex).padStart(5)} ${s.band.padEnd(8)}] A ${side(a)}`);
  console.log(`                    B ${side(b)}`);
  console.log(
    `      S ${num(s.structure)} · C ${num(s.content)} · O ${num(s.outcome)}` +
      ` · contain A⊂B ${num(s.containmentAInB)} / B⊂A ${num(s.containmentBInA)}` +
      ` · market ${num(s.marketSimilarity)} · staff ${s.sharedStaff}` +
      `${s.languageVariant ? ' · LANGUAGE VARIANT' : ''}`,
  );
  const cov = s.evidence.coverage;
  console.log(
    `      coverage: major ${cov.majorCoursesA}/${cov.majorCoursesB} · embedded ${cov.embeddedA}/${cov.embeddedB}` +
      ` · described ${cov.describedA}/${cov.describedB} · PLOs ${cov.plosA}/${cov.plosB}` +
      ` · actions: ${s.actions.length ? s.actions.join(', ') : 'none'}`,
  );
  for (const c of s.evidence.sharedCourses.slice(0, 3)) console.log(`      shared  ${c.code} ${clip(c.nameTh, 50)} (${c.credits} cr)`);
  if (s.evidence.sharedCourses.length > 3) console.log(`      shared  … ${s.evidence.sharedCourses.length - 3} more`);
  for (const e of s.evidence.equivalentCourses.slice(0, 3)) {
    console.log(`      equiv   ${e.codeA} ${clip(e.nameA, 35)} ≈ ${e.codeB} ${clip(e.nameB, 35)} (${e.similarity.toFixed(3)}, ${e.basis})`);
  }
  if (s.evidence.equivalentCourses.length > 3) console.log(`      equiv   … ${s.evidence.equivalentCourses.length - 3} more`);
  for (const m of s.evidence.matchedPlos.slice(0, 2)) {
    console.log(`      PLO     "${clip(m.textA, 45)}" ≈ "${clip(m.textB, 45)}" (${m.similarity.toFixed(3)})`);
  }
  if (s.evidence.matchedPlos.length > 2) console.log(`      PLO     … ${s.evidence.matchedPlos.length - 2} more matched`);
}

async function calibrateLevel(level: ProgramLevel, faculty: ReadonlyMap<string, string>): Promise<void> {
  console.log(`\n══════ ${level} ══════`);
  const { programmes, coverage } = await loadOverlapProgrammes(level);
  printCoverage(coverage);
  if (programmes.length < 2) {
    console.log('   fewer than two programmes — nothing to compare');
    return;
  }
  const plan = planRunPairs(programmes, { scopeProgramIds: [], keepAll: true });
  const all = plan.all!;
  const bands = new Map<string, number>();
  for (const s of all) bands.set(s.band, (bands.get(s.band) ?? 0) + 1);
  console.log(`   pairs scored ${plan.scored} · would store ${plan.stored.length} · bands ` +
    ['HIGH', 'MODERATE', 'LOW', 'NONE'].map((b) => `${b} ${bands.get(b) ?? 0}`).join(' / '));
  console.log(`   language-variant pairs ${all.filter((s) => s.languageVariant).length}`);

  console.log('\n   Distributions over every scored pair');
  printDistributions(summariseHistogram(plan.histogram));

  const byId = new Map(programmes.map((p) => [p.id, p]));
  const serviceCodes = serviceCourseCodes(programmes, OVERLAP_THRESHOLDS.serviceCourseShare);
  const embedded = new Map(programmes.map((p) => [p.id, majorCourses(p, serviceCodes).filter((c) => c.vector !== null)]));
  const bm = bestMatchSample(all, byId, embedded);
  console.log(
    `\n   Best-match cosines per item, seeded sample of ${bm.pairsSampled} of ${bm.pairsEligible} eligible pairs` +
      ` (seed ${CALIBRATION_SEED}); thresholds: course ${OVERLAP_THRESHOLDS.courseEquiv} (described)` +
      ` / ${OVERLAP_THRESHOLDS.courseEquivName} (name), PLO ${OVERLAP_THRESHOLDS.ploMatch}`,
  );
  console.log(distHeader());
  console.log(distRow('course, both described', summarise(bm.courseDescription), 3));
  console.log(distRow('course, name basis', summarise(bm.courseName), 3));
  console.log(distRow('PLO', summarise(bm.plo), 3));

  const withIndex = all.filter((s) => s.overlapIndex !== null);
  const byPairId = (x: PairScore, y: PairScore): number =>
    x.programAId < y.programAId ? -1 : x.programAId > y.programAId ? 1 : x.programBId < y.programBId ? -1 : x.programBId > y.programBId ? 1 : 0;

  console.log('\n   ── Hand-check 1: the 20 highest-index pairs');
  [...withIndex]
    .sort((x, y) => y.overlapIndex! - x.overlapIndex! || byPairId(x, y))
    .slice(0, 20)
    .forEach((s) => printPair(s, byId, faculty));

  console.log(`\n   ── Hand-check 2: the 20 pairs nearest the moderate boundary (${OVERLAP_THRESHOLDS.bandModerate})`);
  [...withIndex]
    .sort((x, y) =>
      Math.abs(x.overlapIndex! - OVERLAP_THRESHOLDS.bandModerate) - Math.abs(y.overlapIndex! - OVERLAP_THRESHOLDS.bandModerate) ||
      byPairId(x, y))
    .slice(0, 20)
    .forEach((s) => printPair(s, byId, faculty));

  const variants = all.filter((s) => s.languageVariant).sort((x, y) => (y.overlapIndex ?? -1) - (x.overlapIndex ?? -1) || byPairId(x, y));
  console.log(`\n   ── Hand-check 3: language-variant pairs (${Math.min(10, variants.length)} of ${variants.length})`);
  if (!variants.length) console.log('   none');
  variants.slice(0, 10).forEach((s) => printPair(s, byId, faculty));
}

// ── Main ────────────────────────────────────────────────────────────────────

function parseLevel(): ProgramLevel | undefined {
  const arg = process.argv.find((a) => a.startsWith('--level='));
  if (!arg) return undefined;
  const raw = arg.slice('--level='.length).toUpperCase();
  const level = LEVELS.find((l) => l === raw);
  if (!level) throw new Error(`unknown --level=${raw}; expected one of ${LEVELS.join(', ')}`);
  return level;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const noAi = process.argv.includes('--no-ai');
  const calibrate = process.argv.includes('--calibrate');
  const level = parseLevel();
  const levels = level ? [level] : [...LEVELS];

  if (calibrate) {
    if (apply) throw new Error('--calibrate is read-only; drop --apply');
    console.log(`=== programs:overlap --calibrate (${PROGRAM_OVERLAP_VERSION}, READ-ONLY) ===`);
    console.log(`thresholds: ${JSON.stringify(OVERLAP_THRESHOLDS)}`);
    const faculties = await prisma.faculty.findMany({ select: { id: true, nameEn: true } });
    const faculty = new Map(faculties.map((f) => [f.id, f.nameEn]));
    for (const l of levels) await calibrateLevel(l, faculty);
    await prisma.$disconnect();
    return;
  }

  console.log(`=== programs:overlap (${PROGRAM_OVERLAP_VERSION}, ${apply ? 'APPLY' : 'DRY RUN'}) ===`);
  const results = await runProgramOverlap({ level, apply });
  for (const r of results) {
    console.log(`\n${r.level}${r.runId ? ` — run ${r.runId}` : ''}`);
    printCoverage(r.coverage);
    console.log(`   pairs scored ${r.scored} · ${apply ? 'stored' : 'would store'} ${r.stored}`);
    printDistributions(r.distributions);
  }

  if (apply && !noAi) {
    const ai = createIngestionAiService();
    const runIds = results.map((r) => r.runId).filter((x): x is string => x !== null);
    const rec = await runOverlapRecommendations({ ai, runIds });
    console.log(
      `\nrecommendations: ${rec.written} written, ${rec.skipped} skipped, ${rec.failed} failed, $${rec.costUsd.toFixed(4)}`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
