import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PROMPTS_DIR = path.join(__dirname, '..', 'src', 'ai', 'prompts');

// Prompts not yet rewritten to docs/prompt-standard.md. REMOVE entries as
// rewrites land — never add to this list. A new prompt file must conform
// from birth (it will fail here until it does).
const NOT_YET_CONFORMANT = new Set<string>([
  'benchmarking-insights.ts',
  'career-kmitl-mapping.ts',
  'course-skill-extraction.ts',
  'decision-review.ts',
  'demand-skill-match.ts',
  'evaluation-question-translate.ts',
  'expertise-narrative.ts',
  'external-feed-summary.ts',
  'graduate-employment-survey.ts',
  'imd-rankings-extract.ts',
  'job-posting-skill-extraction.ts',
  'pdf-classify.ts',
  'policy-doc-analysis.ts',
  'program-ai-readiness.ts',
  'program-courses-extract.ts',
  'program-digest.ts',
  'program-faculty-extraction.ts',
  'program-pedagogy.ts',
  'program-peer-review.ts',
  'program-peer-selection.ts',
  'program-skills-detailed.ts',
  'risk-assessment.ts',
  'skill-name-normaliser.ts',
  'trend-document-ingest.ts',
  'trend-signal-analysis.ts',
]);

const REQUIRED_MARKERS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'channel manifest', pattern: /CHANNEL MANIFEST/ },
  { name: 'confidence rubric', pattern: /CONFIDENCE RUBRIC/ },
  { name: 'English output rule', pattern: /English/ },
];

// The tell-ban applies to the SYSTEM PROMPT text we ship, meaning the file
// must contain the ban list (so the model is told), detected via its header:
const TELL_BAN_MARKER = /BANNED PHRASES|banned AI tells/i;

describe('prompt-standard conformance (ratchet)', () => {
  const files = readdirSync(PROMPTS_DIR).filter(
    (f) => f.endsWith('.ts') && f !== 'index.ts',
  );

  for (const file of files) {
    const conformant = !NOT_YET_CONFORMANT.has(file);
    it(`${file} ${conformant ? 'meets the standard' : 'is allowlisted (pending rewrite)'}`, () => {
      const src = readFileSync(path.join(PROMPTS_DIR, file), 'utf8');
      if (!conformant) {
        // Allowlist honesty: a file carrying ALL markers no longer belongs on
        // the allowlist — remove it (the ratchet only tightens). This stops
        // the list rotting into "conformant but still exempted".
        const carriesAll = REQUIRED_MARKERS.every((m) => m.pattern.test(src));
        expect(
          carriesAll,
          `${file} appears conformant — remove it from NOT_YET_CONFORMANT`,
        ).toBe(false);
        return;
      }
      for (const m of REQUIRED_MARKERS) {
        expect(src, `${file} missing ${m.name}`).toMatch(m.pattern);
      }
      expect(src, `${file} missing tell-ban block`).toMatch(TELL_BAN_MARKER);
    });
  }

  it('allowlist contains no files that no longer exist', () => {
    const files2 = new Set(readdirSync(PROMPTS_DIR));
    for (const f of NOT_YET_CONFORMANT) expect(files2.has(f), `stale allowlist entry ${f}`).toBe(true);
  });
});
