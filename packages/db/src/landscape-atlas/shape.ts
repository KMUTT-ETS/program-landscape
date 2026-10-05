// packages/db/src/landscape-atlas/shape.ts
import { healthTone } from './scales';
import {
  LANDSCAPE_ATLAS_VERSION,
  NO_ANSWER,
  SMALL_PROGRAMME_STUDENTS,
  type ChapterAnswer,
  type Tone,
  type Unplotted,
} from './types';

export interface ShapeProgrammeInput {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  facultyId: string;
  facultyCode: string;
  facultyNameTh: string;
  facultyNameEn: string;
  /** Currently active students (student_cohort_distributions); null = no data. */
  activeStudents: number | null;
  /** Overall health score; null = not scored. */
  health: number | null;
}

export interface TreemapProgramme {
  id: string;
  label: string;
  sublabel: string;
  value: number;
  health: number | null;
  tone: Tone;
  href: string;
}

export interface TreemapFaculty {
  id: string;
  label: string;
  sublabel: string;
  value: number;
  children: TreemapProgramme[];
}

export interface ShapeChapter {
  version: typeof LANDSCAPE_ATLAS_VERSION;
  computedAt: string;
  faculties: TreemapFaculty[];
  totalStudents: number;
  smallProgrammes: number;
  unplotted: Unplotted[];
  answer: ChapterAnswer;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildShape(rows: readonly ShapeProgrammeInput[], computedAt: string): ShapeChapter {
  const unplotted: Unplotted[] = [];
  const byFaculty = new Map<string, TreemapFaculty>();
  for (const r of rows) {
    if (r.activeStudents === null) {
      unplotted.push({ id: r.programId, label: r.nameTh, reason: 'No active-student data' });
      continue;
    }
    if (r.activeStudents <= 0) {
      unplotted.push({ id: r.programId, label: r.nameTh, reason: 'No active students' });
      continue;
    }
    let f = byFaculty.get(r.facultyId);
    if (!f) {
      f = { id: r.facultyId, label: r.facultyNameTh, sublabel: r.facultyNameEn, value: 0, children: [] };
      byFaculty.set(r.facultyId, f);
    }
    f.value += r.activeStudents;
    f.children.push({
      id: r.programId,
      label: r.nameTh,
      sublabel: r.code,
      value: r.activeStudents,
      health: r.health,
      tone: healthTone(r.health),
      href: `/programs/${r.programId}`,
    });
  }
  const faculties = [...byFaculty.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  for (const f of faculties) f.children.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const totalStudents = faculties.reduce((s, f) => s + f.value, 0);
  const smallProgrammes = faculties.reduce(
    (s, f) => s + f.children.filter((c) => c.value < SMALL_PROGRAMME_STUDENTS).length,
    0,
  );
  return {
    version: LANDSCAPE_ATLAS_VERSION,
    computedAt,
    faculties,
    totalStudents,
    smallProgrammes,
    unplotted,
    answer: shapeAnswer(faculties, totalStudents, smallProgrammes),
  };
}

function shapeAnswer(faculties: TreemapFaculty[], total: number, small: number): ChapterAnswer {
  if (total <= 0) return NO_ANSWER;
  const smallText = `${small} ${plural(small, 'programme has', 'programmes have')} fewer than ${SMALL_PROGRAMME_STUDENTS} active students.`;
  if (faculties.length <= 5) {
    const n = faculties.length;
    return {
      figure: total.toLocaleString('en-US'),
      sentence: `active students, all in the ${n} ${plural(n, 'faculty', 'faculties')} shown; ${smallText}`,
    };
  }
  const top = faculties.slice(0, 5).reduce((s, f) => s + f.value, 0);
  const share = Math.round((top / total) * 100);
  return {
    figure: `${share}%`,
    sentence: `of active students are in the 5 largest of ${faculties.length} faculties; ${smallText}`,
  };
}
