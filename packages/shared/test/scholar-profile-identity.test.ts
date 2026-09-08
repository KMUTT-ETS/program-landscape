// packages/shared/test/scholar-profile-identity.test.ts
//
// The display-name path is exercised against the real ScrapingBee captures.
// The "other names" path cannot be — neither capture emits that block (the
// captured profile has no aliases), so those cases use markup derived from
// the stylesheet that IS in the captures, and are labelled as such. See the
// module header in src/scholar/profile-identity.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScholarProfileIdentity } from '../src/scholar/profile-identity';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'scholar');
const read = (name: string) => readFileSync(join(FIXTURES_DIR, name), 'utf-8');

const profilePage1 = read('profile-hinton.html');
const profilePage2 = read('profile-hinton-page2.html');
const signinWall = read('author-search-blocked-signin-wall.html');

describe('parseScholarProfileIdentity — real captures', () => {
  it('reads the displayed name off page 1', () => {
    expect(parseScholarProfileIdentity(profilePage1).displayName).toBe('Geoffrey Hinton');
  });

  it('reads the same name off a deep page, so verification works on any page', () => {
    expect(parseScholarProfileIdentity(profilePage2).displayName).toBe('Geoffrey Hinton');
  });

  it('reports no aliases for a profile that lists none', () => {
    expect(parseScholarProfileIdentity(profilePage1).otherNames).toEqual([]);
  });

  it('is not fooled by the stylesheet, which mentions every one of these ids', () => {
    // #gsc_prf_in, #gsc_prf_ion and #gs_prf_ion_txt all appear in the page's
    // inline CSS. A looser regex would happily return a chunk of stylesheet
    // as somebody's name.
    const identity = parseScholarProfileIdentity(profilePage1);
    expect(identity.displayName).not.toMatch(/font-size|padding|\{/);
  });
});

describe('parseScholarProfileIdentity — non-profile pages', () => {
  it('returns null for the sign-in wall rather than inventing a name', () => {
    expect(parseScholarProfileIdentity(signinWall).displayName).toBeNull();
  });

  it('returns null for empty input and for markup with no profile header', () => {
    expect(parseScholarProfileIdentity('')).toEqual({ displayName: null, otherNames: [] });
    expect(parseScholarProfileIdentity('<html><body>nothing here</body></html>')).toEqual({
      displayName: null,
      otherNames: [],
    });
  });
});

describe('parseScholarProfileIdentity — aliases (markup inferred from the captured CSS)', () => {
  it('reads a comma-separated alias list out of #gs_prf_ion_txt', () => {
    const html =
      '<div id="gsc_prf_in">Somchai Jaidee</div>' +
      '<div class="gsc_prf_il" id="gsc_prf_ion"><span id="gsc_prf_ion_lbl">Other names</span>' +
      '<span id="gs_prf_ion_txt">S. Jaidee, Somchai Jai-dee</span></div>';
    expect(parseScholarProfileIdentity(html)).toEqual({
      displayName: 'Somchai Jaidee',
      otherNames: ['S. Jaidee', 'Somchai Jai-dee'],
    });
  });

  it('decodes entities in both the name and the aliases', () => {
    const html =
      '<div id="gsc_prf_in">Ren&#233;e O&#39;Brien</div>' +
      '<span id="gs_prf_ion_txt">R. O&amp;#39;Brien</span>';
    const identity = parseScholarProfileIdentity(html);
    expect(identity.displayName).toBe("Renée O'Brien");
    expect(identity.otherNames.length).toBe(1);
  });

  it('drops the "Other names" caption so it is never read as a name', () => {
    const html =
      '<div id="gsc_prf_in">Somchai Jaidee</div>' +
      '<div id="gsc_prf_ion"><span id="gsc_prf_ion_lbl">Other names</span>Somchai Jai-dee</div>';
    expect(parseScholarProfileIdentity(html).otherNames).toEqual(['Somchai Jai-dee']);
  });
});
