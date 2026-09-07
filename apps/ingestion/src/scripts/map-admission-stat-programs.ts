#!/usr/bin/env tsx
// ────────────────────────────────────────────────────────────────────────────
// Map ADMISSION_STAT recruitment PROGRAMIDs → canonical KKU programs.
//
// PROGRAMID (12-digit recruitment code) is NOT the MHESI curr code, so this
// is a name-based mapping. Two passes:
//   1. Deterministic — match the campaign name's degree-level + first
//      parenthetical major against candidate programs in the same faculty.
//      Persisted at confidence 1.0 (method 'deterministic').
//   2. LLM (Gemini) — the residual, batched per faculty, with that
//      faculty's canonical programs as the only candidate set. Persisted at
//      the LLM's confidence (method 'llm-assisted').
//
// Writes AdmissionStatProgramMapping (upsert on recruitment_program_id).
// Idempotent. Dry-run by default; pass --apply to persist. --llm to run
// the LLM pass (otherwise deterministic only).
//
// Usage:
//   pnpm tsx apps/ingestion/src/scripts/map-admission-stat-programs.ts            # dry-run, deterministic only
//   pnpm tsx apps/ingestion/src/scripts/map-admission-stat-programs.ts --apply    # persist deterministic
//   pnpm tsx apps/ingestion/src/scripts/map-admission-stat-programs.ts --apply --llm  # + LLM residual
// ────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
loadDotEnv(path.resolve(process.cwd(), '.env'));
function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 0) continue;
    const k = t.slice(0, i).trim(); let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

import { z } from 'zod';
import { prisma } from '@kku/db';
import { type AiMessage } from '@kku/shared';
import { createIngestionAiService } from '../lib/ai-service';

const MAP_METHOD_VERSION = 'admission-stat-program-map.v1';

type Level = 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';

const norm = (s: string): string => s.replace(/\s+/g, '').trim();
const firstParen = (s: string): string | null => {
  const m = s.match(/\(([^)]*)\)/);
  return m && m[1] ? m[1] : null;
};
function inferLevel(campaignName: string): Level | null {
  const head = norm(campaignName.split('(')[0] ?? '');
  if (head.endsWith('ด.') || head.includes('ดุษฎีบัณฑิต')) return 'DOCTORAL';
  if (head.endsWith('ม.') || head.includes('มหาบัณฑิต')) return 'MASTER';
  if (head.endsWith('บ.') || head.includes('บัณฑิต')) return 'BACHELOR';
  return null;
}

interface RecruitProgram {
  recruitmentProgramId: string;
  facultyId: string | null;
  facultyNameTh: string;
  repName: string; // representative campaign name
  level: Level | null;
  paren: string | null;
}

interface CandidateProgram {
  id: string;
  nameTh: string;
  nameEn: string;
  level: Level;
  paren: string | null;
}

const LlmSchema = z.object({
  mappings: z.array(
    z.object({
      recruitmentProgramId: z.string(),
      programId: z.string().nullable(),
      confidence: z.coerce.number().min(0).max(1).default(0.7),
      reasoning: z.string().optional(),
    }),
  ),
});

async function main() {
  const apply = process.argv.includes('--apply');
  const useLlm = process.argv.includes('--llm');

  // 1. Distinct recruitment programs + a representative campaign name
  //    (prefer one carrying a parenthetical; shortest wins for cleanliness).
  const rows = await prisma.admissionCampaignStat.findMany({
    select: {
      recruitmentProgramId: true,
      facultyId: true,
      facultyNameTh: true,
      campaignName: true,
    },
  });
  const byPid = new Map<string, RecruitProgram>();
  for (const r of rows) {
    const ex = byPid.get(r.recruitmentProgramId);
    const hasParen = r.campaignName.includes('(');
    if (!ex) {
      byPid.set(r.recruitmentProgramId, {
        recruitmentProgramId: r.recruitmentProgramId,
        facultyId: r.facultyId,
        facultyNameTh: r.facultyNameTh,
        repName: r.campaignName,
        level: inferLevel(r.campaignName),
        paren: firstParen(r.campaignName),
      });
    } else {
      // Prefer a name with a parenthetical, then the shorter.
      const exHasParen = ex.repName.includes('(');
      if ((hasParen && !exHasParen) || (hasParen === exHasParen && r.campaignName.length < ex.repName.length)) {
        ex.repName = r.campaignName;
        ex.level = inferLevel(r.campaignName);
        ex.paren = firstParen(r.campaignName);
      }
    }
  }
  const recruits = [...byPid.values()];

  // 2. Candidate canonical programs, grouped by facultyId.
  const programs = await prisma.program.findMany({
    where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    select: { id: true, nameTh: true, nameEn: true, level: true, facultyId: true },
  });
  const candByFaculty = new Map<string, CandidateProgram[]>();
  for (const p of programs) {
    const arr = candByFaculty.get(p.facultyId) ?? [];
    arr.push({ id: p.id, nameTh: p.nameTh, nameEn: p.nameEn, level: p.level as Level, paren: firstParen(p.nameTh) });
    candByFaculty.set(p.facultyId, arr);
  }

  // Already-mapped (skip unless re-running; idempotent upsert handles it).
  const existing = new Set(
    (await prisma.admissionStatProgramMapping.findMany({ select: { recruitmentProgramId: true } })).map(
      (m) => m.recruitmentProgramId,
    ),
  );

  // 3. Deterministic pass.
  interface Resolved { rp: RecruitProgram; programId: string; confidence: number; method: string; reasoning: string }
  const resolved: Resolved[] = [];
  const residual: RecruitProgram[] = [];
  for (const rp of recruits) {
    if (!rp.facultyId || !rp.paren) { residual.push(rp); continue; }
    const cands = candByFaculty.get(rp.facultyId) ?? [];
    const target = norm(rp.paren);
    let matches = cands.filter((c) => c.paren && norm(c.paren) === target);
    if (rp.level) {
      const lvlMatches = matches.filter((c) => c.level === rp.level);
      if (lvlMatches.length > 0) matches = lvlMatches;
    }
    if (matches.length === 1) {
      resolved.push({ rp, programId: matches[0]!.id, confidence: 1, method: 'deterministic', reasoning: `exact parenthetical + level match (${rp.paren})` });
    } else {
      residual.push(rp);
    }
  }

  console.log(`Recruitment programs: ${recruits.length}`);
  console.log(`Deterministic matched: ${resolved.length}`);
  console.log(`Residual (need LLM):   ${residual.length}`);

  // 4. LLM pass (residual, per faculty).
  let llmResolved = 0;
  let llmCostUsd = 0;
  if (useLlm && residual.length > 0) {
    const ai = createIngestionAiService();

    // Group residual by faculty; only faculties with candidates are worth a call.
    const resByFaculty = new Map<string, RecruitProgram[]>();
    for (const rp of residual) {
      if (!rp.facultyId) continue;
      const arr = resByFaculty.get(rp.facultyId) ?? [];
      arr.push(rp);
      resByFaculty.set(rp.facultyId, arr);
    }

    for (const [facultyId, group] of resByFaculty) {
      const cands = candByFaculty.get(facultyId) ?? [];
      if (cands.length === 0) continue;
      const facName = group[0]!.facultyNameTh;
      const system = `คุณคือผู้ช่วยจับคู่ "หลักสูตรการรับสมัคร (recruitment program)" ของ มข. กับ "หลักสูตรมาตรฐาน (canonical program)" ในระบบ โดยใช้ชื่อปริญญา ชื่อวิชาเอก/สาขา และระดับ (ตรี/โท/เอก)

ส่งออก JSON เท่านั้น (ไม่มี markdown):
{"mappings":[{"recruitmentProgramId":"<id>","programId":"<canonical id หรือ null>","confidence":0.0-1.0,"reasoning":"<สั้นๆ>"}]}

กฎ:
1. ครบทุก recruitmentProgramId ใน input
2. programId ต้องเป็น id จากรายการ canonical ที่ให้เท่านั้น — ห้ามแต่ง
3. ถ้าไม่มี canonical ที่ตรง ให้ programId = null
4. จับคู่ตามความหมายของสาขา (เช่น "วิศวกรรมระบบอัตโนมัติ หุ่นยนต์ และปัญญาประดิษฐ์" ตรงกับ "วิศวกรรมระบบอัตโนมัติ หุ่นยนต์ และระบบอัจฉริยะ" แม้คำไม่เหมือนทั้งหมด) และระดับต้องตรง (ตรี/โท/เอก)`;
      const recruitBlock = group
        .map((g) => `- ${g.recruitmentProgramId} | ระดับ:${g.level ?? '?'} | ${g.repName}`)
        .join('\n');
      const candBlock = cands
        .map((c) => `- ${c.id} | ${c.level} | ${c.nameTh}`)
        .join('\n');
      const user = `คณะ: ${facName}\n\n[recruitment programs to map (${group.length})]\n${recruitBlock}\n\n[canonical programs in this faculty (${cands.length})]\n${candBlock}`;
      const messages: AiMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ];

      try {
        const res = await ai.extractStructured(
          {
            ctx: { module: 'curriculum', kind: 'admission-stat-program-map', traceId: `admstat-map-${facultyId}` },
            messages,
            methodVersion: MAP_METHOD_VERSION,
            maxOutputTokens: 20000,
          },
          LlmSchema,
        );
        llmCostUsd += res.cost.usd;
        const validIds = new Set(cands.map((c) => c.id));
        for (const m of res.parsed.mappings) {
          if (!m.programId || !validIds.has(m.programId)) continue;
          const rp = group.find((g) => g.recruitmentProgramId === m.recruitmentProgramId);
          if (!rp) continue;
          resolved.push({ rp, programId: m.programId, confidence: m.confidence, method: 'llm-assisted', reasoning: m.reasoning ?? '' });
          llmResolved += 1;
        }
        console.log(`  [LLM] ${facName}: mapped ${res.parsed.mappings.filter((m) => m.programId && validIds.has(m.programId)).length}/${group.length}`);
      } catch (e) {
        console.error(`  [LLM] ${facName} FAILED:`, e instanceof Error ? e.message : String(e));
      }
    }
    console.log(`LLM matched: ${llmResolved} (cost ~$${llmCostUsd.toFixed(2)})`);
  }

  // 5. Persist.
  const total = resolved.length;
  const unmapped = recruits.length - total;
  console.log(`\nTOTAL mapped: ${total}/${recruits.length} (${((total / recruits.length) * 100).toFixed(0)}%) — unmapped: ${unmapped}`);
  console.log(`  already in bridge: ${existing.size}`);

  if (!apply) {
    console.log('\n(dry-run — pass --apply to persist)');
    return;
  }

  let written = 0;
  const progNameById = new Map(programs.map((p) => [p.id, p.nameTh]));
  for (const r of resolved) {
    await prisma.admissionStatProgramMapping.upsert({
      where: { recruitmentProgramId: r.rp.recruitmentProgramId },
      create: {
        recruitmentProgramId: r.rp.recruitmentProgramId,
        sampleCampaignName: r.rp.repName,
        facultyNameTh: r.rp.facultyNameTh,
        programId: r.programId,
        confidence: r.confidence,
        method: r.method,
        notes: r.reasoning,
      },
      update: {
        sampleCampaignName: r.rp.repName,
        facultyNameTh: r.rp.facultyNameTh,
        programId: r.programId,
        confidence: r.confidence,
        method: r.method,
        notes: r.reasoning,
      },
    });
    written += 1;
  }
  console.log(`\nPersisted ${written} mappings. Sample:`);
  for (const r of resolved.slice(0, 8)) {
    console.log(`  ${r.rp.recruitmentProgramId} → ${progNameById.get(r.programId)?.slice(0, 36)} [${r.method} ${r.confidence}]`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
