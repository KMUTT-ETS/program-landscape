import { describe, it, expect, vi } from 'vitest';

// Plain object literal mock — no vi.importActual spread, so the test can never
// reach the live dev database.
const mocks = vi.hoisted(() => ({ ploFindMany: vi.fn() }));
vi.mock('@kku/db', () => ({
  prisma: { programLearningOutcome: { findMany: mocks.ploFindMany } },
}));

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadProgramPlos } from '../src/program-peers/plos';

describe('loadProgramPlos', () => {
  it('reads the PLO table in ordinal order and returns the normalised texts', async () => {
    mocks.ploFindMany.mockResolvedValue([{ textNormalised: 'ก' }, { textNormalised: 'ข' }]);
    await expect(loadProgramPlos('p1')).resolves.toEqual(['ก', 'ข']);
    expect(mocks.ploFindMany).toHaveBeenCalledWith({
      where: { programId: 'p1' },
      orderBy: { ordinal: 'asc' },
      select: { textNormalised: true },
    });
  });

  it('is what the peer review feeds the prompt (not the digest payload)', () => {
    const src = readFileSync(path.join(__dirname, '..', 'src', 'program-peers', 'review.ts'), 'utf8');
    expect(src).toMatch(/programLearningOutcomes\s*=\s*await loadProgramPlos\(program\.id\)/);
    expect(src).not.toMatch(/digestPayload\?\.programLearningOutcomes/);
  });
});
