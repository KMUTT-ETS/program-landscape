// Provenance on program_demand_matches.
//
// WHY THIS EXISTS: all 6,224 rows in this table carried
// ingestion_run_id = NULL, so none passed realDataWhere() and the
// `demand_match_filled` relevance driver read null on all 301 programmes
// despite 285 of them having real AI match analysis behind them.
//
// These rows are AI-derived, not connector-derived, so there is no run of
// "their own" connector to point at — which is why nobody noticed the
// column was never filled. Their real provenance is the demand source
// that supplied the skill set they were matched against.
//
// Third occurrence of this class in the codebase after `tcas` and Google
// Scholar, hence a test rather than a note.

import { describe, expect, it, vi } from 'vitest';

import { demandMatchProvenanceSource } from '@kku/db';
import {
  buildDemandChecklist,
  JOBTHAI_CHECKLIST_MAX,
  resolveDemandProvenanceRunId,
  resolveTaughtSkillId,
} from '../../src/program-demand-match/run';

describe('resolveDemandProvenanceRunId', () => {
  it('returns the run id of the demand source that supplied the skill set', async () => {
    const runId = await resolveDemandProvenanceRunId({
      findLatestSucceededRun: (slug) =>
        Promise.resolve(slug === 'kmitl-skill-mapping' ? 'run-kmitl-1' : null),
      demandSourceSlug: 'kmitl-skill-mapping',
    });
    expect(runId).toBe('run-kmitl-1');
  });

  it('returns null rather than inventing a run when the source has none', async () => {
    // A wrong provenance is worse than an absent one: realDataWhere()
    // already treats null as "not real", whereas a fabricated FK would
    // make unreal rows count as real.
    const runId = await resolveDemandProvenanceRunId({
      findLatestSucceededRun: () => Promise.resolve(null),
      demandSourceSlug: 'kmitl-skill-mapping',
    });
    expect(runId).toBeNull();
  });

  it('asks for exactly the slug it was given', async () => {
    const findLatestSucceededRun = vi.fn().mockResolvedValue('run-1');
    await resolveDemandProvenanceRunId({
      findLatestSucceededRun,
      demandSourceSlug: 'jobthai',
    });
    // toHaveBeenCalledExactlyOnceWith is not available in this vitest
    // version; the two assertions together say the same thing.
    expect(findLatestSucceededRun).toHaveBeenCalledTimes(1);
    expect(findLatestSucceededRun).toHaveBeenCalledWith('jobthai');
  });
});

describe('buildDemandChecklist (v5.2 — LinkedIn and JobThai in one AI check)', () => {
  const jobThai = (skills: Array<{ skillId: string; share: number; generic?: boolean }>, status: 'ok' | 'no-links' = 'ok') => ({
    status,
    postings: 100,
    occupations: 3,
    demand: skills.map((s) => ({ occupations: 1, generic: false, ...s })),
  });

  it('unions both sources and records which demanded each skill', () => {
    const list = buildDemandChecklist(['a', 'b'], jobThai([{ skillId: 'b', share: 0.4 }, { skillId: 'c', share: 0.2 }]));
    expect(Object.fromEntries(list)).toEqual({
      a: ['kmitl-skill-mapping'],
      b: ['kmitl-skill-mapping', 'jobthai'],
      c: ['jobthai'],
    });
  });

  it('leaves generic JobThai skills off the checklist', () => {
    const list = buildDemandChecklist([], jobThai([{ skillId: 'comm', share: 0.3, generic: true }, { skillId: 'tax', share: 0.07 }]));
    expect([...list.keys()]).toEqual(['tax']);
  });

  it('caps JobThai at the highest-share skills', () => {
    const many = Array.from({ length: JOBTHAI_CHECKLIST_MAX + 5 }, (_, i) => ({ skillId: `s${i}`, share: 1 - i / 100 }));
    const list = buildDemandChecklist([], jobThai(many));
    expect(list.size).toBe(JOBTHAI_CHECKLIST_MAX);
    expect(list.has('s0')).toBe(true);
    expect(list.has(`s${JOBTHAI_CHECKLIST_MAX}`)).toBe(false);
  });

  it('adds nothing from JobThai when the programme has no eligible demand', () => {
    const list = buildDemandChecklist(['a'], jobThai([{ skillId: 'x', share: 0.5 }], 'no-links'));
    expect([...list.keys()]).toEqual(['a']);
  });
});

describe('demandMatchProvenanceSource', () => {
  it('attributes a skill both sources demanded to LinkedIn, so pre-v5.2 rows keep their provenance on re-run', () => {
    expect(demandMatchProvenanceSource(['jobthai', 'kmitl-skill-mapping'])).toBe('kmitl-skill-mapping');
    expect(demandMatchProvenanceSource(['jobthai'])).toBe('jobthai');
    expect(demandMatchProvenanceSource([])).toBeNull();
  });
});

describe('resolveTaughtSkillId', () => {
  const taught = [
    { skillId: 'tax', nameEn: 'Taxation', nameTh: 'การภาษีอากร' },
    { skillId: 'audit', nameEn: 'Internal Audit and Internal Control', nameTh: 'การตรวจสอบภายใน' },
  ];

  it('resolves the AI’s matchedTaughtSkillName to the programme’s own skill row', () => {
    // The AI returned this name on every extracted-skill match and the runner
    // never stored it, so matched_taught_skill_id was NULL on all rows and the
    // Deep-Dive listed "Taxation" as surplus beside "Tax Law ✓ taught".
    expect(resolveTaughtSkillId(' taxation ', taught)).toBe('tax');
    expect(resolveTaughtSkillId('การตรวจสอบภายใน', taught)).toBe('audit');
  });

  it('returns null rather than guessing on no exact match', () => {
    expect(resolveTaughtSkillId('Tax', taught)).toBeNull();
    expect(resolveTaughtSkillId('', taught)).toBeNull();
  });
});
