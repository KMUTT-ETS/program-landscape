import { describe, expect, it } from 'vitest';
import {
  buildProgramPeerSelectionMessages,
  PROGRAM_PEER_SELECTION_VERSION,
} from '../src/ai/prompts/program-peer-selection';

describe('program-peer-selection v2 — fabrication hotfix', () => {
  const messages = buildProgramPeerSelectionMessages({
    programDegree: 'Bachelor of Engineering',
    programNameTh: 'วิศวกรรมเครื่องกล',
    programNameEn: 'Mechanical Engineering',
    programLevel: 'BACHELOR',
    programFaculty: 'Faculty of Engineering',
    subjectHint: 'mechanical engineering',
    candidates: [
      {
        rankedUniversityId: 'u1',
        name: 'National University of Singapore',
        country: 'Singapore',
        region: 'Asia',
        qsWorldRank: 8,
      },
    ],
  });
  const system = messages.find((m) => m.role === 'system')?.content ?? '';

  it('is version 2', () => {
    expect(PROGRAM_PEER_SELECTION_VERSION).toBe('program-peer-selection.v2');
  });

  it('no longer instructs the model to fabricate a "defensible estimate" name', () => {
    expect(system).not.toContain('defensible estimate');
  });

  it('instructs a descriptive, non-official-sounding fallback name instead', () => {
    expect(system).toContain('descriptive');
    expect(system).toContain('non-official-sounding');
  });
});
