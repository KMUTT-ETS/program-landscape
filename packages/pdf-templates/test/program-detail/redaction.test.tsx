import { describe, expect, it } from 'vitest';

import { programDetailTemplate } from '../../src/templates/program-detail/template';
import {
  ProgramDetailDataSchema,
  type ProgramDetailData,
} from '../../src/templates/program-detail/schema';
import FIXTURE from './fixture.json';

// Task 8 — the whole-template redaction test.
//
// How this differs from `faculty.test.tsx`'s "never prints a faculty
// member name" case: that test is narrow — it renders ONLY
// `renderFacultySection` in isolation and proves that one component's code
// path never reads `faculty.roster[].name`. This test is the integration
// backstop: it renders the ENTIRE document through the real
// `programDetailTemplate.render()` entry point — cover, all 17 body
// sections, the appendix, AND the header/footer page furniture (which
// Gotenberg renders as two separate HTML documents from the same
// `ProgramDetailData`, see `deep-dive-page-furniture.ts`) — so it also
// catches a leak introduced by a section that doesn't exist yet, by the
// appendix, or by the page furniture, none of which the narrow test can
// see. Do not delete either test as "redundant with the other"; they
// check different surfaces.
//
// The real COUNCIL-visibility shape: `programFaculty()` in
// `packages/db/src/program-deep-dive.ts` strips `nameEn`/`nameTh` at the
// Prisma `select` layer itself (`nameEn: visibility === 'full'`, etc.) —
// under `aggregates-only` the column is never selected by Postgres, so
// the value is unavailable at the source, not merely hidden later.
// `buildProgramDetailData` (apps/api/src/programs/program-detail-data.ts,
// see the `roster:` ternary) then maps that to `roster: []` whenever
// `faculty.visibility !== 'full'`. So the payload a COUNCIL user's PDF
// actually receives has **no name field populated at all** — there is
// nothing to redact because nothing arrived. We do not invent a "names
// present but marked hidden" shape; that shape does not exist.
//
// That means the honest assertion here is not "a name is present in the
// payload and gets redacted" but the stronger property the brief asks
// for: even if a name were somehow planted into `faculty.roster` on an
// aggregates-only payload — a defensive fixture, not a realistic one, see
// `PLANTED_NAME` below — no section, the appendix, or the page furniture
// ever prints it, anywhere: not in a text node, not in an SVG `<title>`
// tooltip, not in an attribute value.

const PLANTED_NAME = 'รองศาสตราจารย์ ดร. กิตติศักดิ์ องอาจสุขสันต์';
const PLANTED_SURNAME = 'องอาจสุขสันต์';

function buildCouncilPayload(plantRoster: boolean): ProgramDetailData {
  const base = FIXTURE as Record<string, unknown>;
  const facultyBase = base.faculty as Record<string, unknown>;
  return ProgramDetailDataSchema.parse({
    ...base,
    faculty: {
      ...facultyBase,
      // programFaculty() computes rank counts/shares from headcounts,
      // which stay visible under aggregates-only — only per-member
      // identity is gated. Keep the fixture's real rankDistribution /
      // seniorRankCount etc. as-is; only visibility + roster change.
      visibility: 'aggregates only (role-gated)',
      // Real shape: buildProgramDetailData emits `roster: []` whenever
      // visibility !== 'full'. `plantRoster` deliberately violates that
      // contract so this test proves the *render* layer is safe even if
      // the *data* layer's guarantee ever regresses — belt and braces.
      roster: plantRoster
        ? [{ rank: 'Associate Professor', name: PLANTED_NAME, specialization: '', retires: '' }]
        : [],
    },
  });
}

// Concatenates every surface Gotenberg actually receives: the main
// document, the two page-furniture documents (rendered separately by
// Chromium per `deep-dive-page-furniture.ts`), and the stylesheet (which
// should never carry data at all, but checking costs nothing).
function fullOutput(data: ProgramDetailData): string {
  const { html, headerHtml, footerHtml, css } = programDetailTemplate.render(data);
  return [html, headerHtml, footerHtml, css].join('\n');
}

describe('program-detail template — COUNCIL faculty redaction (whole template)', () => {
  it('renders the real COUNCIL-shaped payload (empty roster) without throwing', () => {
    const data = buildCouncilPayload(false);
    expect(() => fullOutput(data)).not.toThrow();
    // The real shape has nothing to leak — no roster entries at all.
    expect(data.faculty?.roster).toEqual([]);
  });

  it('never renders a faculty member name anywhere in the document, header, or footer', () => {
    const data = buildCouncilPayload(true);
    const output = fullOutput(data);
    expect(output).not.toContain(PLANTED_NAME);
    // Also check the distinctive surname alone, in case a section were to
    // ever split or truncate the full name rather than dropping it whole.
    expect(output).not.toContain(PLANTED_SURNAME);
  });

  it('never renders a faculty member name inside an SVG <text> or <title> element', () => {
    const data = buildCouncilPayload(true);
    const { html } = programDetailTemplate.render(data);
    const textAndTitleContents = [...html.matchAll(/<(?:text|title)[^>]*>([^<]*)</g)].map(
      (m) => m[1],
    );
    expect(textAndTitleContents.length).toBeGreaterThan(0); // sanity: charts DO emit these elements
    for (const content of textAndTitleContents) {
      expect(content).not.toContain(PLANTED_NAME);
      expect(content).not.toContain(PLANTED_SURNAME);
    }
  });

  it('never renders a faculty member name inside any HTML attribute value', () => {
    const data = buildCouncilPayload(true);
    const { html, headerHtml, footerHtml } = programDetailTemplate.render(data);
    for (const doc of [html, headerHtml, footerHtml]) {
      const attributeValues = [...doc.matchAll(/="([^"]*)"/g)].map((m) => m[1]);
      for (const value of attributeValues) {
        expect(value).not.toContain(PLANTED_NAME);
        expect(value).not.toContain(PLANTED_SURNAME);
      }
    }
  });
});
