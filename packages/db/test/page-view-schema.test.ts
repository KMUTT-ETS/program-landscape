// packages/db/test/page-view-schema.test.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The daily roll-up is what survives past 120 days. It must never grow a
// timestamp or an IP column — that would turn a count back into a browsing
// record. This reads schema.prisma so the guard holds without a DB.

const schema = readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
const model = (name: string) => {
  const m = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${name} not found`);
  return m[1]!;
};

describe('PageViewDaily', () => {
  it('exists and maps to page_view_daily', () => {
    expect(model('PageViewDaily')).toContain('@@map("page_view_daily")');
  });
  it('has exactly one DateTime column — the DATE-typed day', () => {
    const body = model('PageViewDaily');
    expect((body.match(/DateTime/g) ?? []).length).toBe(1);
    expect(body).toMatch(/day\s+DateTime\s+@db\.Date/);
  });
  it('has exactly the counts-only column set', () => {
    const fields = model('PageViewDaily')
      .split('\n')
      .map(
        (l) => l.trim().match(/^([a-zA-Z][a-zA-Z0-9]*)\s+(String|Int|Boolean|DateTime|Float)/)?.[1],
      )
      .filter((f): f is string => Boolean(f));
    expect(fields.sort()).toEqual(
      [
        'day',
        'facultyId',
        'id',
        'module',
        'path',
        'programId',
        'role',
        'sessions',
        'signins',
        'userId',
        'viewerFacultyId',
        'views',
      ].sort(),
    );
  });
});

describe('PageView', () => {
  it('has no IP column and no raw URL column', () => {
    const body = model('PageView');
    expect(body).not.toMatch(
      /ipAddress|ip_address|remoteAddr|clientIp|userAgent|referrer|rawUrl|queryString|url\s/i,
    );
    expect(body).toContain('@@map("page_views")');
  });
});
