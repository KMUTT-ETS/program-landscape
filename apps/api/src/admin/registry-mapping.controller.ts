import { Body, Controller, Get, Post, BadRequestException } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '@kku/db';
import { AuditLog, Authorized, ZodValidationPipe } from '../common';

// ─────────────────────────────────────────────────────────────────────────────
// Registry-mapping triage: surfaces the ~53 KKU programs that the auto-seed
// script (`pnpm registry:seed-mappings`) couldn't match against the captured
// kku-registry fixture, and lets the analyst manually pair them with a
// registry tuple. Each confirmed pairing writes one RegistryProgramMapping
// row.
// ─────────────────────────────────────────────────────────────────────────────

interface FixtureTuple {
  faculty: string;
  program: string;
  level: string | null;
  major: string | null;
}

interface FixtureRow {
  FACULTY_NAME: string;
  PROGRAM_NAME: string;
  PROGRAM_LEVEL: string | null;
  MAJOR: string | null;
}

// The fixture's `programTuples` array is the distinct (faculty, programme,
// level, major) vocabulary — programme catalogue metadata, already de-duped
// at capture time, carrying no counts and no student attributes. Triage reads
// only this. It used to de-dup `statusCounts` itself, which meant loading
// 136k per-cohort demographic rows to arrive at the same 2,232 tuples; those
// rows described single students and are no longer captured at all.

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  '../../apps/ingestion/test/fixtures/kku-registry/aggregated.json',
);
const FIXTURE_PATH_ALT = path.resolve(
  process.cwd(),
  'apps/ingestion/test/fixtures/kku-registry/aggregated.json',
);

let fixtureCache: FixtureTuple[] | null = null;

function loadFixture(): FixtureTuple[] {
  if (fixtureCache) return fixtureCache;
  const fixturePath = existsSync(FIXTURE_PATH)
    ? FIXTURE_PATH
    : existsSync(FIXTURE_PATH_ALT)
      ? FIXTURE_PATH_ALT
      : null;
  if (!fixturePath) {
    fixtureCache = [];
    return fixtureCache;
  }
  const content = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    programTuples?: FixtureRow[];
  };
  const seen = new Map<string, FixtureTuple>();
  for (const r of content.programTuples ?? []) {
    const fac = (r.FACULTY_NAME ?? '').trim();
    const prog = (r.PROGRAM_NAME ?? '').trim();
    const major = (r.MAJOR ?? '').trim();
    const level = (r.PROGRAM_LEVEL ?? '').trim() || null;
    const key = `${fac}||${prog}||${level ?? ''}||${major}`;
    if (!seen.has(key)) seen.set(key, { faculty: fac, program: prog, level, major: major || null });
  }
  fixtureCache = [...seen.values()];
  return fixtureCache;
}

// Token-based Jaccard similarity over Thai/English text. Splits on whitespace +
// the small set of punctuation common in program names. Cheap; good enough
// for a one-off triage UI.
function jaccard(a: string, b: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[(),\-/]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2),
    );
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

const LEVEL_TH: Record<string, string> = {
  BACHELOR: 'ปริญญาตรี',
  MASTER: 'ปริญญาโท',
  DOCTORAL: 'ปริญญาเอก',
  HIGHER_GRAD_DIPLOMA: 'ประกาศนียบัตรบัณฑิตชั้นสูง',
};

const CreateMappingSchema = z.object({
  programId: z.string().min(1),
  facultyName: z.string().min(1),
  programName: z.string().min(1),
  level: z.string().min(1),
  major: z.string().nullable().optional(),
});
type CreateMappingDto = z.infer<typeof CreateMappingSchema>;

@Controller('/admin/registry-mapping')
export class RegistryMappingController {
  @Get('unmatched')
  @Authorized('data_sources:configure')
  async unmatched() {
    const fixture = loadFixture();
    // Programs without ANY RegistryProgramMapping row.
    const programs = await prisma.program.findMany({
      where: { registryMappings: { none: {} } },
      select: {
        id: true,
        code: true,
        nameTh: true,
        nameEn: true,
        level: true,
        majors: true,
        sequenceNoFromSheet: true,
        faculty: { select: { id: true, nameTh: true, nameEn: true } },
      },
      orderBy: [{ faculty: { nameTh: 'asc' } }, { code: 'asc' }],
    });

    // Pre-load every existing RegistryProgramMapping so we can mark candidates
    // that would STEAL a mapping from another program. Otherwise the UI
    // silently moves mappings around: confirming a tuple that's already
    // mapped to another program will UPSERT-update the existing row,
    // unmapping the previous owner — that program then re-appears in the
    // unmatched list on refresh, which looks like the save failed.
    const existingMappings = await prisma.registryProgramMapping.findMany({
      select: {
        registryFacultyName: true,
        registryProgramName: true,
        registryLevel: true,
        registryMajor: true,
        program: { select: { id: true, code: true, nameTh: true } },
      },
    });
    const mappingByTupleKey = new Map<string, { programId: string; programCode: string; programNameTh: string }>();
    for (const m of existingMappings) {
      const key = `${m.registryFacultyName}||${m.registryProgramName}||${m.registryLevel}||${m.registryMajor}`;
      mappingByTupleKey.set(key, {
        programId: m.program.id,
        programCode: m.program.code,
        programNameTh: m.program.nameTh,
      });
    }

    const enriched = programs.map((p) => {
      const levelTh = LEVEL_TH[p.level] ?? p.level;
      const sameFaculty = fixture.filter((t) => t.faculty === p.faculty.nameTh);
      const pool = sameFaculty.length > 0 ? sameFaculty : fixture;
      const scored = pool
        .map((t) => {
          const programSim = jaccard(p.nameTh, t.program);
          const majorSim = p.majors.length > 0
            ? Math.max(...p.majors.map((m) => jaccard(m, t.major ?? '')))
            : jaccard(p.nameTh, t.major ?? '');
          const score = 0.7 * programSim + 0.3 * majorSim;
          return { tuple: t, score };
        })
        .filter((s) => s.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      return {
        programId: p.id,
        code: p.code,
        nameTh: p.nameTh,
        nameEn: p.nameEn,
        level: p.level,
        levelTh,
        majors: p.majors,
        sequenceNoFromSheet: p.sequenceNoFromSheet,
        faculty: { id: p.faculty.id, nameTh: p.faculty.nameTh, nameEn: p.faculty.nameEn },
        candidates: scored.map((s) => {
          // Match the tuple as it would be inserted (same level + major
          // normalisation as the controller's create()).
          const apiLevel = s.tuple.level ?? levelTh;
          const apiMajor = s.tuple.major ?? '';
          const tupleKey = `${s.tuple.faculty}||${s.tuple.program}||${apiLevel}||${apiMajor}`;
          const owner = mappingByTupleKey.get(tupleKey) ?? null;
          return {
            facultyName: s.tuple.faculty,
            programName: s.tuple.program,
            level: s.tuple.level,
            major: s.tuple.major,
            score: Math.round(s.score * 100) / 100,
            facultyMatchesProgramFaculty: s.tuple.faculty === p.faculty.nameTh,
            // null = available; non-null = confirming will steal from this
            // program. UI surfaces a warning before the click.
            currentlyMappedTo: owner,
          };
        }),
      };
    });

    return {
      totalUnmatched: programs.length,
      fixtureSize: fixture.length,
      fixtureLoaded: fixture.length > 0,
      programs: enriched,
    };
  }

  @Post()
  @Authorized('data_sources:configure')
  @AuditLog({ entityType: 'registry_program_mapping', action: 'create' })
  async create(@Body(new ZodValidationPipe(CreateMappingSchema)) body: CreateMappingDto) {
    const program = await prisma.program.findUnique({ where: { id: body.programId } });
    if (!program) throw new BadRequestException(`program not found: ${body.programId}`);
    // RegistryProgramMapping unique = (registryFacultyName, registryProgramName,
    // registryLevel, registryMajor). Empty-string major is the no-major default.
    const major = body.major ?? '';
    const created = await prisma.registryProgramMapping.upsert({
      where: {
        registryFacultyName_registryProgramName_registryLevel_registryMajor: {
          registryFacultyName: body.facultyName,
          registryProgramName: body.programName,
          registryLevel: body.level,
          registryMajor: major,
        },
      },
      update: { programId: body.programId, confirmedAt: new Date() },
      create: {
        programId: body.programId,
        registryFacultyName: body.facultyName,
        registryProgramName: body.programName,
        registryLevel: body.level,
        registryMajor: major,
        confirmedAt: new Date(),
      },
    });
    return { id: created.id, programId: created.programId };
  }
}
