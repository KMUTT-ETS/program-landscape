/**
 * DQ module → skill-taxonomy mapping.
 *
 * The gap-analyzer's digital-competency lens (see
 * `docs/superpowers/plans/2026-08-25-dq-score-platform-integration.md`,
 * Task 6) needs to place each of the 13 DQ theory modules against a row in
 * the platform's skill taxonomy so KMITL demand signal can be compared to
 * measured attainment.
 *
 * That taxonomy (5,152 skills) is built entirely from curriculum PDF
 * extraction — discipline vocabulary like "Digital Media Production" — and
 * was never populated with general digital-literacy vocabulary. Querying it
 * against all 13 modules produced roughly 3 exact matches, 5 near matches,
 * and 5 modules with no defensible counterpart at all. **That gap is the
 * finding, not a failure of searching** — do not widen a `near` verdict to
 * `exact`, and do not invent a `near` candidate for a `none` row to make
 * this table look more complete than the taxonomy actually is.
 *
 * Every non-null id below was verified against the live database on
 * 2026-08-25:
 *
 *   docker exec program-landscape-postgres psql -U kku -d program_landscape -c \
 *     "SELECT id, name_en FROM skills WHERE id IN (...);"
 *
 * Two things surfaced during verification that the source plan flagged as
 * open:
 *   - The module 13 candidate id in the plan (`cmoqi6yee00gq2nlfks0zgbo6`)
 *     does not exist. The correct "Generative AI Application" row is
 *     `cmoqi6yee00gq2nlff3mk8c20` — a one-segment typo, corrected here.
 *   - "Information Literacy" and "Operating Systems" are each duplicated in
 *     the taxonomy (2 rows apiece, identical name_en). The plan's ids
 *     (`cmoo1dif702um2qd6d6mzh7bz` and `cmoo0dzo500kz2qd6nbewxgyy`) resolve
 *     to real, distinct rows and are kept; the sibling duplicates
 *     (`cmoo2vwaa07132qd6m0ata69i`, `cmoo0ejwv000un2zljxo49ec2`) are noted
 *     here so a future cleanup pass knows they exist, but are intentionally
 *     unused.
 *
 * This mapping is a judgement call about vocabulary equivalence, not a
 * lookup — it needs an analyst's (or domain expert's) sign-off before the
 * gap-analyzer lens that consumes it ships to Council.
 */

export type DqSkillConfidence = 'exact' | 'near' | 'none';

export interface DqModuleSkillMapping {
  /** Matches `DqModule.no` for the THEORY_MODULE_<no> row in dq/modules.ts. */
  moduleNo: number;
  skillId: string | null;
  skillNameEn: string | null;
  confidence: DqSkillConfidence;
  /**
   * For `near`: the specific caveat a domain expert would raise if this
   * pairing were shown without qualification. For `none`: what was
   * searched for and not found.
   */
  note: string;
}

export const DQ_MODULE_SKILLS: readonly DqModuleSkillMapping[] = [
  {
    moduleNo: 1,
    skillId: null,
    skillNameEn: null,
    confidence: 'none',
    note: 'Searched for "Computer Basics", "Computer Literacy", "IT Fundamentals" and similar — nothing in the taxonomy corresponds to basic computer operation. The taxonomy has no general-computing-literacy vocabulary at all.',
  },
  {
    moduleNo: 2,
    skillId: null,
    skillNameEn: null,
    confidence: 'none',
    note: 'Searched for "Internet" — the only matches are "Internet of Things" and "Internet Protocol Suite" (TCP/IP), both networking-engineering skills unrelated to general internet-use literacy. No counterpart for browsing, search, or web-navigation competency.',
  },
  {
    moduleNo: 3,
    skillId: null,
    skillNameEn: null,
    confidence: 'none',
    note: 'Searched for "Online Collaboration", "Collaboration Tools", "Cloud Collaboration" — only generic "Collaboration and Leadership" exists, which is a workplace-teamwork skill, not the DQ module\'s test of shared-document / video-conferencing tool use.',
  },
  {
    moduleNo: 4,
    skillId: 'cmoo0dzo500kz2qd6nbewxgyy',
    skillNameEn: 'Operating Systems',
    confidence: 'exact',
    note: 'Direct match. "Operating Systems" is duplicated in the taxonomy (a second row with the same name_en exists at id cmoo0ejwv000un2zljxo49ec2); this row was the one named in the source query and is used here — the duplicate is unused.',
  },
  {
    moduleNo: 5,
    skillId: null,
    skillNameEn: null,
    confidence: 'none',
    note: 'Searched for "Word Processing", "Document Editing", "Microsoft Word" — nothing in the taxonomy. No office-productivity-software vocabulary exists at this level of specificity.',
  },
  {
    moduleNo: 6,
    skillId: null,
    skillNameEn: null,
    confidence: 'none',
    note: 'Searched for "Spreadsheet", "Excel" — the only match is "Excel Dashboards", an advanced BI/data-visualization skill from analytics curricula, not the basic spreadsheet-literacy the DQ module tests (formulas, sorting, simple charts). Treated as not a defensible counterpart, same reasoning as module 5.',
  },
  {
    moduleNo: 7,
    skillId: 'cmoqi5dfy00e22nlfaemrgtic',
    skillNameEn: 'Academic Presentation',
    confidence: 'near',
    note: 'DQ module 7 tests whether a student can operate presentation software (slide creation, layout, basic animation). "Academic Presentation" in the taxonomy is about the ACT of presenting — public speaking and academic delivery — not the software skill. Related but not the same competency; do not treat scores against this skill as software proficiency.',
  },
  {
    moduleNo: 8,
    skillId: 'cmoqia2ud00oj2nlf8f3w8ulk',
    skillNameEn: 'Digital Media Production',
    confidence: 'near',
    note: 'DQ module 8 tests basic digital-media literacy (image/audio/video editing at a general-user level). "Digital Media Production" in the taxonomy comes from media/communications curricula and implies a professional production skill level, not the general-competency floor the DQ module measures.',
  },
  {
    moduleNo: 9,
    skillId: 'cmoqi6yld00gz2nlfks0zgbo6',
    skillNameEn: 'Social Media Communication',
    confidence: 'near',
    note: 'DQ module 9 tests safe/effective personal use of social media platforms. "Social Media Communication" in the taxonomy is a marketing/communications curriculum skill (professional audience engagement, brand voice), not general-user platform literacy. Adjacent, not equivalent.',
  },
  {
    moduleNo: 10,
    skillId: 'cmoo1dif702um2qd6d6mzh7bz',
    skillNameEn: 'Information Literacy',
    confidence: 'exact',
    note: 'Direct match on name and concept — evaluating source credibility and searching effectively. "Information Literacy" is duplicated in the taxonomy (a second row with the same name_en exists at id cmoo2vwaa07132qd6m0ata69i); this row was the one named in the source query and is used here — the duplicate is unused.',
  },
  {
    moduleNo: 11,
    skillId: 'cmoo2uikl06wk2qd6r7f2kra4',
    skillNameEn: 'Career and Learning Skills',
    confidence: 'near',
    note: 'DQ module 11 tests digital career-search skills specifically (using online job platforms, building an online professional profile). "Career and Learning Skills" in the taxonomy is a broader employability/self-directed-learning skill without a digital-tooling focus. Overlapping theme, narrower module scope.',
  },
  {
    moduleNo: 12,
    skillId: 'cmoo2jzkh06462qd613cnuiur',
    skillNameEn: 'Digital Citizenship',
    confidence: 'near',
    note: 'DQ module 12 tests awareness and management of one\'s own digital footprint specifically (privacy settings, what one has posted, reputational exposure). "Digital Citizenship" in the taxonomy is the broader concept of responsible/ethical online conduct, of which footprint management is one part, not the whole. Superset, not synonym.',
  },
  {
    moduleNo: 13,
    skillId: 'cmoqi6yee00gq2nlff3mk8c20',
    skillNameEn: 'Generative AI Application',
    confidence: 'exact',
    note: 'Direct match. Note the id differs from the source plan\'s draft (cmoqi6yee00gq2nlfks0zgbo6, which does not exist in the database) — verified and corrected against the live taxonomy on 2026-08-25.',
  },
];
