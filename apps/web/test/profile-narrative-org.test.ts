import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KKU_REFERENCE_ORGANIZATION, setOrganizationForTest } from '@kku/shared';

const ensureOrganizationLoaded = vi.fn<() => Promise<void>>(async () => undefined);

vi.mock('@kku/db', () => ({
  ensureOrganizationLoaded: () => ensureOrganizationLoaded(),
  PrismaAiInferenceRecorder: class {},
  getAiModelOverrideStore: () => ({ resolve: async () => null }),
}));

const { generateExpertiseNarrative } = await import('../src/lib/profile-narrative');

const INPUT = { education: ['PhD, Example University'], publicationTitles: ['Soil carbon in rice paddies'] };
const CTX = { userId: 'u1', facultyMemberId: null };

const savedKey = process.env.GOOGLE_AI_API_KEY;
const savedProvider = process.env.AI_PROVIDER;

beforeEach(() => {
  process.env.AI_PROVIDER = 'google';
  process.env.GOOGLE_AI_API_KEY = 'test-key-not-real';
  ensureOrganizationLoaded.mockReset();
  ensureOrganizationLoaded.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  process.env.GOOGLE_AI_API_KEY = savedKey;
  process.env.AI_PROVIDER = savedProvider;
  setOrganizationForTest(KKU_REFERENCE_ORGANIZATION);
  vi.restoreAllMocks();
});

describe('generateExpertiseNarrative — organisation failures are never cached', () => {
  it('returns an uncacheable placeholder when no organisation profile exists', async () => {
    setOrganizationForTest(null);
    const out = await generateExpertiseNarrative(INPUT, CTX);
    expect(out.cacheable).toBe(false);
    expect(out.narrative.confidence).toBe(0);
    expect(ensureOrganizationLoaded).toHaveBeenCalledTimes(1);
  });

  it('returns an uncacheable placeholder when the organisation could not be loaded', async () => {
    setOrganizationForTest(undefined);
    ensureOrganizationLoaded.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const out = await generateExpertiseNarrative(INPUT, CTX);
    expect(out.cacheable).toBe(false);
  });

  it('keeps caching the no-AI-key placeholder (existing behaviour)', async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const out = await generateExpertiseNarrative(INPUT, CTX);
    expect(out.cacheable).toBe(true);
    expect(out.narrative.confidence).toBe(0);
  });
});
