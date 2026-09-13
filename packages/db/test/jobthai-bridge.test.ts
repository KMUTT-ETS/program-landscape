import { describe, expect, it } from 'vitest';

import {
  JOBTHAI_MIN_POSTINGS_FOR_SIGNAL,
  eligiblePostingLevels,
  scoreFieldOfStudyLink,
  scoreSkillOverlapLink,
  combineLinkSources,
  matchFieldToProgramme,
  MAX_PROGRAMMES_PER_FIELD,
  MIN_POSTINGS_PER_LINK,
  distinctiveDemand,
  skillOverlapCounts,
  matchedPostingCounts,
  aggregateProgramJobThaiDemand,
  JOBTHAI_MIN_LINK_SCORE,
  OCCUPATION_SKILL_DEMAND_FLOOR,
  GENERIC_SKILL_OCCUPATION_SHARE,
} from '../src/jobthai-bridge';

describe('eligiblePostingLevels', () => {
  it('restricts a postgraduate programme to postgraduate postings', () => {
    // THE TRAP this guards: the field-of-study bridge matches a Master's in
    // Accounting to BACHELOR-level postings for สาขาบัญชี. 79% of master's and
    // 82% of doctoral programmes match some field, but only 41 postings
    // nationally state a postgraduate minimum. Gating on the POSTING's level is
    // what keeps the driver from scoring a PhD on undergraduate job adverts.
    expect(eligiblePostingLevels('MASTER')).toEqual(['MASTER', 'DOCTORATE']);
    expect(eligiblePostingLevels('DOCTORAL')).toEqual(['MASTER', 'DOCTORATE']);
  });

  it('lets a bachelor programme count bachelor and vocational-floor postings', () => {
    // A posting whose FLOOR is ปวส is open to a bachelor's graduate.
    const levels = eligiblePostingLevels('BACHELOR');
    expect(levels).toContain('BACHELOR');
    expect(levels).toContain('HIGHER_VOCATIONAL_CERT');
    expect(levels).not.toContain('MASTER');
  });

  it('treats a higher graduate diploma as postgraduate', () => {
    expect(eligiblePostingLevels('HIGHER_GRAD_DIPLOMA')).toEqual(['MASTER', 'DOCTORATE']);
  });

  it('never returns UNSPECIFIED — a posting that states no level states no demand for a level', () => {
    for (const lvl of ['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']) {
      expect(eligiblePostingLevels(lvl)).not.toContain('UNSPECIFIED');
    }
  });
});

describe('matchFieldToProgramme', () => {
  it('matches a discipline named inside the programme title', () => {
    expect(matchFieldToProgramme('บัญชี', 'หลักสูตรบัญชีบัณฑิต')).toBe(true);
  });

  it('does not match a field shorter than the floor', () => {
    // Thai has no word boundaries, so a very short field matches everywhere.
    expect(matchFieldToProgramme('ไฟ', 'หลักสูตรวิศวกรรมไฟฟ้า')).toBe(false);
  });

  it('does not match an unrelated discipline', () => {
    expect(matchFieldToProgramme('บัญชี', 'หลักสูตรวิศวกรรมไฟฟ้า')).toBe(false);
  });

  it('ignores the any-field sentinel — it is not a discipline', () => {
    // Otherwise every programme links to every occupation that ever said
    // ทุกสาขา, which is 2,566 postings.
    expect(matchFieldToProgramme('*ANY*', 'หลักสูตรบัญชีบัณฑิต')).toBe(false);
  });

  it('is whitespace and case insensitive', () => {
    expect(matchFieldToProgramme(' Logistics ', 'Bachelor of LOGISTICS Management')).toBe(true);
  });
});

describe('scoreFieldOfStudyLink', () => {
  it('is the share of the occupation’s eligible postings that ask for this programme’s field', () => {
    // v2. v1 divided matched FIELDS by the occupation's distinct fields, and an
    // occupation lists dozens: Mechanical Engineering -> mechanical/automotive
    // engineer scored 0.04 although 57% of those postings ask for เครื่องกล.
    expect(scoreFieldOfStudyLink({ matchedPostings: 147, eligiblePostings: 256 })).toBeCloseTo(0.574, 3);
  });

  it('returns 0 for no matched posting — absence is measurable here, unlike a missing metric', () => {
    expect(scoreFieldOfStudyLink({ matchedPostings: 0, eligiblePostings: 5 })).toBe(0);
  });

  it('guards a zero denominator rather than emitting NaN', () => {
    expect(scoreFieldOfStudyLink({ matchedPostings: 0, eligiblePostings: 0 })).toBe(0);
  });

  it('never exceeds 1 even if a caller double-counts', () => {
    expect(scoreFieldOfStudyLink({ matchedPostings: 12, eligiblePostings: 10 })).toBe(1);
  });
});

describe('matchedPostingCounts', () => {
  const postings = [
    // One posting naming two matching fields must count ONCE. v1 summed per
    // field, so "บัญชี, บัญชีบัณฑิต" counted twice.
    { level: 'BACHELOR', fields: ['บัญชี', 'บัญชีบัณฑิต'] },
    { level: 'BACHELOR', fields: ['การตลาด'] },
    { level: 'MASTER', fields: ['บัญชี'] },
    { level: 'UNSPECIFIED', fields: ['บัญชี'] },
  ];

  it('counts distinct postings, gated on the posting’s education floor', () => {
    const r = matchedPostingCounts({
      postings,
      levels: new Set(['BACHELOR']),
      matchesField: (f) => f.startsWith('บัญชี'),
    });
    expect(r).toEqual({ matchedPostings: 1, eligiblePostings: 2, matchedFields: ['บัญชี', 'บัญชีบัณฑิต'] });
  });
});

describe('scoreSkillOverlapLink', () => {
  it('is the share of the programme TAUGHT skills the occupation demands', () => {
    // The denominator is the PROGRAMME, not the occupation. Dividing by the
    // occupation's demand set (100-350 skills) against a programme teaching a
    // median of 9 capped every score near 0.03 and measured programme size
    // rather than alignment.
    expect(scoreSkillOverlapLink({ sharedSkills: 5, taughtSkills: 10 })).toBe(0.5);
  });

  it('returns 0 below the measured share floor — that is noise, not a weak link', () => {
    // Real output before this floor: Public Administration -> sales engineer,
    // on 1 shared skill of 124.
    expect(scoreSkillOverlapLink({ sharedSkills: 1, taughtSkills: 10 })).toBe(0);
  });

  it('returns 0 when the share clears the floor but too few skills are shared', () => {
    // 2 of 3 is 0.67, but two generic skills is not a career pathway.
    expect(scoreSkillOverlapLink({ sharedSkills: 2, taughtSkills: 3 })).toBe(0);
  });

  it('accepts a genuinely aligned pair', () => {
    expect(scoreSkillOverlapLink({ sharedSkills: 6, taughtSkills: 9 })).toBeCloseTo(0.667, 3);
  });

  it('guards a zero denominator', () => {
    expect(scoreSkillOverlapLink({ sharedSkills: 0, taughtSkills: 0 })).toBe(0);
  });
});

describe('distinctiveDemand', () => {
  // 10 occupations. "comm" is demanded (>= floor) by all 10, "mech" by 1.
  const occs = Array.from({ length: 10 }, (_, i) => `o${i}`);
  const rows = [
    ...occs.map((o) => ({ occupationId: o, skillId: 'comm', share: 0.3 })),
    { occupationId: 'o0', skillId: 'mech', share: 0.2 },
    // Named by one posting in 100 — present in the table, but not demand.
    { occupationId: 'o1', skillId: 'rare', share: 0.01 },
  ];

  it('counts a skill as demanded only at or above the posting-share floor', () => {
    const { demandedByOccupation } = distinctiveDemand(rows, occs.length);
    expect(demandedByOccupation.get('o0')).toEqual(new Set(['comm', 'mech']));
    // THE TRAP: jobthai_occupation_skills keeps a row for a skill ONE posting
    // mentioned. Treating that as demand is how Doctor of Medicine inherited
    // Sales/AE's 349-skill demand set.
    expect(demandedByOccupation.get('o1')?.has('rare')).toBe(false);
    expect(OCCUPATION_SKILL_DEMAND_FLOOR).toBe(0.05);
  });

  it('marks a skill generic when more than the measured fraction of occupations demand it', () => {
    // MEASURED 2026-09-13 at the 5% floor: Communication 227 of 240 occupations,
    // Management 195, Accounting 52; Mechanical engineering 27, Programming 24.
    const { generic } = distinctiveDemand(rows, occs.length);
    expect(generic).toEqual(new Set(['comm']));
    expect(GENERIC_SKILL_OCCUPATION_SHARE).toBe(0.2);
  });

  it('is not generic at exactly the threshold — the rule is strictly more than', () => {
    const two = [
      { occupationId: 'o0', skillId: 'x', share: 0.5 },
      { occupationId: 'o1', skillId: 'x', share: 0.5 },
    ];
    // 2 of 10 is exactly 0.2.
    expect(distinctiveDemand(two, 10).generic.has('x')).toBe(false);
  });
});

describe('skillOverlapCounts', () => {
  it('excludes generic skills from both the shared count and the taught denominator', () => {
    // Doctor of Medicine, as linked to Sales/AE under v1: 4 of 8 taught skills
    // shared, all four transferable. With generics removed it shares none.
    const taught = new Set(['medicine', 'comm', 'critical', 'ethics', 'research']);
    const demanded = new Set(['comm', 'critical', 'sales']);
    const generic = new Set(['comm', 'critical']);
    expect(skillOverlapCounts({ taught, demanded, generic })).toEqual({ sharedSkills: 0, taughtSkills: 3 });
  });

  it('still links a programme whose specific skills an occupation demands', () => {
    const taught = new Set(['circuits', 'power', 'control', 'comm']);
    const demanded = new Set(['circuits', 'power', 'control', 'comm']);
    const counts = skillOverlapCounts({ taught, demanded, generic: new Set(['comm']) });
    expect(counts).toEqual({ sharedSkills: 3, taughtSkills: 3 });
    expect(scoreSkillOverlapLink(counts)).toBe(1);
  });
});

describe('MAX_PROGRAMMES_PER_FIELD', () => {
  it('is the measured cut that removes generic vocabulary', () => {
    // "Science" matched 135 of 297 programmes; the median field matches 2.
    expect(MAX_PROGRAMMES_PER_FIELD).toBe(15);
  });
});

describe('MIN_POSTINGS_PER_LINK', () => {
  it('exists because a one-advert link is how postgraduate programmes got linked', () => {
    expect(MIN_POSTINGS_PER_LINK).toBeGreaterThanOrEqual(3);
  });
});

describe('combineLinkSources', () => {
  it('labels a link found by both paths and scores it above either alone', () => {
    const both = combineLinkSources({ fieldScore: 0.5, skillScore: 0.5 });
    expect(both!.linkSource).toBe('both');
    expect(both!.score).toBeGreaterThan(0.5);
    expect(both!.score).toBeLessThanOrEqual(1);
  });

  it('labels a field-only link', () => {
    expect(combineLinkSources({ fieldScore: 0.8, skillScore: 0 })!.linkSource).toBe('field-of-study');
  });

  it('labels a skill-only link', () => {
    expect(combineLinkSources({ fieldScore: 0, skillScore: 0.8 })!.linkSource).toBe('skill-overlap');
  });

  it('returns null when neither path found anything, rather than a zero-strength link', () => {
    expect(combineLinkSources({ fieldScore: 0, skillScore: 0 })).toBeNull();
  });

  it('never exceeds 1 even when both paths are certain', () => {
    expect(combineLinkSources({ fieldScore: 1, skillScore: 1 })!.score).toBe(1);
  });
});

describe('JOBTHAI_MIN_POSTINGS_FOR_SIGNAL', () => {
  it('is the measured 25th percentile, not the spec guess', () => {
    // Observed per-programme distribution over 246 matched programmes:
    // min 3, p25 20, median 136, p75 433, max 3,534. The spec guessed 30,
    // which discarded 18 more programmes for no measured reason.
    expect(JOBTHAI_MIN_POSTINGS_FOR_SIGNAL).toBe(20);
  });
});

describe('aggregateProgramJobThaiDemand', () => {
  const generic = new Set(['comm']);
  const occSkills = [
    { occupationId: 'mecheng', skillId: 'cad', share: 0.4 },
    { occupationId: 'mecheng', skillId: 'comm', share: 0.5 },
    { occupationId: 'mecheng', skillId: 'rare', share: 0.01 },
    { occupationId: 'maint', skillId: 'cad', share: 0.1 },
    { occupationId: 'maint', skillId: 'plc', share: 0.3 },
    { occupationId: 'sales', skillId: 'crm', share: 0.9 },
  ];

  it('weights each skill by the postings behind each eligible link', () => {
    const r = aggregateProgramJobThaiDemand({
      links: [
        { occupationId: 'mecheng', linkSource: 'field-of-study', score: 0.57, postingCount: 75 },
        { occupationId: 'maint', linkSource: 'both', score: 0.35, postingCount: 25 },
      ],
      occupationSkills: occSkills,
      generic,
    });
    expect(r.status).toBe('ok');
    expect(r.postings).toBe(100);
    const bySkill = new Map(r.demand.map((d) => [d.skillId, d]));
    // (75 × 0.4 + 25 × 0.1) / 100
    expect(bySkill.get('cad')?.share).toBeCloseTo(0.325, 6);
    expect(bySkill.get('cad')?.occupations).toBe(2);
    expect(bySkill.get('plc')?.share).toBeCloseTo(0.075, 6);
    expect(bySkill.get('comm')?.generic).toBe(true);
    // Below the demand floor once weighted — absent, not zero.
    expect(bySkill.has('rare')).toBe(false);
    // Sorted by share, highest first.
    expect(r.demand.map((d) => d.skillId)).toEqual(['comm', 'cad', 'plc']);
  });

  it('ignores skill-overlap-only links — they cannot vouch for the skills that created them', () => {
    // The overlap path links a programme BECAUSE its taught skills are
    // demanded; scoring alignment from that link measures the link rule.
    const r = aggregateProgramJobThaiDemand({
      links: [
        { occupationId: 'sales', linkSource: 'skill-overlap', score: 0.9, postingCount: 500 },
        { occupationId: 'mecheng', linkSource: 'field-of-study', score: 0.57, postingCount: 40 },
      ],
      occupationSkills: occSkills,
      generic,
    });
    expect(r.postings).toBe(40);
    expect(r.demand.some((d) => d.skillId === 'crm')).toBe(false);
  });

  it('ignores links below the minimum link score', () => {
    const r = aggregateProgramJobThaiDemand({
      links: [{ occupationId: 'mecheng', linkSource: 'field-of-study', score: 0.05, postingCount: 400 }],
      occupationSkills: occSkills,
      generic,
    });
    expect(r.status).toBe('no-links');
    expect(JOBTHAI_MIN_LINK_SCORE).toBe(0.1);
  });

  it('reports below-floor rather than a thin demand list', () => {
    const r = aggregateProgramJobThaiDemand({
      links: [{ occupationId: 'mecheng', linkSource: 'field-of-study', score: 0.5, postingCount: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL - 1 }],
      occupationSkills: occSkills,
      generic,
    });
    expect(r.status).toBe('below-floor');
    expect(r.demand).toEqual([]);
  });
});
