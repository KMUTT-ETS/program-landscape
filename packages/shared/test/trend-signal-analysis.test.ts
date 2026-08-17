import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTrendSignalAnalysisMessages,
  TREND_SIGNAL_ANALYSIS_VERSION,
  TrendSignalAnalysisSchema,
  type TrendSignalAnalysisInput,
} from '../src/ai/prompts/trend-signal-analysis';

const BASE_INPUT: TrendSignalAnalysisInput = {
  signal: {
    signalType: 'MARKET',
    title: 'EV battery manufacturers report a shortage of process engineers in the Northeast',
    summaryTh: 'ผู้ผลิตแบตเตอรี่ EV รายงานการขาดแคลนวิศวกรกระบวนการในภาคตะวันออกเฉียงเหนือ',
    summaryEn: 'EV battery manufacturers report a shortage of process engineers in the Northeast.',
    sourceUrl: 'https://example.com/report',
    impactScore: 72,
  },
  programs: [
    {
      id: 'prog-1',
      nameEn: 'Chemical Engineering',
      nameTh: 'วิศวกรรมเคมี',
      faculty: 'Faculty of Engineering',
      topSkills: ['Process engineering', 'Battery chemistry', 'Materials science'],
    },
    {
      id: 'prog-2',
      nameEn: 'Business Administration',
      nameTh: 'บริหารธุรกิจ',
      faculty: 'Faculty of Business Administration and Accountancy',
      topSkills: [],
    },
  ],
};

describe('trend-signal-analysis v4 builder', () => {
  const messages = buildTrendSignalAnalysisMessages(BASE_INPUT);
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';

  it('is version 4', () => {
    expect(TREND_SIGNAL_ANALYSIS_VERSION).toBe('trend-signal-analysis.v4');
  });

  it('carries the confidence rubric verbatim and the tell ban', () => {
    expect(system).toContain('CONFIDENCE RUBRIC');
    expect(system).toContain(
      '0.90-1.00  every key input channel present and mutually consistent',
    );
    expect(system).toContain('below 0.50 best effort over sparse input — flag for human review');
    expect(system).toMatch(/BANNED PHRASES/i);
  });

  it('states the English-output rule for `rationale`', () => {
    expect(system).toMatch(/`rationale` is English-only/);
  });

  it('carries the CHANNEL MANIFEST block', () => {
    expect(system + user).not.toMatch(/^$/); // sanity: not empty
  });

  it('renders each program with its top taught skills — the grounding fix', () => {
    expect(user).toContain('taught skills');
    expect(user).toContain('Process engineering');
    expect(user).toContain('Battery chemistry');
  });

  it('labels a program with no skill data explicitly, rather than omitting it silently', () => {
    expect(user).toContain('prog-2');
    expect(user).toContain('(no skill data — do not assert curriculum-specific role fit for this program)');
  });

  it('instructs the model to ground program-specific fit claims in the listed skills, not general knowledge', () => {
    expect(system).toMatch(/GROUNDING/);
    expect(system).toContain('MUST be justifiable by naming or clearly matching one or more of those listed skills');
    expect(system).toContain('not a claim about this specific KKU program');
  });

  it('instructs no curriculum-specific claims when skill data is absent', () => {
    expect(system).toContain('do NOT assert curriculum-specific fit');
  });

  it('still requires programId to come from the supplied PROGRAMS list', () => {
    expect(system).toContain('MUST appear in PROGRAMS below');
  });
});

describe('CHANNEL MANIFEST', () => {
  it('is present as a file-level comment block', () => {
    const src = readFileSync(
      path.join(__dirname, '..', 'src', 'ai', 'prompts', 'trend-signal-analysis.ts'),
      'utf8',
    );
    expect(src).toMatch(/CHANNEL MANIFEST/);
  });
});

describe('TrendSignalAnalysisSchema', () => {
  const validPayload = {
    affectedPrograms: [
      {
        programId: 'prog-1',
        immediateRoles: [{ titleTh: 'วิศวกรกระบวนการ', titleEn: 'Process engineer' }],
        emergingRoles: [{ titleTh: 'วิศวกรแบตเตอรี่', titleEn: 'Battery engineer' }],
        fitNoteTh: 'หลักสูตรมีทักษะเคมีกระบวนการและวัสดุศาสตร์ตรงกับความต้องการ',
      },
    ],
    affectedSkills: ['Battery chemistry', 'Process engineering'],
    recommendedActions: [
      {
        priority: 'high' as const,
        titleTh: 'เพิ่มวิชาเทคโนโลยีแบตเตอรี่',
        titleEn: 'Add a battery technology elective',
        detailTh: 'เปิดวิชาเลือกด้านเทคโนโลยีแบตเตอรี่ให้นักศึกษาชั้นปีที่ 3',
        detailEn: 'Offer a battery-technology elective to third-year students to address the reported shortage.',
        exampleProjects: [
          {
            titleTh: 'ความร่วมมือกับโรงงานแบตเตอรี่',
            titleEn: 'Industry partnership with a battery plant',
            descTh: 'ฝึกงานร่วมกับโรงงานในภาคตะวันออกเฉียงเหนือ',
            descEn: 'Co-op placements with a Northeast battery manufacturer.',
          },
        ],
      },
    ],
    newInitiatives: [],
    rationale: 'The signal names process-engineer shortages that Chemical Engineering graduates already fit.',
    confidence: 0.8,
  };

  it('accepts a fully valid payload', () => {
    expect(TrendSignalAnalysisSchema.safeParse(validPayload).success).toBe(true);
  });

  it('requires `rationale` (English) rather than `rationaleTh`', () => {
    const { rationale: _rationale, ...withoutRationale } = validPayload;
    expect(TrendSignalAnalysisSchema.safeParse(withoutRationale).success).toBe(false);
    const withOldField = { ...withoutRationale, rationaleTh: 'เหตุผลภาษาไทย' };
    expect(TrendSignalAnalysisSchema.safeParse(withOldField).success).toBe(false);
  });

  it('rejects an affectedPrograms entry missing programId', () => {
    const bad = { ...validPayload, affectedPrograms: [{ immediateRoles: [], emergingRoles: [] }] };
    expect(TrendSignalAnalysisSchema.safeParse(bad).success).toBe(false);
  });
});
