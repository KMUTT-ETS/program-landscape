export type TrendSignalType = 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';

export interface TrendSignalDto {
  id: string;
  signalType: TrendSignalType;
  title: string;
  summaryTh: string | null;
  summaryEn: string | null;
  sourceUrl: string | null;
  detectedDate: string;
  impactScore: number;
  affectedProgramIds: string[];
  affectedSkillIds: string[];
  aiInferenceId: string | null;
}

export interface TrendsFeedResponse {
  total: number;
  windowStart: string;
  highImpactCount: number;
  dangerZoneCount: number;
  signals: TrendSignalDto[];
}
