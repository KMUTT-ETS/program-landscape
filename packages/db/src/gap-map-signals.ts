import { Prisma } from '@prisma/client';
import { prisma } from './index';
import { OCCUPATION_SKILL_DEMAND_FLOOR } from './jobthai-bridge';
import { jobThaiGenericSkills } from './jobthai';

// ─────────────────────────────────────────────────────────────────────────────
// "What's coming" for a gap-map row (spec §6): the LinkedIn-via-MHESI growth
// signal reached through the field's occupations' skills (no career→field
// mapping invented), and Trends Radar signals reached through the field's
// programmes or through an initiative that names one of its occupations.
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldGlobalSignal {
  skills: Array<{ skillId: string; nameEn: string; nameTh: string; growthPct: number }>;
  /** Which growth series the picks came from; null when nothing intersected. */
  scope: 'THAILAND' | 'GLOBAL' | null;
}

export interface FieldTrendSignal {
  id: string;
  title: string;
  signalType: string;
  impactScore: number;
  detectedDate: string;
  matchedBy: 'programme' | 'initiative';
}

export interface GrowthRow {
  skillId: string;
  dataScope: 'THAILAND' | 'GLOBAL';
  growthPct: number;
}

export const GLOBAL_SIGNAL_TOP_N = 3;

/** Pure: THAILAND per skill, GLOBAL fallback, generic skills out, top N rising. */
export function pickGrowth(
  rows: GrowthRow[],
  fieldSkillIds: Set<string>,
  genericSkillIds: Set<string>,
): { picked: Array<{ skillId: string; growthPct: number }>; scope: 'THAILAND' | 'GLOBAL' | null } {
  const best = new Map<string, { growthPct: number; scope: 'THAILAND' | 'GLOBAL' }>();
  for (const r of rows) {
    if (!fieldSkillIds.has(r.skillId) || genericSkillIds.has(r.skillId)) continue;
    const cur = best.get(r.skillId);
    if (!cur || (cur.scope === 'GLOBAL' && r.dataScope === 'THAILAND') || (cur.scope === r.dataScope && r.growthPct > cur.growthPct)) {
      best.set(r.skillId, { growthPct: r.growthPct, scope: r.dataScope });
    }
  }
  const picked = [...best.entries()]
    .filter(([, v]) => v.growthPct > 0)
    .sort((a, b) => b[1].growthPct - a[1].growthPct)
    .slice(0, GLOBAL_SIGNAL_TOP_N)
    .map(([skillId, v]) => ({ skillId, growthPct: v.growthPct }));
  if (picked.length === 0) return { picked: [], scope: null };
  const scope = picked.some((p) => best.get(p.skillId)!.scope === 'THAILAND') ? 'THAILAND' : 'GLOBAL';
  return { picked, scope };
}

export async function globalSignalForFields(
  fieldIds: string[],
  occupationIdsByField: Map<string, string[]>,
): Promise<Map<string, FieldGlobalSignal>> {
  const result = new Map<string, FieldGlobalSignal>();
  const allOcc = [...new Set([...occupationIdsByField.values()].flat())];
  if (fieldIds.length === 0 || allOcc.length === 0) return result;
  const [occSkills, growth, generic] = await Promise.all([
    prisma.jobThaiOccupationSkill.findMany({
      where: { jobThaiOccupationId: { in: allOcc }, share: { gte: OCCUPATION_SKILL_DEMAND_FLOOR } },
      select: { jobThaiOccupationId: true, skillId: true },
    }),
    prisma.kmitlSkillGrowth.findMany({
      where: { skillId: { not: null } },
      select: { skillId: true, dataScope: true, growthPct: true },
    }),
    jobThaiGenericSkills(),
  ]);
  const skillsByOcc = new Map<string, string[]>();
  for (const r of occSkills) skillsByOcc.set(r.jobThaiOccupationId, [...(skillsByOcc.get(r.jobThaiOccupationId) ?? []), r.skillId]);
  const growthRows: GrowthRow[] = growth.map((g) => ({ skillId: g.skillId!, dataScope: g.dataScope, growthPct: g.growthPct }));
  const pickedIds = new Set<string>();
  const perField = new Map<string, ReturnType<typeof pickGrowth>>();
  for (const fieldId of fieldIds) {
    const fieldSkills = new Set((occupationIdsByField.get(fieldId) ?? []).flatMap((o) => skillsByOcc.get(o) ?? []));
    const r = pickGrowth(growthRows, fieldSkills, generic.generic);
    perField.set(fieldId, r);
    for (const p of r.picked) pickedIds.add(p.skillId);
  }
  const names = await prisma.skill.findMany({ where: { id: { in: [...pickedIds] } }, select: { id: true, nameEn: true, nameTh: true } });
  const nameById = new Map(names.map((n) => [n.id, n]));
  for (const [fieldId, r] of perField) {
    result.set(fieldId, {
      scope: r.scope,
      skills: r.picked.map((p) => ({ skillId: p.skillId, nameEn: nameById.get(p.skillId)?.nameEn ?? p.skillId, nameTh: nameById.get(p.skillId)?.nameTh ?? '', growthPct: p.growthPct })),
    });
  }
  return result;
}

const TOKEN_SPLIT = /[\s/,()·&-]+/;
const norm = (s: string) => s.trim().toLowerCase();
/** Words of at least four characters — the same floor MIN_FIELD_LENGTH uses,
 *  because Thai has no inter-word spaces and short tokens match everywhere. */
const tokens = (s: string) => norm(s).split(TOKEN_SPLIT).filter((t) => t.length >= 4);

/**
 * Pure: does any initiative's unmet role name one of the occupations?
 *
 * Only the ROLE side is split into words ("logistics coordinator" →
 * ["logistics", "coordinator"]) and tested against each occupation's WHOLE
 * normalised label — the occupation side is deliberately never tokenised.
 * A live measurement on 2026-09-16 showed why: JobThai occupation labels are
 * often a "/"-joined composite of several sub-buckets (e.g.
 * "หัวหน้า/ผู้จัดการ/ผู้บริหาร" — head/manager/executive), and splitting
 * that into standalone words let one signal ("Corporate AI Risk and
 * Governance Manager", unmetRoleTh starting "ผู้บริหารจัดการ...") match via
 * the single word "ผู้บริหาร" — a generic 6-grapheme (9-UTF-16-unit) term
 * for "executive" carried by roughly 70% of fields' occupation lists, not a
 * short-token artefact (raising the length floor would not have removed it:
 * the word is already well above any floor in this file). Requiring the
 * WHOLE occupation label to appear in the role text, instead of any one of
 * its slash-separated pieces, keeps the genuine narrow matches (a specific
 * role word found inside a broader occupation label, e.g. "logistics" inside
 * "Logistics / Supply Chain") while dropping the generic-bucket false
 * positive.
 */
export function matchInitiativeToOccupations(
  initiatives: Array<{ unmetRoleTh?: string | null; unmetRoleEn?: string | null }> | null | undefined,
  occupationNames: string[],
): boolean {
  if (!initiatives || initiatives.length === 0) return false;
  const occFulls = occupationNames.map(norm);
  for (const i of initiatives) {
    for (const role of [i.unmetRoleTh, i.unmetRoleEn]) {
      if (!role) continue;
      const full = norm(role);
      const words = tokens(role);
      for (const occFull of occFulls) {
        if (words.some((w) => occFull.includes(w))) return true;
        if (full.includes(occFull)) return true;
      }
    }
  }
  return false;
}

export const TREND_SIGNALS_PER_FIELD = 5;

export async function trendSignalsForFields(
  fields: Array<{ fieldId: string; programIds: string[]; occupationNames: string[] }>,
): Promise<Map<string, FieldTrendSignal[]>> {
  const result = new Map<string, FieldTrendSignal[]>();
  if (fields.length === 0) return result;
  const allPrograms = [...new Set(fields.flatMap((f) => f.programIds))];
  const signals = await prisma.trendSignal.findMany({
    where: {
      OR: [
        ...(allPrograms.length ? [{ affectedProgramIds: { hasSome: allPrograms } }] : []),
        { newInitiativesJson: { not: Prisma.DbNull } },
      ],
    },
    select: { id: true, title: true, signalType: true, impactScore: true, detectedDate: true, affectedProgramIds: true, newInitiativesJson: true },
    orderBy: [{ impactScore: 'desc' }, { detectedDate: 'desc' }],
  });
  for (const f of fields) {
    const mine = new Set(f.programIds);
    const list: FieldTrendSignal[] = [];
    for (const s of signals) {
      const byProgramme = s.affectedProgramIds.some((id) => mine.has(id));
      const byInitiative = !byProgramme && matchInitiativeToOccupations(
        Array.isArray(s.newInitiativesJson) ? (s.newInitiativesJson as Array<{ unmetRoleTh?: string | null; unmetRoleEn?: string | null }>) : null,
        f.occupationNames,
      );
      if (!byProgramme && !byInitiative) continue;
      list.push({ id: s.id, title: s.title, signalType: s.signalType, impactScore: s.impactScore, detectedDate: s.detectedDate.toISOString().slice(0, 10), matchedBy: byProgramme ? 'programme' : 'initiative' });
      if (list.length >= TREND_SIGNALS_PER_FIELD) break;
    }
    result.set(f.fieldId, list);
  }
  return result;
}
