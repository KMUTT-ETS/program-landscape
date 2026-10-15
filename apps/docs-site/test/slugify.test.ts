import { describe, expect, it } from 'vitest';
import { githubSlugify } from '../src/slugify';

// Expected values are the anchors the repo's own docs link to (GitHub-rendered headings).
describe('githubSlugify', () => {
  it('matches the adopter guide table-of-contents anchors', () => {
    expect(githubSlugify('9. The connector contract, and how to write one')).toBe(
      '9-the-connector-contract-and-how-to-write-one',
    );
    expect(githubSlugify('14. Traps that will cost you days')).toBe('14-traps-that-will-cost-you-days');
    expect(githubSlugify('21. Appendix — documentation map')).toBe('21-appendix--documentation-map');
    expect(githubSlugify('2. Licence — CC BY-NC-SA 4.0')).toBe('2-licence--cc-by-nc-sa-40');
  });

  it('drops punctuation but keeps underscores, hyphens and non-Latin letters', () => {
    expect(githubSlugify('Trap 2: `realDataWhere()` — empty sections')).toBe(
      'trap-2-realdatawhere--empty-sections',
    );
    expect(githubSlugify('Fork, don’t diverge')).toBe('fork-dont-diverge');
    expect(githubSlugify('snake_case and kebab-case')).toBe('snake_case-and-kebab-case');
    expect(githubSlugify('สรุป ภาษาไทย')).toBe('สรุป-ภาษาไทย');
  });
});
