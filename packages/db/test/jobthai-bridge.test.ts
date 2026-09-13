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
  it('scores an exact discipline match highest', () => {
    expect(scoreFieldOfStudyLink({ matchedFields: 3, totalFieldsForOccupation: 3 })).toBe(1);
  });

  it('scores a partial match proportionally', () => {
    expect(scoreFieldOfStudyLink({ matchedFields: 1, totalFieldsForOccupation: 4 })).toBe(0.25);
  });

  it('returns 0 for no matched field — absence is measurable here, unlike a missing metric', () => {
    expect(scoreFieldOfStudyLink({ matchedFields: 0, totalFieldsForOccupation: 5 })).toBe(0);
  });

  it('guards a zero denominator rather than emitting NaN', () => {
    expect(scoreFieldOfStudyLink({ matchedFields: 0, totalFieldsForOccupation: 0 })).toBe(0);
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
