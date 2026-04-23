export type DecisionStatus =
  | 'PROPOSED'
  | 'COUNCIL_REVIEWED'
  | 'APPROVED'
  | 'IN_IMPLEMENTATION'
  | 'IMPLEMENTED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'ARCHIVED';

export type DecisionType = 'CLOSE' | 'MERGE' | 'LAUNCH' | 'RESTRUCTURE' | 'KEEP_AS_IS' | 'OTHER';

export type MilestoneStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED' | 'CANCELLED';

export type OutcomeReviewHorizon = 'SIX_MONTHS' | 'ONE_YEAR' | 'THREE_YEARS';

export interface DecisionListRow {
  id: string;
  title: string;
  decisionType: DecisionType;
  status: DecisionStatus;
  affectedProgramIds: string[];
  facultyId: string | null;
  effectiveDate: string | null;
  councilSessionRef: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  milestoneCount: number;
  approverCount: number;
  hasSnapshot: boolean;
  hasSupersedingDecision: boolean;
  owner: { id: string; name: string | null; email: string } | null;
}

export interface DecisionMilestoneDto {
  id: string;
  decisionId: string;
  title: string;
  descriptionTh: string | null;
  ownerId: string | null;
  targetDate: string | null;
  completedDate: string | null;
  status: MilestoneStatus;
  evidenceUrl: string | null;
  orderIdx: number;
  owner: { id: string; name: string | null; email: string } | null;
}

export interface DecisionApproverDto {
  id: string;
  decisionId: string;
  userId: string;
  role: string;
  signatureRef: string | null;
  approvedAt: string;
  noteTh: string | null;
  user: { id: string; name: string | null; email: string; role: string };
}

export interface OutcomeReviewDto {
  id: string;
  decisionId: string;
  horizon: OutcomeReviewHorizon;
  generatedAt: string;
  narrativeTh: string;
  narrativeEn: string | null;
  whatWorkedJson: { th: string[]; placeholder?: boolean };
  whatDidntWorkJson: { th: string[]; placeholder?: boolean };
  lessonsJson: { th: string[]; placeholder?: boolean };
  aiInferenceId: string | null;
  methodologyVersion: string;
}

export interface DecisionDetail {
  id: string;
  title: string;
  decisionType: DecisionType;
  status: DecisionStatus;
  affectedProgramIds: string[];
  facultyId: string | null;
  rationaleTh: string | null;
  rationaleEn: string | null;
  dissentingViewsTh: string | null;
  effectiveDate: string | null;
  councilSessionRef: string | null;
  snapshotJson: unknown;
  snapshotCapturedAt: string | null;
  version: number;
  supersededById: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string | null; email: string; role: string };
  scenario: { id: string; name: string; scenarioType: string; workflowStatus: string } | null;
  milestones: DecisionMilestoneDto[];
  approvers: DecisionApproverDto[];
  outcomeReviews: OutcomeReviewDto[];
  supersededBy: { id: string; title: string; status: DecisionStatus } | null;
  amendments: Array<{ id: string; title: string; status: DecisionStatus; version: number }>;
}

export interface LessonHit {
  decisionId: string;
  decisionTitle: string;
  decisionType: DecisionType;
  horizon: OutcomeReviewHorizon;
  generatedAt: string;
  lessonsTh: string[];
  lessonsEn: string[];
}
