/**
 * AUN-QA v4 programme-level criteria, and what this platform can
 * evidence for each.
 *
 * ── PROVENANCE WARNING ────────────────────────────────────────────────
 * This criteria list was written from the assistant's own knowledge of
 * AUN-QA v4. NO AUN-QA guide exists in this repository, and nothing here
 * has been checked against the official document. Before this feeds any
 * real accreditation submission, verify the criteria, their numbering
 * and their sub-criteria against the published v4 guide.
 *
 * It is deliberately DATA, not code: correcting a title, renumbering, or
 * adding a sub-criterion is an edit to this table and nothing else. No
 * criterion name or number may be duplicated into component code, prompt
 * text, or a database column.
 *
 * Reinforcing the warning: of three KKU curricula sampled on 2026-08-26,
 * the QA framework each one declares is WFME (medicine) or TQF (x2) —
 * NONE names AUN-QA. Organising the platform's evidence along AUN-QA v4
 * is therefore our analytical overlay, not a claim the source curriculum
 * documents make.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Criteria 6 (Student Support Services) and 7 (Facilities &
 * Infrastructure) have no data in the platform and are listed separately
 * in AUNQA_UNEVIDENCED_CRITERIA — named rather than hidden, so a reader
 * cannot infer that six criteria are the whole framework.
 */

/** A declarative pointer to a platform metric. Adding a data source later
 *  means adding a binding here — not touching the page. A resolver turns
 *  each binding into an availability + value for a given programme. */
export type EvidenceBinding =
  | { kind: 'evaluation-theme'; theme: string }
  | { kind: 'dq-module-profile' }
  | { kind: 'dq-program-score' }
  | {
      kind: 'graduate-outcome';
      field: 'employmentRate' | 'jobRelevance' | 'furtherStudy' | 'salary';
    }
  | { kind: 'class-gpa-distribution' }
  | {
      kind: 'staff-metric';
      field: 'studentFacultyRatio' | 'rankMix' | 'workload' | 'research';
    }
  | { kind: 'curriculum'; field: 'courses' | 'skills' | 'credits' }
  | { kind: 'pedagogy-assessment'; field: 'disciplineFit' | 'qaSystem' | 'gaps' }
  | { kind: 'peer-review'; field: 'contentModernity' | 'contentGaps' };

export type EvidenceBindingKind = EvidenceBinding['kind'];

export interface AunqaSubCriterion {
  /** '<criterion>.<n>', e.g. '3.2'. */
  id: string;
  title: string;
  /** Never empty. A sub-criterion with nothing that could evidence it is
   *  omitted from the table entirely rather than shipped as a permanent
   *  blank row on an accreditation surface. */
  evidence: EvidenceBinding[];
}

export interface AunqaCriterion {
  /** '1'..'8' as a string — AUN-QA numbering, not an array index. */
  id: string;
  title: string;
  subCriteria: AunqaSubCriterion[];
}

/** A criterion the platform holds no data for. Named, not hidden. */
export interface AunqaUnevidencedCriterion {
  id: string;
  title: string;
  /** One line a reader can act on: why there is nothing here. */
  whyAbsent: string;
}

export const AUNQA_CRITERIA: readonly AunqaCriterion[] = [
  {
    id: '1',
    title: 'Expected Learning Outcomes',
    subCriteria: [
      {
        id: '1.1',
        title: 'Programme learning outcomes are clearly defined',
        evidence: [
          { kind: 'curriculum', field: 'skills' },
          { kind: 'curriculum', field: 'credits' },
        ],
      },
      {
        id: '1.2',
        title: 'Learning outcomes reflect stakeholder needs',
        evidence: [
          { kind: 'curriculum', field: 'skills' },
          { kind: 'evaluation-theme', theme: 'ethics' },
        ],
      },
      {
        id: '1.3',
        title: 'Generic and subject-specific outcomes are both covered',
        evidence: [
          { kind: 'evaluation-theme', theme: 'english-skills' },
          { kind: 'evaluation-theme', theme: 'ethics' },
          // Digital competency is an institution-wide expected outcome.
          { kind: 'dq-program-score' },
          { kind: 'curriculum', field: 'skills' },
        ],
      },
      {
        id: '1.4',
        title: 'Outcomes align with the institutional vision and mission',
        evidence: [
          { kind: 'dq-program-score' },
          { kind: 'curriculum', field: 'skills' },
        ],
      },
    ],
  },
  {
    id: '2',
    title: 'Programme Structure and Content',
    subCriteria: [
      {
        id: '2.1',
        title: 'Curriculum design shows constructive alignment with the learning outcomes',
        evidence: [
          { kind: 'curriculum', field: 'courses' },
          { kind: 'evaluation-theme', theme: 'content-design' },
        ],
      },
      {
        id: '2.2',
        title: 'Structure, sequence and integration of courses',
        evidence: [
          { kind: 'curriculum', field: 'courses' },
          { kind: 'curriculum', field: 'credits' },
          { kind: 'evaluation-theme', theme: 'content-design' },
        ],
      },
      {
        id: '2.3',
        title: 'Content is current and up to date',
        evidence: [
          { kind: 'peer-review', field: 'contentModernity' },
          { kind: 'peer-review', field: 'contentGaps' },
        ],
      },
    ],
  },
  {
    id: '3',
    title: 'Teaching and Learning Approach',
    subCriteria: [
      {
        id: '3.1',
        title: 'The educational philosophy is stated and communicated',
        evidence: [{ kind: 'pedagogy-assessment', field: 'qaSystem' }],
      },
      {
        id: '3.2',
        title: 'Teaching and learning activities align with the expected learning outcomes',
        evidence: [
          { kind: 'pedagogy-assessment', field: 'disciplineFit' },
          { kind: 'evaluation-theme', theme: 'active-learning' },
        ],
      },
      {
        id: '3.3',
        title: 'Activities foster lifelong learning',
        evidence: [
          { kind: 'pedagogy-assessment', field: 'gaps' },
          { kind: 'evaluation-theme', theme: 'active-learning' },
        ],
      },
    ],
  },
  {
    id: '4',
    title: 'Student Assessment',
    subCriteria: [
      {
        id: '4.1',
        title: 'Assessment is aligned with the expected learning outcomes',
        evidence: [{ kind: 'evaluation-theme', theme: 'assessment' }],
      },
      {
        id: '4.2',
        title: 'Students receive timely feedback',
        evidence: [{ kind: 'evaluation-theme', theme: 'feedback' }],
      },
      {
        id: '4.3',
        title: 'Assessment methods are valid, reliable and transparent',
        evidence: [
          { kind: 'evaluation-theme', theme: 'assessment' },
          { kind: 'class-gpa-distribution' },
        ],
      },
    ],
  },
  {
    id: '5',
    title: 'Academic Staff',
    // 5.3 (recruitment and promotion) and 5.5 (performance management) are
    // real v4 sub-criteria, omitted here because the platform holds nothing
    // that could ever evidence them — no recruitment, promotion or appraisal
    // data exists in any source. Listing them would ship a permanent blank
    // row onto an accreditation surface; do not add them back with an
    // invented binding.
    subCriteria: [
      {
        id: '5.1',
        title: 'Staff planning and workload',
        evidence: [
          { kind: 'staff-metric', field: 'studentFacultyRatio' },
          { kind: 'staff-metric', field: 'workload' },
        ],
      },
      {
        id: '5.2',
        title: 'Staff competences match programme needs',
        evidence: [
          { kind: 'staff-metric', field: 'rankMix' },
          { kind: 'staff-metric', field: 'research' },
        ],
      },
      {
        id: '5.4',
        title: 'Staff development',
        evidence: [
          { kind: 'staff-metric', field: 'research' },
          { kind: 'staff-metric', field: 'rankMix' },
        ],
      },
    ],
  },
  {
    id: '8',
    title: 'Output and Outcomes',
    subCriteria: [
      {
        id: '8.1',
        title: 'Pass and dropout rates',
        evidence: [{ kind: 'class-gpa-distribution' }],
      },
      {
        id: '8.2',
        title: 'Time to graduate',
        // Bound to the progression record rather than to a direct
        // time-to-graduate series, which the platform does not hold as
        // its own metric. Cohort progression exists in the data but the
        // binding vocabulary has no kind for it; if one is added later,
        // rebind this sub-criterion rather than reading more into GPA
        // distributions than they say.
        evidence: [{ kind: 'class-gpa-distribution' }],
      },
      {
        id: '8.3',
        title: 'Employability of graduates',
        evidence: [
          { kind: 'graduate-outcome', field: 'employmentRate' },
          { kind: 'graduate-outcome', field: 'jobRelevance' },
          { kind: 'graduate-outcome', field: 'salary' },
          { kind: 'dq-module-profile' },
        ],
      },
      {
        id: '8.4',
        title: 'Research output of the programme',
        evidence: [{ kind: 'staff-metric', field: 'research' }],
      },
      {
        id: '8.5',
        title: 'Stakeholder satisfaction',
        evidence: [
          { kind: 'graduate-outcome', field: 'jobRelevance' },
          { kind: 'dq-module-profile' },
        ],
      },
    ],
  },
];

export const AUNQA_UNEVIDENCED_CRITERIA: readonly AunqaUnevidencedCriterion[] = [
  {
    id: '6',
    title: 'Student Support Services',
    whyAbsent:
      'No student support, advising or welfare data is ingested by any connector, so the platform can evidence nothing here.',
  },
  {
    id: '7',
    title: 'Facilities and Infrastructure',
    whyAbsent:
      'No facilities, laboratory or learning-space inventory exists in the platform, so the platform can evidence nothing here.',
  },
];

/** Every binding across every sub-criterion, flattened. Used by the
 *  resolvers to know what to fetch, and by tests to check the table. */
export function allEvidenceBindings(): EvidenceBinding[] {
  return AUNQA_CRITERIA.flatMap((criterion) =>
    criterion.subCriteria.flatMap((sub) => sub.evidence),
  );
}

/** Look up an evidenced criterion by its AUN-QA number. Returns undefined
 *  for criteria 6 and 7 — those live in AUNQA_UNEVIDENCED_CRITERIA. */
export function criterionById(id: string): AunqaCriterion | undefined {
  return AUNQA_CRITERIA.find((criterion) => criterion.id === id);
}
