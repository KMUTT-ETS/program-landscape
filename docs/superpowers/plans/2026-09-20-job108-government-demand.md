# Government job announcements as a second demand source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Thai government recruitment announcements from `job-108.com` as a second, public-sector demand source behind `/gap-analysis`, so a field KKU under-supplies purely to the state can earn a real verdict.

**Architecture:** A weekly fetch-based connector discovers announcements from `sitemap.xml`, extracts one row per position-type with an AI prompt, and writes `JobPosting` rows with `source = 'job-108'`. The gap map gains a `demandBasis` parameter (`all` | `private` | `public`, default `all`) that selects which sources form the demand denominator; the supply side and `verdictFor()` are untouched. Both sources share one field taxonomy.

**Tech Stack:** TypeScript strict, NestJS (api), standalone NestJS (ingestion), Prisma/PostgreSQL 16, BullMQ, Zod, Vitest, Next.js 14 App Router.

**Spec:** `docs/superpowers/specs/2026-09-20-job108-government-demand-design.md`

---

## Before you start

Read the spec. Then read these three, which the plan assumes you know:

- `packages/db/src/gap-map.ts` — the map. Note the four `jp.source = 'jobthai'` predicates at lines ~268, ~288, ~298, ~345.
- `packages/db/src/job-fields.ts` — the taxonomy build. Three more at lines ~57, ~227, and the run anchor at ~509.
- `packages/shared/src/jobthai/parse-row.ts` — the private-side extractor, `scrubPostingText()` and `JOBTHAI_ANY_FIELD` in particular.

**Environment notes that will otherwise cost you an hour each:**

- `nest start --watch` only watches `apps/api/src`. After **any** change under `packages/`, restart api and ingestion or you are testing stale code. Check `ps -o lstart= -p <pid>` against your commit time before debugging anything.
- Run `npx prisma` from `packages/db`, never the repo root — the root resolves a global Prisma 7 that rejects this schema. Or use `packages/db/node_modules/.bin/prisma`.
- `pnpm check` exits non-zero at the lint step on a pre-existing 171-error backlog. Run `pnpm -r typecheck` and `pnpm test` separately.
- Migrations are hand-written. Generate SQL with `prisma migrate diff --from-schema-datasource --to-schema-datamodel`, never `--from-migrations` (it resets whatever `--shadow-database-url` points at; that emptied the dev database on 2026-09-08).
- An `Edit` once wrote a literal NUL byte into a template literal and both typecheck and the full suite passed with it present. Run `grep -cP '\x00' <file>` on any file you edit before committing.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `packages/shared/src/demand/sources.ts` | The demand-basis vocabulary. One place that knows which source slugs are private and which public. |
| `packages/shared/src/job108/sitemap.ts` | Parse `sitemap.xml` into dated announcement entries. Pure. |
| `packages/shared/src/job108/html-text.ts` | Reduce an announcement page to plain text. Pure. |
| `packages/shared/src/job108/index.ts` | Barrel. |
| `packages/shared/src/ai/prompts/job108-announcement.ts` | Prompt `job108-announcement.v1`, Zod schema, message builder. Pure. |
| `packages/db/src/job108.ts` | Persistence: upsert an announcement and its positions, list what needs refetching. |
| `apps/ingestion/src/job108/fetch.ts` | HTTP with the identifying UA, 2 s spacing, conditional refetch. |
| `apps/ingestion/src/job108/extract.ts` | One announcement → validated positions, via the AI service. |
| `apps/ingestion/src/connectors/sources/job-108/connector.ts` | `Connector` implementation. |
| `apps/ingestion/src/scripts/job108-backfill.ts` | One-off backfill over the sitemap. |
| `apps/ingestion/src/scripts/job108-calibrate.ts` | AI-vs-regex calibration on JobThai text. |
| `docs/data-sources/job-108.md` | Source spec and session log. |

**Modified files**

| Path | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | `JobPosting` +2 columns; new `Job108Announcement` model + status enum. |
| `packages/shared/src/ingestion/catalog.ts` | `job-108` entry, weekly cadence. |
| `packages/db/src/job-fields.ts` | De-hardcode three source predicates and the run anchor. |
| `packages/db/src/gap-map.ts` | Demand basis, both shares, public reconciliation counts. |
| `packages/db/src/gap-map-rules.ts` | `DemandBasisSchema`, `parseDemandBasis`. |
| `apps/api/src/gap/gap.service.ts` | `GapMapArgs` +2 fields; cache key. |
| `apps/api/src/gap/gap.controller.ts` | Query schema, `mapMeta` parameters and caveats. |
| `apps/web/app/gap-analysis/*` | Basis control, both shares, government evidence block, source marks. |
| `apps/web/app/admin/job-fields/*` | Per-synonym source attribution. |
| `docs/methodologies/gap-map.md` | New section on the two bases; calibration result. |
| `apps/web/app/changelog/page.tsx` | Release entry. |

---

### Task 1: Demand-source vocabulary

One module decides what "private" and "public" mean. Everything downstream imports it, so adding a third source later is one edit.

**Files:**
- Create: `packages/shared/src/demand/sources.ts`
- Create: `packages/shared/test/demand/sources.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/demand/sources.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEMAND_BASIS,
  DEFAULT_PUBLIC_WINDOW_MONTHS,
  DEMAND_BASES,
  PRIVATE_DEMAND_SOURCE,
  PUBLIC_DEMAND_SOURCE,
  demandSourcesFor,
} from '../../src/demand/sources';

describe('demand sources', () => {
  it('defaults to the blended basis', () => {
    expect(DEFAULT_DEMAND_BASIS).toBe('all');
    expect(DEFAULT_PUBLIC_WINDOW_MONTHS).toBe(12);
  });

  it('maps each basis to its source slugs', () => {
    expect(demandSourcesFor('private')).toEqual([PRIVATE_DEMAND_SOURCE]);
    expect(demandSourcesFor('public')).toEqual([PUBLIC_DEMAND_SOURCE]);
    expect(demandSourcesFor('all')).toEqual([PRIVATE_DEMAND_SOURCE, PUBLIC_DEMAND_SOURCE]);
  });

  it('never returns an empty source list', () => {
    for (const basis of DEMAND_BASES) expect(demandSourcesFor(basis).length).toBeGreaterThan(0);
  });

  it('only the public basis is windowed', () => {
    expect(demandSourcesFor('private')).not.toContain(PUBLIC_DEMAND_SOURCE);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/shared vitest run test/demand/sources.test.ts`
Expected: FAIL — `Cannot find module '../../src/demand/sources'`.

- [ ] **Step 3: Write the module**

```ts
// packages/shared/src/demand/sources.ts

/** The private-sector board. Hand-delivered XLSX drops; see docs/data-sources/jobthai.md. */
export const PRIVATE_DEMAND_SOURCE = 'jobthai';

/** Thai government and state-enterprise announcements; see docs/data-sources/job-108.md. */
export const PUBLIC_DEMAND_SOURCE = 'job-108';

export const DEMAND_BASES = ['all', 'private', 'public'] as const;
export type DemandBasis = (typeof DEMAND_BASES)[number];

/**
 * `all` is the default because excluding the state biases the map against
 * exactly the nursing, public-health, teaching and agriculture programmes a
 * regional university exists to feed. See the spec, §8.
 */
export const DEFAULT_DEMAND_BASIS: DemandBasis = 'all';

/**
 * How far back public announcements count. JobThai's own window is
 * undocumented and underivable — the 2026-09 drop has no date column — so no
 * value here achieves true comparability. It is a visible parameter rather
 * than a constant precisely so it can be argued with.
 */
export const DEFAULT_PUBLIC_WINDOW_MONTHS = 12;

const SOURCES_BY_BASIS: Record<DemandBasis, readonly string[]> = {
  all: [PRIVATE_DEMAND_SOURCE, PUBLIC_DEMAND_SOURCE],
  private: [PRIVATE_DEMAND_SOURCE],
  public: [PUBLIC_DEMAND_SOURCE],
};

/** Source slugs whose postings form the demand denominator under `basis`. */
export function demandSourcesFor(basis: DemandBasis): string[] {
  return [...SOURCES_BY_BASIS[basis]];
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/shared/src/index.ts`, beside the other subpath exports:

```ts
export * from './demand/sources';
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @kku/shared vitest run test/demand/sources.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/demand/sources.ts packages/shared/test/demand/sources.test.ts packages/shared/src/index.ts
git commit -F - <<'EOF'
feat(demand): name the two demand bases in one place

The gap map is about to read two sources instead of one. Which slugs count
as private and which as public belongs in a single module rather than in
seven hardcoded SQL predicates, so a third source later is one edit.

`all` is the default: excluding the state biases the map against exactly the
programmes a regional university exists to feed.
EOF
```

---

### Task 2: Schema — seats, closing date, and the announcement table

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260920120000_job108_public_sector/migration.sql`

- [ ] **Step 1: Add the two `JobPosting` columns**

In `packages/db/prisma/schema.prisma`, inside `model JobPosting`, directly after the `postedDateEstimated` field:

```prisma
  /// Seats offered for this position-type (`จำนวน N ตำแหน่ง` / `อัตรา`).
  /// STORED AND DISPLAYED, NEVER WEIGHTED into a demand share: JobThai
  /// carries no headcount column, so weighting public seats against private
  /// adverts of unknown size would over-weight the public side by an
  /// unknowable factor. Null on every JobThai row.
  positionCount       Int?                   @map("position_count")
  /// Application closing date, where the announcement states one. Public
  /// rows only. Lets the counting window be re-cut without refetching.
  applicationCloseDate DateTime?             @map("application_close_date") @db.Date
```

Add the announcement relation beside `jobThaiBatch`:

```prisma
  job108AnnouncementId String?            @map("job108_announcement_id")
  job108Announcement   Job108Announcement? @relation(fields: [job108AnnouncementId], references: [id], onDelete: Cascade)
```

And an index beside the others:

```prisma
  @@index([job108AnnouncementId])
```

- [ ] **Step 2: Add the announcement model and its status enum**

Immediately after `model JobThaiBatch { … }`:

```prisma
enum Job108AnnouncementStatus {
  PENDING
  EXTRACTED
  FAILED
}

/// One government recruitment announcement page from job-108.com. The fetch
/// unit and the dedupe unit, mirroring JobThaiBatch so re-extraction and
/// failure triage work the same way.
///
/// An announcement bundles several position-types, each with its own field
/// list and seat count, so one row here fans out to several JobPosting rows.
model Job108Announcement {
  id             String                   @id @default(cuid())
  /// The site's own id, e.g. `id20256`. Stable across refetches.
  announcementId String                   @unique @map("announcement_id")
  url            String
  /// SHA-256 of the fetched bytes. Refetching identical bytes is a no-op,
  /// the PdfDocument and JobThaiBatch dedupe pattern.
  contentHash    String                   @unique @map("content_hash")
  title          String
  agencyName     String?                  @map("agency_name")
  publishedDate  DateTime?                @map("published_date") @db.Date
  applicationOpenDate  DateTime?          @map("application_open_date") @db.Date
  applicationCloseDate DateTime?          @map("application_close_date") @db.Date
  /// Sitemap `lastmod` at the time we fetched. An entry no newer than this
  /// is never refetched.
  sourceLastmod  DateTime?                @map("source_lastmod") @db.Date
  fetchedAt      DateTime                 @default(now()) @map("fetched_at")
  status         Job108AnnouncementStatus @default(PENDING)
  parseError     String?                  @map("parse_error") @db.Text
  ingestionRunId String?                  @map("ingestion_run_id")
  createdAt      DateTime                 @default(now()) @map("created_at")
  updatedAt      DateTime                 @updatedAt @map("updated_at")

  ingestionRun IngestionRun? @relation(fields: [ingestionRunId], references: [id], onDelete: SetNull)
  postings     JobPosting[]

  @@index([status])
  @@index([ingestionRunId])
  @@map("job108_announcements")
}
```

Add the back-relation on `IngestionRun` beside its other collections:

```prisma
  job108Announcements Job108Announcement[]
```

- [ ] **Step 3: Generate the migration SQL**

```bash
cd packages/db
./node_modules/.bin/prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/job108.sql
mkdir -p prisma/migrations/20260920120000_job108_public_sector
mv /tmp/job108.sql prisma/migrations/20260920120000_job108_public_sector/migration.sql
```

Open the file and delete the Prisma update banner comment if one is present. Read the SQL and confirm every statement is `CREATE` or `ALTER TABLE … ADD`. If you see any statement that removes a column, table or type, **stop** — the diff was generated against the wrong direction.

- [ ] **Step 4: Apply and verify**

```bash
cd packages/db && ./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma generate
```

Expected: `1 migration found`, applied, then `Generated Prisma Client`.

- [ ] **Step 5: Verify the columns landed**

```bash
cd /home/denpong/projects/program-landscape && docker compose exec -T postgres \
  psql -U postgres -d program_landscape -c "\d job_postings" | grep -E 'position_count|application_close_date|job108'
```

Expected: three rows printed.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260920120000_job108_public_sector
git commit -F - <<'EOF'
feat(db): seats, closing date and the government announcement table

Additive only. `position_count` records seats so the quantity the share
deliberately sets aside is visible rather than lost; `application_close_date`
lets the counting window be re-cut without refetching 2,000 pages.

Job108Announcement is the fetch and dedupe unit. One announcement fans out to
several JobPosting rows because each position-type carries its own field list
and seat count.
EOF
```

---

### Task 3: Catalog entry

**Files:**
- Modify: `packages/shared/src/ingestion/catalog.ts`
- Modify: `packages/shared/test/ingestion/jobthai-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/test/ingestion/jobthai-catalog.test.ts`:

```ts
describe('job-108 catalog entry', () => {
  const entry = SOURCE_CATALOG.find((s) => s.slug === 'job-108');

  it('exists and is scheduled weekly', () => {
    expect(entry).toBeDefined();
    expect(entry?.scheduleEnabled).toBe(true);
    expect(entry?.cadenceCron).toBe('0 3 * * 1');
  });

  it('is a scraped HTML source and is not deprecated', () => {
    expect(entry?.kind).toBe('SCRAPE');
    expect(entry?.inputFormat).toBe('HTML');
    expect(entry?.deprecated).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/shared vitest run test/ingestion/jobthai-catalog.test.ts`
Expected: FAIL — `expected undefined to be defined`.

- [ ] **Step 3: Add the entry**

In `packages/shared/src/ingestion/catalog.ts`, directly after the `jobthai` entry:

```ts
  {
    slug: 'job-108',
    name: 'Job-108 (Thai government job announcements)',
    kind: 'SCRAPE',
    inputFormat: 'HTML',
    // Weekly, Mondays 03:00. The site publishes ~96 announcements a month
    // (1,339 over the 14 months to 2026-09), so a weekly run finds ~22 and
    // the sitemap's lastmod keeps us from refetching the rest.
    scheduleEnabled: true,
    cadenceCron: '0 3 * * 1',
    ownerContact: 'KKU Data Office',
    notes:
      'Thai government and state-enterprise recruitment announcements. Public-sector ' +
      'counterpart to jobthai, which is a private-sector board. Each announcement states, ' +
      'per position, seats, education level and an explicit field-of-study list. Fetched ' +
      'directly with an identifying KKU user-agent — no scraping proxy; robots.txt ' +
      'disallows four AI crawlers by name and permits the wildcard everywhere but ' +
      '/go.php and /url.php, which this connector never touches.',
  },
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @kku/shared vitest run test/ingestion/jobthai-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Seed the DataSource row**

```bash
pnpm db:seed
```

Then confirm it landed with `mocked = false`, because a `mocked` source is invisible to `realDataWhere()` and every row this connector writes would silently vanish from the map:

```bash
docker compose exec -T postgres psql -U postgres -d program_landscape \
  -c "SELECT slug, status, mocked, schedule_enabled, cadence_cron FROM data_sources WHERE slug = 'job-108';"
```

Expected: one row, `status = real`, `mocked = f`, `schedule_enabled = t`. If `mocked` is `t`, fix the seed — `status` and `mocked` must flip together; a drift between them is a documented recurring trap.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ingestion/catalog.ts packages/shared/test/ingestion/jobthai-catalog.test.ts
git commit -F - <<'EOF'
feat(ingestion): register job-108 as a weekly scraped source

Weekly cadence needs no new infrastructure: IngestionScheduler reads
cadenceCron from the DataSource row at boot and registers a BullMQ repeatable
job, exactly as the other sources work. Cadence edits take effect on the next
ingestion bounce, not immediately — existing behaviour, noted so nobody
debugs it as a fault.
EOF
```

---

### Task 4: Sitemap and page-text parsing

Two pure functions with fixtures. No network, no database.

**Files:**
- Create: `packages/shared/src/job108/sitemap.ts`
- Create: `packages/shared/src/job108/html-text.ts`
- Create: `packages/shared/src/job108/index.ts`
- Create: `packages/shared/test/job108/sitemap.test.ts`
- Create: `packages/shared/test/fixtures/job108/sitemap-sample.xml`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Save the fixture**

Create `packages/shared/test/fixtures/job108/sitemap-sample.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>https://www.job-108.com/</loc>
        <lastmod>2026-09-19</lastmod>
    </url>
    <url>
        <loc>https://www.job-108.com/jobs-cats2.html</loc>
        <lastmod>2026-09-17</lastmod>
    </url>
    <url>
        <loc>https://www.job-108.com/id20256.html</loc>
        <lastmod>2026-09-09</lastmod>
    </url>
    <url>
        <loc>https://www.job-108.com/id20285.html</loc>
        <lastmod>2026-09-18</lastmod>
    </url>
    <url>
        <loc>https://www.job-108.com/id18228.html</loc>
        <lastmod>2024-12-18</lastmod>
    </url>
</urlset>
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/shared/test/job108/sitemap.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { htmlToText, parseSitemap } from '../../src/job108';

const xml = readFileSync(join(__dirname, '../fixtures/job108/sitemap-sample.xml'), 'utf8');

describe('parseSitemap', () => {
  it('keeps only announcement pages', () => {
    const entries = parseSitemap(xml);
    expect(entries.map((e) => e.announcementId)).toEqual(['id20285', 'id20256', 'id18228']);
  });

  it('carries the url and lastmod', () => {
    const [newest] = parseSitemap(xml);
    expect(newest?.url).toBe('https://www.job-108.com/id20285.html');
    expect(newest?.lastmod.toISOString().slice(0, 10)).toBe('2026-09-18');
  });

  it('sorts newest first so a capped run takes the freshest', () => {
    const dates = parseSitemap(xml).map((e) => e.lastmod.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('returns an empty list rather than throwing on junk', () => {
    expect(parseSitemap('<html>404</html>')).toEqual([]);
  });
});

describe('htmlToText', () => {
  it('drops scripts, styles and tags and unescapes entities', () => {
    const html = '<html><head><style>a{}</style><script>var x=1</script></head>' +
      '<body><h1>ประกาศ</h1><p>&nbsp;จำนวน 3 &lt;ตำแหน่ง&gt;</p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('ประกาศ');
    expect(text).toContain('จำนวน 3 <ตำแหน่ง>');
    expect(text).not.toContain('var x');
    expect(text).not.toContain('a{}');
  });

  it('collapses runs of whitespace', () => {
    expect(htmlToText('<p>a</p>\n\n\n<p>b</p>')).toBe('a\nb');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @kku/shared vitest run test/job108/sitemap.test.ts`
Expected: FAIL — `Cannot find module '../../src/job108'`.

- [ ] **Step 4: Write `sitemap.ts`**

```ts
// packages/shared/src/job108/sitemap.ts

export interface SitemapEntry {
  /** The site's own id, e.g. `id20256`. */
  announcementId: string;
  url: string;
  lastmod: Date;
}

const URL_BLOCK = /<url>([\s\S]*?)<\/url>/g;
const LOC = /<loc>\s*([^<]+?)\s*<\/loc>/;
const LASTMOD = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/;
const ANNOUNCEMENT = /\/(id\d+)\.html$/;

/**
 * Announcement pages from the sitemap, newest first.
 *
 * The sitemap is the discovery surface rather than `now.html`: it is the
 * complete dated list (2,000 entries reaching back to 2024-12-18), whereas
 * `now.html` is a 30-item slice of currently-open posts. A malformed or
 * error body yields an empty list rather than an exception — an unreachable
 * sitemap is the connector's problem to report, not this function's.
 */
export function parseSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const [, block] of xml.matchAll(URL_BLOCK)) {
    const loc = block?.match(LOC)?.[1];
    const lastmodRaw = block?.match(LASTMOD)?.[1];
    if (!loc || !lastmodRaw) continue;
    const id = loc.match(ANNOUNCEMENT)?.[1];
    if (!id) continue;
    const lastmod = new Date(`${lastmodRaw}T00:00:00Z`);
    if (Number.isNaN(lastmod.getTime())) continue;
    out.push({ announcementId: id, url: loc, lastmod });
  }
  return out.sort((a, b) => b.lastmod.getTime() - a.lastmod.getTime());
}
```

- [ ] **Step 5: Write `html-text.ts`**

```ts
// packages/shared/src/job108/html-text.ts

const DROP_ELEMENTS = /<(script|style|noscript)[\s\S]*?<\/\1>/gi;
const TAGS = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/**
 * An announcement page reduced to plain text for the extractor.
 *
 * Deliberately crude: the pages are prose inside a conventional template and
 * the model reads the text, not the markup. Numeric entities are decoded
 * because Thai text in these pages sometimes arrives that way.
 */
export function htmlToText(html: string): string {
  let out = html.replace(DROP_ELEMENTS, ' ').replace(TAGS, ' ');
  for (const [entity, char] of Object.entries(ENTITIES)) out = out.replaceAll(entity, char);
  out = out.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
  return out
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
```

- [ ] **Step 6: Write the barrel and export it**

```ts
// packages/shared/src/job108/index.ts
export * from './sitemap';
export * from './html-text';
```

Add to `packages/shared/src/index.ts`:

```ts
export * from './job108';
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @kku/shared vitest run test/job108/sitemap.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/job108 packages/shared/test/job108 packages/shared/test/fixtures/job108 packages/shared/src/index.ts
git commit -F - <<'EOF'
feat(job108): parse the sitemap and reduce a page to text

Discovery is the sitemap, not now.html: the sitemap is the complete dated
list of 2,000 announcements reaching back to 2024-12-18, where now.html shows
only the ~30 currently open. Entries come back newest first so a capped run
takes the freshest.

Junk yields an empty list rather than an exception — an unreachable sitemap
is the connector's failure to report, not the parser's.
EOF
```

---

### Task 5: The extraction prompt

**Files:**
- Create: `packages/shared/src/ai/prompts/job108-announcement.ts`
- Create: `packages/shared/test/ai/job108-announcement.test.ts`
- Modify: `packages/shared/src/ai/prompts/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/ai/job108-announcement.test.ts
import { describe, expect, it } from 'vitest';
import {
  JOB108_ANNOUNCEMENT_VERSION,
  Job108AnnouncementOutputSchema,
  buildJob108AnnouncementMessages,
} from '../../src/ai/prompts/job108-announcement';

const validPosition = {
  title: 'เจ้าหน้าที่บริหารงานทั่วไป',
  positionCount: 3,
  salaryMin: 15000,
  salaryMax: null,
  minEducationLevel: 'BACHELOR' as const,
  requiredFieldsRaw: ['รัฐศาสตร์', 'บริหารธุรกิจ'],
  qualificationRaw: 'วุฒิการศึกษา ปริญญาตรี ในสาขาวิชา รัฐศาสตร์ บริหารธุรกิจ',
};

describe('job108-announcement schema', () => {
  it('is versioned', () => {
    expect(JOB108_ANNOUNCEMENT_VERSION).toBe('job108-announcement.v1');
  });

  it('accepts a well-formed announcement', () => {
    const parsed = Job108AnnouncementOutputSchema.parse({
      agencyName: 'กรมการข้าว',
      publishedDate: '2026-09-09',
      applicationOpenDate: null,
      applicationCloseDate: '2026-09-30',
      positions: [validPosition],
      confidence: 0.9,
    });
    expect(parsed.positions[0]?.requiredFieldsRaw).toEqual(['รัฐศาสตร์', 'บริหารธุรกิจ']);
  });

  it('accepts an announcement with no positions, which is a real outcome', () => {
    const parsed = Job108AnnouncementOutputSchema.parse({
      agencyName: null,
      publishedDate: null,
      applicationOpenDate: null,
      applicationCloseDate: null,
      positions: [],
      confidence: 0.2,
    });
    expect(parsed.positions).toEqual([]);
  });

  it('rejects an unknown education level rather than coercing it', () => {
    expect(() =>
      Job108AnnouncementOutputSchema.parse({
        agencyName: null,
        publishedDate: null,
        applicationOpenDate: null,
        applicationCloseDate: null,
        positions: [{ ...validPosition, minEducationLevel: 'DIPLOMA' }],
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it('rejects a negative seat count', () => {
    expect(() =>
      Job108AnnouncementOutputSchema.parse({
        agencyName: null,
        publishedDate: null,
        applicationOpenDate: null,
        applicationCloseDate: null,
        positions: [{ ...validPosition, positionCount: -1 }],
        confidence: 0.5,
      }),
    ).toThrow();
  });
});

describe('buildJob108AnnouncementMessages', () => {
  it('refuses empty text rather than paying for a call on nothing', () => {
    expect(() => buildJob108AnnouncementMessages({ announcementId: 'id1', text: '   ' })).toThrow();
  });

  it('instructs the model to take the LOWEST stated education level', () => {
    const [system] = buildJob108AnnouncementMessages({ announcementId: 'id1', text: 'ประกาศ' });
    expect(system?.content).toMatch(/lowest/i);
  });

  it('instructs the model to use the any-field sentinel', () => {
    const [system] = buildJob108AnnouncementMessages({ announcementId: 'id1', text: 'ประกาศ' });
    expect(system?.content).toContain('*ANY*');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/shared vitest run test/ai/job108-announcement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the prompt module**

```ts
// packages/shared/src/ai/prompts/job108-announcement.ts
import { z } from 'zod';
import type { AiMessage } from '../types';
import { JOBTHAI_ANY_FIELD } from '../../jobthai/parse-row';

// ─────────────────────────────────────────────────────────────────────────────
// One government recruitment announcement → its position-types.
//
// An announcement bundles several positions, each with its own field-of-study
// list and seat count, so the output is an array. One row per position-type is
// the unit (spec §2): seats are captured but never weighted into a share,
// because JobThai carries no headcount column and weighting public seats
// against private adverts of unknown size over-weights the public side by an
// unknowable factor.
//
// Version-bumping rule: any change here = bump VERSION.
// ─────────────────────────────────────────────────────────────────────────────

export const JOB108_ANNOUNCEMENT_VERSION = 'job108-announcement.v1';

/** Announcements run long; 8k covers the largest observed with headroom. */
export const JOB108_ANNOUNCEMENT_MAX_OUTPUT_TOKENS = 8_000;

/** Page text beyond this is truncated before the call. Measured: the longest
 *  page sampled was ~50 KB of HTML reducing to ~12 KB of text. */
export const JOB108_ANNOUNCEMENT_MAX_INPUT_CHARS = 40_000;

const EDUCATION_LEVELS = [
  'UNSPECIFIED',
  'VOCATIONAL_CERT',
  'HIGHER_VOCATIONAL_CERT',
  'BACHELOR',
  'MASTER',
  'DOCTORATE',
] as const;

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const Job108PositionSchema = z.object({
  title: z.string().min(1).max(300),
  /** Null when the announcement does not state a number. Never invented. */
  positionCount: z.number().int().positive().nullable(),
  salaryMin: z.number().nonnegative().nullable(),
  salaryMax: z.number().nonnegative().nullable(),
  minEducationLevel: z.enum(EDUCATION_LEVELS),
  /** Raw Thai field strings exactly as written, or the any-field sentinel. */
  requiredFieldsRaw: z.array(z.string().min(1).max(120)).max(40),
  qualificationRaw: z.string().max(4_000),
});
export type Job108Position = z.infer<typeof Job108PositionSchema>;

export const Job108AnnouncementOutputSchema = z.object({
  agencyName: z.string().min(1).max(300).nullable(),
  publishedDate: IsoDate,
  applicationOpenDate: IsoDate,
  applicationCloseDate: IsoDate,
  /** Empty is a real outcome: some pages are news items, not vacancies. */
  positions: z.array(Job108PositionSchema).max(100),
  confidence: z.number().min(0).max(1),
});
export type Job108AnnouncementOutput = z.infer<typeof Job108AnnouncementOutputSchema>;

export interface Job108AnnouncementInput {
  announcementId: string;
  /** Page text, already scrubbed and reduced from HTML by the caller. */
  text: string;
}

export function buildJob108AnnouncementMessages(input: Job108AnnouncementInput): AiMessage[] {
  const text = input.text.trim();
  if (text === '') throw new Error(`Empty announcement text for ${input.announcementId}`);

  const system = `You read Thai government and state-enterprise recruitment announcements and return the positions they offer.

An announcement usually lists SEVERAL positions (ตำแหน่งที่ 1, 1.1, 1.2 …). Return one entry per position-type, never one per seat and never one per announcement.

For each position:
- title: the Thai position name, without its numbering.
- positionCount: the seats offered ("จำนวน 3 ตำแหน่ง", "3 อัตรา") as an integer. If the announcement does not state a number, return null. Never guess.
- salaryMin / salaryMax: monthly baht as numbers, null when unstated. A single figure goes in salaryMin with salaryMax null.
- minEducationLevel: the LOWEST level the position accepts, not the highest. "ปวช., ปวส. - ปริญญาตรี" means a ปวช holder qualifies, so the answer is VOCATIONAL_CERT. "ปริญญาตรี ขึ้นไป" is BACHELOR. Use UNSPECIFIED only when no level is stated at all.
- requiredFieldsRaw: the fields of study the position accepts, each exactly as written in Thai, as separate array entries. The list usually follows "ในสาขาวิชา" or "สาขา" and its members are separated by SPACES, commas, "และ" or "หรือ". Do not translate, do not normalise, do not merge. Drop trailing catch-alls like "หรือสาขาอื่นที่เกี่ยวข้อง" — they name no discipline. If the position accepts any field ("ทุกสาขา"), return exactly ["${JOBTHAI_ANY_FIELD}"] and nothing else.
- qualificationRaw: the verbatim qualification text for THAT position.

Announcement-level fields are returned once, not per position. Dates are ISO (YYYY-MM-DD); Thai Buddhist years are 543 ahead, so พ.ศ. 2569 is 2026. Return null for any date the announcement does not state.

If the page is not a recruitment announcement, return an empty positions array and a low confidence. An empty array is a valid answer; inventing a position is not.`;

  const user = `Announcement ${input.announcementId}:

${text.slice(0, JOB108_ANNOUNCEMENT_MAX_INPUT_CHARS)}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
```

- [ ] **Step 4: Export from the prompts barrel**

Add to `packages/shared/src/ai/prompts/index.ts`:

```ts
export * from './job108-announcement';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @kku/shared vitest run test/ai/job108-announcement.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ai/prompts/job108-announcement.ts packages/shared/test/ai/job108-announcement.test.ts packages/shared/src/ai/prompts/index.ts
git commit -F - <<'EOF'
feat(ai): job108-announcement.v1 extracts one row per position-type

The private-side regex is not reusable here. It takes the first
whitespace-delimited token because JobThai disciplines carry no spaces;
government announcements separate them WITH spaces, so on a real sample it
captures one field of eight and drops the rest.

The prompt carries the same two rules the private side already applies: the
education level is the LOWEST stated, because "ปวช. - ปริญญาตรี" means a ปวช
holder qualifies; and ทุกสาขา collapses to the shared any-field sentinel.

An empty positions array is a valid answer — some pages are news items.
Inventing a position is not.
EOF
```

---

### Task 6: Persistence

**Files:**
- Create: `packages/db/src/job108.ts`
- Create: `packages/db/test/job108.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

This tests the pure planner, not Prisma. The write itself is exercised end-to-end in Task 8.

```ts
// packages/db/test/job108.test.ts
import { describe, expect, it } from 'vitest';
import { planJob108Fetch, toPostingRows } from '../src/job108';

const entry = (id: string, lastmod: string) => ({
  announcementId: id,
  url: `https://www.job-108.com/${id}.html`,
  lastmod: new Date(`${lastmod}T00:00:00Z`),
});

describe('planJob108Fetch', () => {
  it('fetches an announcement we have never seen', () => {
    const plan = planJob108Fetch([entry('id1', '2026-09-01')], new Map());
    expect(plan.map((e) => e.announcementId)).toEqual(['id1']);
  });

  it('skips one whose lastmod is not newer than what we hold', () => {
    const held = new Map([['id1', new Date('2026-09-01T00:00:00Z')]]);
    expect(planJob108Fetch([entry('id1', '2026-09-01')], held)).toEqual([]);
  });

  it('refetches when the source says it changed', () => {
    const held = new Map([['id1', new Date('2026-09-01T00:00:00Z')]]);
    const plan = planJob108Fetch([entry('id1', '2026-09-05')], held);
    expect(plan.map((e) => e.announcementId)).toEqual(['id1']);
  });

  it('caps the batch, taking the newest', () => {
    const entries = [entry('id1', '2026-09-01'), entry('id2', '2026-09-09'), entry('id3', '2026-09-05')];
    const plan = planJob108Fetch(entries, new Map(), 2);
    expect(plan.map((e) => e.announcementId)).toEqual(['id2', 'id3']);
  });
});

describe('toPostingRows', () => {
  const base = {
    announcementId: 'id20256',
    agencyName: 'กรมการข้าว',
    publishedDate: new Date('2026-09-09T00:00:00Z'),
    applicationCloseDate: new Date('2026-09-30T00:00:00Z'),
  };

  it('gives each position a distinct external id', () => {
    const rows = toPostingRows(base, [
      { title: 'ก', positionCount: 1, salaryMin: null, salaryMax: null, minEducationLevel: 'BACHELOR', requiredFieldsRaw: ['รัฐศาสตร์'], qualificationRaw: 'x' },
      { title: 'ข', positionCount: 3, salaryMin: null, salaryMax: null, minEducationLevel: 'BACHELOR', requiredFieldsRaw: ['บัญชี'], qualificationRaw: 'y' },
    ]);
    expect(rows.map((r) => r.externalId)).toEqual(['id20256#1', 'id20256#2']);
  });

  it('marks the posted date as real, not estimated', () => {
    const [row] = toPostingRows(base, [
      { title: 'ก', positionCount: 1, salaryMin: null, salaryMax: null, minEducationLevel: 'BACHELOR', requiredFieldsRaw: ['รัฐศาสตร์'], qualificationRaw: 'x' },
    ]);
    expect(row?.postedDateEstimated).toBe(false);
    expect(row?.postedDate).toEqual(base.publishedDate);
  });

  it('carries seats through without weighting anything', () => {
    const rows = toPostingRows(base, [
      { title: 'ก', positionCount: 89, salaryMin: null, salaryMax: null, minEducationLevel: 'BACHELOR', requiredFieldsRaw: ['พยาบาล'], qualificationRaw: 'x' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.positionCount).toBe(89);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/db vitest run test/job108.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// packages/db/src/job108.ts
import { createHash } from 'node:crypto';

import type { Job108Position, SitemapEntry } from '@kku/shared';
import { PUBLIC_DEMAND_SOURCE } from '@kku/shared';

import { prisma } from './index';

export interface Job108PostingRow {
  externalId: string;
  title: string;
  employerName: string | null;
  postedDate: Date;
  postedDateEstimated: boolean;
  applicationCloseDate: Date | null;
  positionCount: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  minEducationLevel: Job108Position['minEducationLevel'];
  requiredFieldsRaw: string[];
  qualificationRaw: string;
  descriptionRaw: string;
}

export interface Job108AnnouncementHeader {
  announcementId: string;
  agencyName: string | null;
  publishedDate: Date | null;
  applicationCloseDate: Date | null;
}

/**
 * Which announcements to fetch this run.
 *
 * An entry whose sitemap `lastmod` is no newer than the one we already stored
 * is skipped, so a steady-state weekly run touches roughly 22 pages instead of
 * 2,000. `limit` caps a run and takes the newest, because a capped run should
 * make progress on the freshest announcements rather than an arbitrary slice.
 */
export function planJob108Fetch(
  entries: SitemapEntry[],
  heldLastmodById: Map<string, Date>,
  limit?: number,
): SitemapEntry[] {
  const due = entries.filter((e) => {
    const held = heldLastmodById.get(e.announcementId);
    return held === undefined || e.lastmod.getTime() > held.getTime();
  });
  const newestFirst = [...due].sort((a, b) => b.lastmod.getTime() - a.lastmod.getTime());
  return limit === undefined ? newestFirst : newestFirst.slice(0, limit);
}

/**
 * One row per position-type (spec §2). `positionCount` rides along as evidence
 * and is never multiplied out: an 89-seat announcement is one row.
 *
 * `postedDateEstimated` is FALSE here, unlike every JobThai row — government
 * announcements state their publication date, so the public side carries a
 * real one. When a page states none, the announcement's fetch date stands in
 * and the flag flips to true.
 */
export function toPostingRows(
  header: Job108AnnouncementHeader,
  positions: Job108Position[],
  fetchedAt: Date = new Date(),
): Job108PostingRow[] {
  const posted = header.publishedDate ?? fetchedAt;
  return positions.map((p, i) => ({
    externalId: `${header.announcementId}#${i + 1}`,
    title: p.title,
    employerName: header.agencyName,
    postedDate: posted,
    postedDateEstimated: header.publishedDate === null,
    applicationCloseDate: header.applicationCloseDate,
    positionCount: p.positionCount,
    salaryMin: p.salaryMin,
    salaryMax: p.salaryMax,
    minEducationLevel: p.minEducationLevel,
    requiredFieldsRaw: p.requiredFieldsRaw,
    qualificationRaw: p.qualificationRaw,
    descriptionRaw: p.qualificationRaw,
  }));
}

export function hashPage(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `announcementId → sourceLastmod` for everything already stored. */
export async function heldAnnouncementLastmods(): Promise<Map<string, Date>> {
  const rows = await prisma.job108Announcement.findMany({
    where: { status: 'EXTRACTED' },
    select: { announcementId: true, sourceLastmod: true },
  });
  return new Map(
    rows.flatMap((r) => (r.sourceLastmod === null ? [] : [[r.announcementId, r.sourceLastmod] as const])),
  );
}

/**
 * Replace an announcement and its positions in one transaction.
 *
 * Positions are deleted and rewritten rather than merged: the array index is
 * the external id, so a re-extraction that returns a different number of
 * positions would otherwise leave orphans claiming to be current. The
 * announcement row itself is preserved, so its history and any failure text
 * survive.
 *
 * Every row carries `ingestionRunId`. Omitting it is what has left rows
 * invisible to realDataWhere() three times in this repository.
 */
export async function upsertJob108Announcement(args: {
  announcementId: string;
  url: string;
  contentHash: string;
  title: string;
  header: Job108AnnouncementHeader;
  applicationOpenDate: Date | null;
  sourceLastmod: Date;
  rows: Job108PostingRow[];
  runId: string;
}): Promise<{ postingsWritten: number }> {
  return prisma.$transaction(async (tx) => {
    const announcement = await tx.job108Announcement.upsert({
      where: { announcementId: args.announcementId },
      create: {
        announcementId: args.announcementId,
        url: args.url,
        contentHash: args.contentHash,
        title: args.title,
        agencyName: args.header.agencyName,
        publishedDate: args.header.publishedDate,
        applicationOpenDate: args.applicationOpenDate,
        applicationCloseDate: args.header.applicationCloseDate,
        sourceLastmod: args.sourceLastmod,
        status: 'EXTRACTED',
        parseError: null,
        ingestionRunId: args.runId,
      },
      update: {
        url: args.url,
        contentHash: args.contentHash,
        title: args.title,
        agencyName: args.header.agencyName,
        publishedDate: args.header.publishedDate,
        applicationOpenDate: args.applicationOpenDate,
        applicationCloseDate: args.header.applicationCloseDate,
        sourceLastmod: args.sourceLastmod,
        fetchedAt: new Date(),
        status: 'EXTRACTED',
        parseError: null,
        ingestionRunId: args.runId,
      },
      select: { id: true },
    });

    await tx.jobPosting.deleteMany({ where: { job108AnnouncementId: announcement.id } });

    for (const row of args.rows) {
      await tx.jobPosting.create({
        data: {
          source: PUBLIC_DEMAND_SOURCE,
          externalId: row.externalId,
          title: row.title,
          employerName: row.employerName,
          postedDate: row.postedDate,
          postedDateEstimated: row.postedDateEstimated,
          freshnessDate: row.postedDate,
          applicationCloseDate: row.applicationCloseDate,
          positionCount: row.positionCount,
          salaryMin: row.salaryMin,
          salaryMax: row.salaryMax,
          minEducationLevel: row.minEducationLevel,
          requiredFieldsRaw: row.requiredFieldsRaw,
          qualificationRaw: row.qualificationRaw,
          descriptionRaw: row.descriptionRaw,
          job108AnnouncementId: announcement.id,
          ingestionRunId: args.runId,
        },
      });
    }

    return { postingsWritten: args.rows.length };
  });
}

/** Record a page we could not extract, without losing the reason. */
export async function recordJob108Failure(args: {
  announcementId: string;
  url: string;
  contentHash: string;
  sourceLastmod: Date;
  error: string;
  runId: string;
}): Promise<void> {
  await prisma.job108Announcement.upsert({
    where: { announcementId: args.announcementId },
    create: {
      announcementId: args.announcementId,
      url: args.url,
      contentHash: args.contentHash,
      title: args.announcementId,
      sourceLastmod: args.sourceLastmod,
      status: 'FAILED',
      parseError: args.error.slice(0, 2_000),
      ingestionRunId: args.runId,
    },
    update: {
      status: 'FAILED',
      parseError: args.error.slice(0, 2_000),
      fetchedAt: new Date(),
      ingestionRunId: args.runId,
    },
  });
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/db/src/index.ts`:

```ts
export * from './job108';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @kku/db vitest run test/job108.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/job108.ts packages/db/test/job108.test.ts packages/db/src/index.ts
git commit -F - <<'EOF'
feat(db): persist government announcements and their positions

planJob108Fetch skips an announcement whose sitemap lastmod is no newer than
the one stored, so a steady-state weekly run touches ~22 pages rather than
2,000; a capped run takes the newest rather than an arbitrary slice.

Positions are deleted and rewritten on re-extraction rather than merged: the
array index is the external id, so a re-extraction returning fewer positions
would otherwise leave orphans claiming to be current.

postedDateEstimated is false on this side — government announcements state
their publication date, where every JobThai row carries a batch receipt date.
EOF
```

---

### Task 7: The connector

**Files:**
- Create: `apps/ingestion/src/job108/fetch.ts`
- Create: `apps/ingestion/src/job108/extract.ts`
- Create: `apps/ingestion/src/connectors/sources/job-108/connector.ts`
- Create: `apps/ingestion/src/connectors/sources/job-108/index.ts`
- Create: `apps/ingestion/test/job108/extract.test.ts`
- Modify: `apps/ingestion/src/connectors/registry.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/ingestion/test/job108/extract.test.ts
import { describe, expect, it, vi } from 'vitest';
import { extractAnnouncement } from '../../src/job108/extract';

const okResponse = {
  parsed: {
    agencyName: 'กรมการข้าว',
    publishedDate: '2026-09-09',
    applicationOpenDate: null,
    applicationCloseDate: '2026-09-30',
    positions: [
      {
        title: 'เจ้าหน้าที่การเงิน',
        positionCount: 1,
        salaryMin: 30000,
        salaryMax: null,
        minEducationLevel: 'BACHELOR',
        requiredFieldsRaw: ['การบัญชี', 'บริหารธุรกิจ'],
        qualificationRaw: 'วุฒิการศึกษา ปริญญาตรี',
      },
    ],
    confidence: 0.9,
  },
};

describe('extractAnnouncement', () => {
  it('returns a header and rows from the model output', async () => {
    const ai = { extractStructured: vi.fn().mockResolvedValue(okResponse) };
    const result = await extractAnnouncement(ai as never, {
      announcementId: 'id20256',
      html: '<html><body>ประกาศ จำนวน 1 ตำแหน่ง</body></html>',
    });
    expect(result.header.agencyName).toBe('กรมการข้าว');
    expect(result.header.publishedDate?.toISOString().slice(0, 10)).toBe('2026-09-09');
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]?.requiredFieldsRaw).toEqual(['การบัญชี', 'บริหารธุรกิจ']);
  });

  it('scrubs gender, age and contact details before the model sees the text', async () => {
    const ai = { extractStructured: vi.fn().mockResolvedValue(okResponse) };
    await extractAnnouncement(ai as never, {
      announcementId: 'id1',
      html: '<p>เพศชาย อายุไม่เกิน 35 ปี ติดต่อ hr@example.com 081-234-5678</p>',
    });
    const sent = ai.extractStructured.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    const user = sent.messages[1]?.content ?? '';
    expect(user).not.toContain('hr@example.com');
    expect(user).not.toContain('081-234-5678');
    expect(user).not.toContain('เพศชาย');
  });

  it('stamps the prompt version so a bump is traceable', async () => {
    const ai = { extractStructured: vi.fn().mockResolvedValue(okResponse) };
    await extractAnnouncement(ai as never, { announcementId: 'id1', html: '<p>ประกาศ</p>' });
    const sent = ai.extractStructured.mock.calls[0]?.[0] as { methodVersion: string };
    expect(sent.methodVersion).toBe('job108-announcement.v1');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter ingestion vitest run test/job108/extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `fetch.ts`**

```ts
// apps/ingestion/src/job108/fetch.ts

/**
 * HTTP for job-108.com.
 *
 * No scraping proxy. The site returns 200 to any user-agent that is not
 * literally `curl/*`, so an honest identifying one is enough and costs
 * nothing. robots.txt disallows four AI crawlers by name and permits the
 * wildcard everywhere except /go.php and /url.php, which this module refuses
 * to request.
 */
export const JOB108_BASE_URL = 'https://www.job-108.com';

export const JOB108_USER_AGENT =
  'KKU-ProgramLandscape/1.0 (+https://program-landscape.kku.ac.th; denpong@kku.ac.th)';

/** One request per this many milliseconds. Politeness, not a rate limit we were given. */
export const JOB108_REQUEST_SPACING_MS = 2_000;

const JOB108_TIMEOUT_MS = 30_000;

/** Paths robots.txt disallows for every user-agent. */
const DISALLOWED = ['/go.php', '/url.php'];

export class Job108FetchError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'Job108FetchError';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Fetches one page, refusing any path robots.txt disallows. */
export async function fetchJob108Page(url: string): Promise<string> {
  const path = new URL(url).pathname;
  if (DISALLOWED.some((d) => path.startsWith(d))) {
    throw new Job108FetchError(url, null, `robots.txt disallows ${path}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB108_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': JOB108_USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Job108FetchError(url, res.status, `HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err: unknown) {
    if (err instanceof Job108FetchError) throw err;
    const cause = err instanceof Error ? (err.cause ?? err.message) : String(err);
    throw new Job108FetchError(url, null, `fetch failed for ${url}: ${String(cause)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch with the politeness delay applied BEFORE the request. */
export async function fetchJob108PagePolitely(url: string): Promise<string> {
  await sleep(JOB108_REQUEST_SPACING_MS);
  return fetchJob108Page(url);
}

export const job108SitemapUrl = (): string => `${JOB108_BASE_URL}/sitemap.xml`;
```

- [ ] **Step 4: Write `extract.ts`**

```ts
// apps/ingestion/src/job108/extract.ts
import {
  JOB108_ANNOUNCEMENT_MAX_OUTPUT_TOKENS,
  JOB108_ANNOUNCEMENT_VERSION,
  Job108AnnouncementOutputSchema,
  buildJob108AnnouncementMessages,
  extractStructuredWithParseRetry,
  htmlToText,
  type Job108Position,
  type StructuredExtractor,
} from '@kku/shared';
// scrubPostingText is NOT on the root barrel. Reach it the way job-fields.ts
// already does rather than widening the barrel: the barrel pulls node:crypto
// into anything that imports it, which has already broken a client build once.
import { scrubPostingText } from '@kku/shared/src/jobthai';
import type { Job108AnnouncementHeader } from '@kku/db';

export interface ExtractedAnnouncement {
  header: Job108AnnouncementHeader;
  applicationOpenDate: Date | null;
  title: string;
  positions: Job108Position[];
  confidence: number;
}

const toDate = (iso: string | null): Date | null => (iso === null ? null : new Date(`${iso}T00:00:00Z`));

/**
 * One announcement page → its positions.
 *
 * Scrubbing runs BEFORE extraction, not after. Gender and age requirements
 * appear in government announcements as they do in private adverts; they are
 * not skills and must never reach a Council surface. Scrubbing first also
 * guarantees a stripped phrase cannot end up inside a captured field name —
 * the same ordering the JobThai parser uses and for the same reason.
 */
export async function extractAnnouncement(
  ai: StructuredExtractor,
  input: { announcementId: string; html: string },
): Promise<ExtractedAnnouncement> {
  const text = scrubPostingText(htmlToText(input.html));

  const r = await extractStructuredWithParseRetry(
    ai,
    {
      ctx: { module: 'gap-analysis', kind: 'job108-announcement' },
      methodVersion: JOB108_ANNOUNCEMENT_VERSION,
      messages: buildJob108AnnouncementMessages({ announcementId: input.announcementId, text }),
      maxOutputTokens: JOB108_ANNOUNCEMENT_MAX_OUTPUT_TOKENS,
    },
    Job108AnnouncementOutputSchema,
    'job108-announcement',
  );

  const out = r.parsed;
  return {
    header: {
      announcementId: input.announcementId,
      agencyName: out.agencyName,
      publishedDate: toDate(out.publishedDate),
      applicationCloseDate: toDate(out.applicationCloseDate),
    },
    applicationOpenDate: toDate(out.applicationOpenDate),
    title: out.positions[0]?.title ?? input.announcementId,
    positions: out.positions,
    confidence: out.confidence,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter ingestion vitest run test/job108/extract.test.ts`
Expected: PASS, 3 tests.

If the import fails to resolve, confirm the deep path matches what `packages/db/src/job-fields.ts` uses for `JOBTHAI_ANY_FIELD`. Do **not** "fix" it by adding `jobthai` to the `@kku/shared` root barrel: the barrel is imported by client components, `parse-row.ts` pulls in `node:crypto`, and that combination has broken a build before.

- [ ] **Step 6: Write the connector**

```ts
// apps/ingestion/src/connectors/sources/job-108/connector.ts
import {
  PUBLIC_DEMAND_SOURCE,
  parseSitemap,
  type Connector,
  type ConnectorContext,
  type DataSourceInputFormat,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';
import {
  heldAnnouncementLastmods,
  hashPage,
  planJob108Fetch,
  recordJob108Failure,
  toPostingRows,
  upsertJob108Announcement,
} from '@kku/db';

import { extractAnnouncement } from '../../../job108/extract';
import { fetchJob108Page, fetchJob108PagePolitely, job108SitemapUrl } from '../../../job108/fetch';
import { createIngestionAiService } from '../../../lib/ai-service';

/** Cap on one scheduled run. The steady state is ~22; the cap stops a
 *  sitemap anomaly from turning a weekly run into a 2,000-page backfill.
 *  The backfill script raises it deliberately. */
const MAX_ANNOUNCEMENTS_PER_RUN = 60;

export class Job108Connector implements Connector {
  readonly slug = PUBLIC_DEMAND_SOURCE;
  readonly mocked = false;
  readonly inputFormat: DataSourceInputFormat = 'HTML';

  constructor(private readonly maxPerRun: number = MAX_ANNOUNCEMENTS_PER_RUN) {}

  async healthCheck(): Promise<HealthStatus> {
    try {
      const xml = await fetchJob108Page(job108SitemapUrl());
      const entries = parseSitemap(xml);
      return entries.length > 0
        ? { ok: true, message: `sitemap reachable, ${entries.length} announcements` }
        : { ok: false, message: 'sitemap reachable but contained no announcement pages' };
    } catch (err: unknown) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Discovery only. Failing to read the sitemap fails the run — without it
   * there is nothing to do. An individual page's failure does not, and is
   * recorded against its announcement row instead.
   */
  async fetch(ctx: ConnectorContext): Promise<RawRecord[]> {
    const xml = await fetchJob108Page(job108SitemapUrl());
    const entries = parseSitemap(xml);
    const held = await heldAnnouncementLastmods();
    const due = planJob108Fetch(entries, held, this.maxPerRun);
    ctx.log.info('job-108 discovery', {
      inSitemap: entries.length,
      alreadyHeld: held.size,
      due: due.length,
    });
    return due.map((e) => ({
      externalId: e.announcementId,
      data: e,
      sourceTimestamp: e.lastmod,
    }));
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const entry = raw.data as { announcementId: string; url: string; lastmod: Date };
    return [
      {
        target: 'job108_announcements',
        externalId: entry.announcementId,
        payload: { url: entry.url, lastmod: entry.lastmod },
        freshnessDate: entry.lastmod,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    const ai = createIngestionAiService();
    let loaded = 0;
    let failed = 0;
    let postings = 0;
    let emptyPages = 0;

    for (const rec of normalized) {
      const url = String(rec.payload.url);
      const lastmod = rec.payload.lastmod as Date;
      let contentHash = '';
      try {
        const html = await fetchJob108PagePolitely(url);
        contentHash = hashPage(html);
        const extracted = await extractAnnouncement(ai, { announcementId: rec.externalId, html });
        if (extracted.positions.length === 0) emptyPages++;
        const rows = toPostingRows(extracted.header, extracted.positions);
        const { postingsWritten } = await upsertJob108Announcement({
          announcementId: rec.externalId,
          url,
          contentHash,
          title: extracted.title,
          header: extracted.header,
          applicationOpenDate: extracted.applicationOpenDate,
          sourceLastmod: lastmod,
          rows,
          runId: ctx.runId,
        });
        postings += postingsWritten;
        loaded++;
      } catch (err: unknown) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        ctx.log.warn('job-108 announcement failed', { announcementId: rec.externalId, message });
        await recordJob108Failure({
          announcementId: rec.externalId,
          url,
          contentHash: contentHash === '' ? `failed:${rec.externalId}` : contentHash,
          sourceLastmod: lastmod,
          error: message,
          runId: ctx.runId,
        });
      }
    }

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: { postingsWritten: postings, announcementsWithNoPositions: emptyPages },
    };
  }
}
```

```ts
// apps/ingestion/src/connectors/sources/job-108/index.ts
export * from './connector';
```

- [ ] **Step 7: Register it**

In `apps/ingestion/src/connectors/registry.ts`, add the import beside the other real connectors:

```ts
import { Job108Connector } from './sources/job-108';
```

and add the entry to the registry array, following the shape the other real-only entries use:

```ts
  { slug: 'job-108', mock: new Job108Connector(), real: new Job108Connector() },
```

Both slots hold the real connector deliberately: there is no mock, per the no-mock-data policy, and the registry falls back to `mock` when `real` is absent, so pointing both at the real one keeps the flag from silently disabling the source.

- [ ] **Step 8: Verify it runs end to end against the live site**

```bash
cd /home/denpong/projects/program-landscape && pnpm connector:run job-108
```

Expected: an `IngestionRun` reaching `SUCCEEDED`, with `recordsLoaded` matching the number of due announcements and `metadata.postingsWritten` greater than it. Then confirm the rows are visible to the map's provenance gate:

```bash
docker compose exec -T postgres psql -U postgres -d program_landscape -c "
SELECT COUNT(*) AS rows,
       COUNT(*) FILTER (WHERE ingestion_run_id IS NOT NULL) AS tagged,
       COUNT(*) FILTER (WHERE array_length(required_fields_raw, 1) > 0) AS naming_a_field
FROM job_postings WHERE source = 'job-108';"
```

Expected: `rows = tagged`. If `tagged` is lower, a write path is missing its run stamp — fix it before continuing, because those rows are invisible to `realDataWhere()` and will never reach the map.

- [ ] **Step 9: Commit**

```bash
git add apps/ingestion/src/job108 apps/ingestion/src/connectors/sources/job-108 apps/ingestion/test/job108 apps/ingestion/src/connectors/registry.ts
git commit -F - <<'EOF'
feat(job108): weekly connector for government announcements

No scraping proxy: the site returns 200 to any user-agent that is not
literally curl/*, so an identifying KKU one is enough and free. The fetcher
refuses /go.php and /url.php outright — the two paths robots.txt disallows
for every agent — rather than relying on never happening to build such a URL.

Failure isolation follows kku-research: one page's failure is recorded
against its announcement row and the run continues; a sitemap that cannot be
read fails the run, because without it there is nothing to do.

Both registry slots hold the real connector. There is no mock, and the
registry falls back to `mock` when `real` is absent, so leaving it out would
silently disable the source.
EOF
```

---

### Task 8: Backfill script

**Files:**
- Create: `apps/ingestion/src/scripts/job108-backfill.ts`
- Modify: `apps/ingestion/package.json`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

```ts
// apps/ingestion/src/scripts/job108-backfill.ts
import { prisma } from '@kku/db';

import { Job108Connector } from '../connectors/sources/job-108';

/**
 * One-off backfill over the whole sitemap (2,000 announcements back to
 * 2024-12-18).
 *
 * Dry run by default and it really is free here, unlike `jobthai:fields`:
 * the dry run stops before any page fetch or model call and only reports how
 * many announcements are due.
 *
 * Resumable. `planJob108Fetch` skips anything already stored at the same
 * lastmod, so re-running after an interruption continues rather than
 * repeating — and rerunning costs nothing for work already done.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg === undefined ? 2_500 : Number(limitArg.slice('--limit='.length));

  for (const a of args) {
    if (a !== '--apply' && !a.startsWith('--limit=')) {
      console.error(`Unknown flag: ${a}. Accepted: --apply, --limit=<n>`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error(`--limit must be a positive integer, got ${limit}`);
    process.exit(1);
  }

  const source = await prisma.dataSource.findUnique({ where: { slug: 'job-108' }, select: { id: true } });
  if (source === null) {
    console.error('No data_sources row for job-108. Run pnpm db:seed first.');
    process.exit(1);
  }

  const connector = new Job108Connector(limit);
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, status: 'RUNNING', trigger: 'MANUAL', startedAt: new Date() },
    select: { id: true },
  });

  const ctx = {
    runId: run.id,
    dataSource: { id: source.id, slug: 'job-108', name: 'Job-108', baseUrl: null, lastSyncedAt: null },
    log: {
      info: (m: string, meta?: Record<string, unknown>) => console.log(m, meta ?? ''),
      warn: (m: string, meta?: Record<string, unknown>) => console.warn(m, meta ?? ''),
      error: (m: string, meta?: Record<string, unknown>) => console.error(m, meta ?? ''),
    },
  };

  const raw = await connector.fetch(ctx);
  console.log(`Due: ${raw.length} announcements (limit ${limit}).`);

  if (!apply) {
    const minutes = Math.ceil((raw.length * 2) / 60);
    console.log(
      `DRY RUN — nothing fetched, nothing extracted, nothing written, nothing spent.\n` +
        `Applying would fetch ${raw.length} pages at 2s spacing (~${minutes} min) ` +
        `and make ${raw.length} model calls (~$${(raw.length * 0.0135).toFixed(2)} at the catalogue rate).\n` +
        `Re-run with --apply.`,
    );
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: 'SKIPPED', completedAt: new Date() },
    });
    return;
  }

  const normalized = (await Promise.all(raw.map((r) => connector.transform(ctx, r)))).flat();
  const result = await connector.load(ctx, normalized);

  await prisma.ingestionRun.update({
    where: { id: run.id },
    data: {
      status: result.recordsLoaded > 0 ? 'SUCCEEDED' : 'FAILED',
      completedAt: new Date(),
      recordsFetched: result.recordsFetched,
      recordsLoaded: result.recordsLoaded,
      recordsFailed: result.recordsFailed,
      metadata: result.metadata,
    },
  });

  console.log(
    `Loaded ${result.recordsLoaded} announcements, ${result.recordsFailed} failed, ` +
      `${String(result.metadata?.postingsWritten ?? 0)} positions written.`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
```

- [ ] **Step 2: Wire the script names**

In `apps/ingestion/package.json` `scripts`, beside the other `jobthai:*` entries:

```json
    "job108:backfill": "tsx src/scripts/job108-backfill.ts",
```

In the root `package.json` `scripts`:

```json
    "job108:backfill": "pnpm --filter ingestion job108:backfill",
```

- [ ] **Step 3: Add it to the production bundle**

In `apps/ingestion/scripts/bundle-pipeline-scripts.ts`, add `'job108-backfill'` to the `TARGETS` array. A script that is not bundled does not exist inside the production image, and dev's `tsx` cannot catch it — this has already cost one rebuild.

- [ ] **Step 4: Dry-run it**

```bash
pnpm job108:backfill
```

Expected: `Due: N announcements`, then the DRY RUN block with an estimated duration and cost. Nothing written.

- [ ] **Step 5: Run a small real slice**

```bash
pnpm job108:backfill --limit=10 --apply
```

Expected: `Loaded 10 announcements, 0 failed, <n> positions written` with `n > 10`.

Then read three of them and check the extraction is sane — this is the one place a person must look at the output rather than a count:

```bash
docker compose exec -T postgres psql -U postgres -d program_landscape -c "
SELECT title, position_count, min_education_level, required_fields_raw
FROM job_postings WHERE source = 'job-108' ORDER BY created_at DESC LIMIT 3;"
```

Expect each `required_fields_raw` to hold **several** separate Thai discipline names, not one. A single-element array on a position whose text listed several fields means the prompt is being read as the old regex behaved, and Task 5 needs revisiting before the full backfill spends $27.

- [ ] **Step 6: Commit**

```bash
git add apps/ingestion/src/scripts/job108-backfill.ts apps/ingestion/package.json package.json apps/ingestion/scripts/bundle-pipeline-scripts.ts
git commit -F - <<'EOF'
feat(job108): resumable sitemap backfill

Dry run by default, and unlike jobthai:fields the dry run really is free —
it stops before any fetch or model call and reports what applying would cost
in both minutes and dollars.

Resumable by construction: planJob108Fetch skips anything already stored at
the same lastmod, so an interrupted backfill continues rather than repeating.

Added to the esbuild TARGETS list. A script missing from that list does not
exist inside the production image and dev's tsx cannot catch it.
EOF
```

---

### Task 9: Calibration — what the private-side regex misses

This is the measurement the two-share comparison rests on. It produces a number for the provenance drawer.

**Files:**
- Create: `apps/ingestion/src/scripts/job108-calibrate.ts`
- Modify: `apps/ingestion/package.json`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

```ts
// apps/ingestion/src/scripts/job108-calibrate.ts
import { prisma } from '@kku/db';
import {
  JOB108_ANNOUNCEMENT_MAX_OUTPUT_TOKENS,
  JOB108_ANNOUNCEMENT_VERSION,
  Job108AnnouncementOutputSchema,
  buildJob108AnnouncementMessages,
  extractStructuredWithParseRetry,
} from '@kku/shared';
// Same deep path as Task 7, and for the same reason.
import { extractFieldsOfStudy } from '@kku/shared/src/jobthai';

import { createIngestionAiService } from '../lib/ai-service';

/**
 * How much does the private side's regex miss?
 *
 * The gap map compares a share built by a deterministic regex against one
 * built by a model. That asymmetry needs a number rather than a hedge, and
 * the number belongs to the private side: if its extractor under-captures,
 * every verdict on the page today is affected, not just the new ones.
 *
 * Runs the government extractor over a sample of JobThai qualification texts
 * and reports agreement. Read-only — it writes nothing.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sizeArg = args.find((a) => a.startsWith('--sample='));
  const sample = sizeArg === undefined ? 300 : Number(sizeArg.slice('--sample='.length));
  for (const a of args) {
    if (!a.startsWith('--sample=')) {
      console.error(`Unknown flag: ${a}. Accepted: --sample=<n>`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(sample) || sample <= 0) {
    console.error(`--sample must be a positive integer, got ${sample}`);
    process.exit(1);
  }

  // Stratified: postings the regex found fields in AND postings it found none
  // in. Sampling only the first would measure precision and miss the failure
  // that matters, which is silent under-capture.
  const half = Math.ceil(sample / 2);
  const rows = await prisma.$queryRaw<Array<{ id: string; qualification_raw: string; n: number }>>`
    (SELECT id, qualification_raw, COALESCE(array_length(required_fields_raw, 1), 0) AS n
       FROM job_postings
      WHERE source = 'jobthai' AND qualification_raw IS NOT NULL AND qualification_raw <> ''
        AND COALESCE(array_length(required_fields_raw, 1), 0) > 0
      ORDER BY random() LIMIT ${half})
    UNION ALL
    (SELECT id, qualification_raw, COALESCE(array_length(required_fields_raw, 1), 0) AS n
       FROM job_postings
      WHERE source = 'jobthai' AND qualification_raw IS NOT NULL AND qualification_raw <> ''
        AND COALESCE(array_length(required_fields_raw, 1), 0) = 0
      ORDER BY random() LIMIT ${sample - half})
  `;

  const ai = createIngestionAiService();
  let agreed = 0;
  let modelFoundMore = 0;
  let regexFoundMore = 0;
  let bothEmpty = 0;
  let missedByRegex = 0;
  let extraFromRegex = 0;
  const examples: string[] = [];

  for (const row of rows) {
    const regexFields = new Set(extractFieldsOfStudy(row.qualification_raw));
    let modelFields = new Set<string>();
    try {
      const r = await extractStructuredWithParseRetry(
        ai,
        {
          ctx: { module: 'gap-analysis', kind: 'job108-calibration' },
          methodVersion: JOB108_ANNOUNCEMENT_VERSION,
          messages: buildJob108AnnouncementMessages({ announcementId: row.id, text: row.qualification_raw }),
          maxOutputTokens: JOB108_ANNOUNCEMENT_MAX_OUTPUT_TOKENS,
        },
        Job108AnnouncementOutputSchema,
        'job108-calibration',
      );
      modelFields = new Set(r.parsed.positions.flatMap((p) => p.requiredFieldsRaw));
    } catch (err: unknown) {
      console.warn(`skipped ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const missed = [...modelFields].filter((f) => !regexFields.has(f));
    const extra = [...regexFields].filter((f) => !modelFields.has(f));
    missedByRegex += missed.length;
    extraFromRegex += extra.length;

    if (regexFields.size === 0 && modelFields.size === 0) bothEmpty++;
    else if (missed.length === 0 && extra.length === 0) agreed++;
    else if (missed.length > extra.length) modelFoundMore++;
    else regexFoundMore++;

    if (missed.length > 0 && examples.length < 10) {
      examples.push(`${row.id}: regex [${[...regexFields].join(', ')}] | model added [${missed.join(', ')}]`);
    }
  }

  const n = rows.length;
  console.log(`
Calibration — JobThai regex vs job108-announcement.v1, n = ${n}

  both found nothing        ${bothEmpty}  (${((bothEmpty / n) * 100).toFixed(1)}%)
  exact agreement           ${agreed}  (${((agreed / n) * 100).toFixed(1)}%)
  model found more          ${modelFoundMore}  (${((modelFoundMore / n) * 100).toFixed(1)}%)
  regex found more          ${regexFoundMore}  (${((regexFoundMore / n) * 100).toFixed(1)}%)

  field names the regex missed    ${missedByRegex}
  field names only the regex had  ${extraFromRegex}

Examples of under-capture:
${examples.map((e) => `  ${e}`).join('\n')}

Put these numbers in docs/methodologies/gap-map.md and in mapMeta's caveat.
`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
```

- [ ] **Step 2: Wire the script names**

`apps/ingestion/package.json`:

```json
    "job108:calibrate": "tsx src/scripts/job108-calibrate.ts",
```

Root `package.json`:

```json
    "job108:calibrate": "pnpm --filter ingestion job108:calibrate",
```

- [ ] **Step 3: Run a small calibration**

```bash
pnpm job108:calibrate --sample=20
```

Expected: the report block. Confirm the percentages sum to 100 and that `n = 20`.

- [ ] **Step 4: Run the real one and keep the output**

```bash
pnpm job108:calibrate --sample=300 | tee /tmp/job108-calibration.txt
```

Keep this output — Tasks 12 and 15 both quote it.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/scripts/job108-calibrate.ts apps/ingestion/package.json package.json
git commit -F - <<'EOF'
feat(job108): measure what the private side's regex misses

The map is about to compare a share built by a regex against one built by a
model. That asymmetry deserves a number, not a hedge — and the number belongs
to the private side, because if its extractor under-captures then every
verdict on the page today is affected, not only the new ones.

The sample is stratified across postings where the regex found fields and
postings where it found none. Sampling only the former would measure
precision and miss the failure that actually matters: silent under-capture.
EOF
```

---

### Task 10: Share the taxonomy between both sources

**Files:**
- Modify: `packages/db/src/job-fields.ts`
- Modify: `packages/db/test/jobthai-bridge.test.ts` (or create `packages/db/test/job-fields-sources.test.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/job-fields-sources.test.ts
import { describe, expect, it } from 'vitest';
import { demandSourcesFor } from '@kku/shared';
import { collectRawFieldStrings, latestDemandRunId, refreshMentionCounts } from '../src/job-fields';

describe('taxonomy source coverage', () => {
  it('collectRawFieldStrings takes both demand sources', () => {
    const sql = collectRawFieldStrings.toString();
    for (const slug of demandSourcesFor('all')) expect(sql).toContain(slug);
    expect(sql).not.toMatch(/jp\.source = 'jobthai'/);
  });

  it('refreshMentionCounts takes both demand sources', () => {
    const sql = refreshMentionCounts.toString();
    for (const slug of demandSourcesFor('all')) expect(sql).toContain(slug);
  });

  it('the run anchor is not bound to a single source', () => {
    expect(latestDemandRunId.toString()).not.toMatch(/slug: 'jobthai'/);
  });
});
```

This reads the function source deliberately: these are `$queryRaw` templates whose predicate cannot be asserted without a database, and a stringly test that fails loudly when someone re-hardcodes a slug is worth more than no test at all. A database-backed assertion arrives in Task 11's verification step.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/db vitest run test/job-fields-sources.test.ts`
Expected: FAIL — `latestDemandRunId` is not exported, and the source check finds the hardcoded slug.

- [ ] **Step 3: Replace the three predicates**

At the top of `packages/db/src/job-fields.ts`, add to the existing `@kku/shared` import:

```ts
import { demandSourcesFor } from '@kku/shared';
```

and define, beside the other module constants:

```ts
/** Both demand sources seed the vocabulary. A field of study is a field of
 *  study regardless of who advertised it, and two vocabularies would leave no
 *  shared row to carry both a private and a public share. */
const TAXONOMY_SOURCES = demandSourcesFor('all');
```

In `collectRawFieldStrings`, replace:

```sql
    WHERE jp.source = 'jobthai'
```

with:

```sql
    WHERE jp.source = ANY(${TAXONOMY_SOURCES}::text[])
```

In `refreshMentionCounts`, replace:

```sql
        ON jp.source = 'jobthai'
```

with:

```sql
        ON jp.source = ANY(${TAXONOMY_SOURCES}::text[])
```

- [ ] **Step 4: Replace the run anchor**

Replace `latestJobThaiRunId` with a source-agnostic version. Keep the old name as a deprecated alias so nothing breaks mid-refactor:

```ts
/** The run every taxonomy write is attributed to: the most recent SUCCEEDED
 *  run of ANY demand source. Both seed the vocabulary, so anchoring to one of
 *  them would stamp taxonomy rows built partly from government text with a
 *  JobThai run — a provenance claim that is simply false. */
export async function latestDemandRunId(): Promise<string | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug: { in: demandSourcesFor('all') } } },
    orderBy: { completedAt: 'desc' },
    select: { id: true },
  });
  return run?.id ?? null;
}

/** @deprecated Use latestDemandRunId. Retained so callers migrate in one pass. */
export const latestJobThaiRunId = latestDemandRunId;
```

- [ ] **Step 5: Add the per-synonym source attribution query**

Append to `packages/db/src/job-fields.ts`:

```ts
export interface SynonymSources {
  synonym: string;
  sources: string[];
}

/**
 * Which demand sources contributed each synonym of a field.
 *
 * Derived rather than stored: the answer is already in the postings, and a
 * stored array would drift as new postings arrive. `/admin/job-fields` needs
 * it because approving a field is not cosmetic — since jobthai-bridge.v3 an
 * APPROVED field's assignments decide which programmes a posting asks for,
 * and those links feed a Council-facing health driver. A reviewer approving a
 * field built entirely from government text should be able to see that.
 */
export async function synonymSourcesForField(fieldId: string): Promise<SynonymSources[]> {
  const rows = await prisma.$queryRaw<Array<{ synonym: string; sources: string[] }>>(Prisma.sql`
    SELECT s AS synonym, ARRAY_AGG(DISTINCT jp.source ORDER BY jp.source) AS sources
    FROM job_field_taxonomy f, unnest(f.synonyms) AS s
    JOIN job_postings jp
      ON s = ANY(jp.required_fields_raw)
     AND jp.source = ANY(${demandSourcesFor('all')}::text[])
     AND ${realDataSql('jp')}
    WHERE f.id = ${fieldId}
    GROUP BY s
    ORDER BY s ASC
  `);
  return rows;
}
```

- [ ] **Step 6: Run the test and the suite**

Run: `pnpm --filter @kku/db vitest run test/job-fields-sources.test.ts`
Expected: PASS, 3 tests.

Run: `pnpm --filter @kku/db vitest run`
Expected: all previously-passing tests still pass.

- [ ] **Step 7: Verify against the database**

```bash
docker compose exec -T postgres psql -U postgres -d program_landscape -c "
SELECT jp.source, COUNT(DISTINCT s) AS distinct_field_strings
FROM job_postings jp, unnest(jp.required_fields_raw) AS s
WHERE jp.source IN ('jobthai','job-108') AND s <> '*ANY*'
GROUP BY jp.source;"
```

Expected: two rows. The `job-108` count is the vocabulary this change makes reachable.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/job-fields.ts packages/db/test/job-fields-sources.test.ts
git commit -F - <<'EOF'
feat(gap): both demand sources seed the field vocabulary

Three predicates and the run anchor were bound to 'jobthai'. Government field
strings could never enter the taxonomy, and the map's rows ARE taxonomy
fields, so public-only disciplines — รัฐประศาสนศาสตร์, การปกครอง — had no row
to appear on at all.

The run anchor moves with them. Attributing a taxonomy row built partly from
government text to a JobThai run is a provenance claim that is false.

synonymSourcesForField derives attribution from the postings rather than
storing it, so it cannot drift. /admin/job-fields needs it: since
jobthai-bridge.v3 an APPROVED field decides which programmes a posting asks
for, and a reviewer should see when a field rests entirely on government text.
EOF
```

---

### Task 11: The demand basis in `computeGapMap`

The analytic core. Nothing about supply or `verdictFor()` changes.

**Files:**
- Modify: `packages/db/src/gap-map-rules.ts`
- Modify: `packages/db/src/gap-map.ts`
- Create: `packages/db/test/gap-map-basis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/gap-map-basis.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEMAND_BASIS, DEFAULT_PUBLIC_WINDOW_MONTHS } from '@kku/shared';
import { parseDemandBasis, publicWindowStart } from '../src/gap-map-rules';

describe('parseDemandBasis', () => {
  it('defaults to the blended basis', () => {
    expect(parseDemandBasis({})).toEqual({
      basis: DEFAULT_DEMAND_BASIS,
      publicWindowMonths: DEFAULT_PUBLIC_WINDOW_MONTHS,
    });
  });

  it('accepts each basis', () => {
    expect(parseDemandBasis({ basis: 'private' }).basis).toBe('private');
    expect(parseDemandBasis({ basis: 'public' }).basis).toBe('public');
    expect(parseDemandBasis({ basis: 'all' }).basis).toBe('all');
  });

  it('coerces the window from a query string', () => {
    expect(parseDemandBasis({ publicWindowMonths: '24' }).publicWindowMonths).toBe(24);
  });

  it('rejects an unknown basis rather than silently defaulting', () => {
    expect(() => parseDemandBasis({ basis: 'government' })).toThrow();
  });

  it('rejects a non-positive window', () => {
    expect(() => parseDemandBasis({ publicWindowMonths: '0' })).toThrow();
  });
});

describe('publicWindowStart', () => {
  it('reaches back the stated number of months', () => {
    const start = publicWindowStart(new Date('2026-09-20T00:00:00Z'), 12);
    expect(start.toISOString().slice(0, 10)).toBe('2025-09-20');
  });

  it('handles a window that crosses a year boundary', () => {
    const start = publicWindowStart(new Date('2026-02-10T00:00:00Z'), 3);
    expect(start.toISOString().slice(0, 10)).toBe('2025-11-10');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/db vitest run test/gap-map-basis.test.ts`
Expected: FAIL — `parseDemandBasis` is not exported.

- [ ] **Step 3: Add the parser to `gap-map-rules.ts`**

Add the import:

```ts
import { DEFAULT_DEMAND_BASIS, DEFAULT_PUBLIC_WINDOW_MONTHS, DEMAND_BASES, type DemandBasis } from '@kku/shared';
```

and, beside `ThresholdsSchema`:

```ts
export interface DemandBasisOptions {
  basis: DemandBasis;
  /** Months of public announcements that count. Ignored when basis is 'private'. */
  publicWindowMonths: number;
}

export const DemandBasisSchema = z.object({
  basis: z.enum(DEMAND_BASES).default(DEFAULT_DEMAND_BASIS),
  publicWindowMonths: z.coerce.number().int().positive().default(DEFAULT_PUBLIC_WINDOW_MONTHS),
});

/**
 * From URL / query strings. Throws on an unknown basis rather than falling
 * back to the default: a shared link carrying a typo should fail visibly, not
 * quietly render a different denominator under the same methodology stamp.
 */
export function parseDemandBasis(q: {
  basis?: string;
  publicWindowMonths?: string | number;
}): DemandBasisOptions {
  return DemandBasisSchema.parse(q);
}

/** Start of the public counting window, `months` before `now`. */
export function publicWindowStart(now: Date, months: number): Date {
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - months);
  return start;
}
```

- [ ] **Step 4: Run the rules test**

Run: `pnpm --filter @kku/db vitest run test/gap-map-basis.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Thread the basis through `computeGapMap`**

In `packages/db/src/gap-map.ts`, extend the imports:

```ts
import { demandSourcesFor, PUBLIC_DEMAND_SOURCE, type DemandBasis } from '@kku/shared';
import { parseDemandBasis, publicWindowStart, type DemandBasisOptions } from './gap-map-rules';
```

Change the signature:

```ts
export async function computeGapMap(args: {
  scope: GapMapScope;
  scopeId: string | null;
  thresholds: GapThresholds;
  demand?: DemandBasisOptions;
  now?: Date;
}): Promise<GapMapResult> {
  const now = args.now ?? new Date();
  const demand = args.demand ?? parseDemandBasis({});
  const windowStart = publicWindowStart(now, demand.publicWindowMonths);
```

Then define, immediately after, the predicate every demand query now uses:

```ts
  // Every demand query is gated by the same predicate so the three bases can
  // never disagree about which rows they are counting. The window applies to
  // public rows only: JobThai postings are undated (postedDateEstimated is
  // true on all 47,631), so windowing them would silently drop the whole
  // private side.
  const sourceGate = (alias: string) => {
    const col = Prisma.raw(`${alias}.source`);
    const dateCol = Prisma.raw(`${alias}.posted_date`);
    switch (demand.basis) {
      case 'private':
        return Prisma.sql`${col} = ${demandSourcesFor('private')[0]}`;
      case 'public':
        return Prisma.sql`${col} = ${PUBLIC_DEMAND_SOURCE} AND ${dateCol} >= ${windowStart}`;
      case 'all':
        return Prisma.sql`(${col} = ${demandSourcesFor('private')[0]}
          OR (${col} = ${PUBLIC_DEMAND_SOURCE} AND ${dateCol} >= ${windowStart}))`;
    }
  };
```

- [ ] **Step 6: Replace the four hardcoded predicates**

In the `universe` query, replace `WHERE jp.source = 'jobthai'` with:

```ts
        WHERE ${sourceGate('jp')}
```

In the same query's `postgraduate` sub-select, replace `jp.source = 'jobthai' AND` with:

```ts
        ${sourceGate('jp')} AND
```

In the province query, replace `AND jp.source = 'jobthai'` with:

```ts
        AND ${sourceGate('jp')}
```

In the occupations query, replace `AND jp.source = 'jobthai'` with:

```ts
      AND ${sourceGate('jp')}
```

Note the occupations query also joins `jobthai_occupations` on `job_category`/`job_subcategory`, which are null on every government row. That join therefore excludes public rows by construction and needs no further change — which is exactly the intended behaviour, since government postings feed the field layer only.

- [ ] **Step 7: Compute both shares per row**

Add a second province-style query that returns per-field postings split by source, so both shares are available regardless of the active basis. Insert it into the same `Promise.all` as the existing queries:

```ts
    prisma.$queryRaw<Array<{ field_id: string; source: string; postings: number }>>(Prisma.sql`
      SELECT f.id AS field_id, jp.source, COUNT(DISTINCT jp.id)::int AS postings
      FROM job_field_taxonomy f
      JOIN job_postings jp ON jp.required_fields_raw && f.synonyms
      WHERE f.review_status IN ('APPROVED', 'PROPOSED')
        AND (jp.source = ${demandSourcesFor('private')[0]}
             OR (jp.source = ${PUBLIC_DEMAND_SOURCE} AND jp.posted_date >= ${windowStart}))
        AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
        AND ${realDataSql('jp')}
      GROUP BY f.id, jp.source
    `),
```

Then, beside the existing `postingsByField` accumulation:

```ts
  // Both shares are computed for every row whatever the active basis, so the
  // expanded row can show a reader why a verdict is what it is. Each side is
  // normalised by its OWN sum of per-field numerators — a posting naming k
  // fields counts k times on whichever side it sits — so the three
  // denominators are three separate sums and none is derivable from another.
  const privateByField = new Map<string, number>();
  const publicByField = new Map<string, number>();
  for (const r of sourceSplitRows) {
    const target = r.source === PUBLIC_DEMAND_SOURCE ? publicByField : privateByField;
    target.set(r.field_id, (target.get(r.field_id) ?? 0) + r.postings);
  }
  const privateMentions = [...privateByField.values()].reduce((n, v) => n + v, 0);
  const publicMentions = [...publicByField.values()].reduce((n, v) => n + v, 0);
```

In the row-building loop, beside the existing `const demandShare = …`:

```ts
    const privatePostings = privateByField.get(field.id) ?? 0;
    const publicPostings = publicByField.get(field.id) ?? 0;
    const privateDemandShare = privateMentions > 0 ? privatePostings / privateMentions : 0;
    const publicDemandShare = publicMentions > 0 ? publicPostings / publicMentions : 0;
```

and add all four to the row object beside `demandShare`.

- [ ] **Step 8: Extend the result types**

In `GapMapRow`, after `demandShare`:

```ts
  /** Share of the private (JobThai) denominator, whatever the active basis. */
  privateDemandShare: number;
  /** Share of the public (job-108, windowed) denominator, whatever the active basis. */
  publicDemandShare: number;
  privatePostings: number;
  publicPostings: number;
```

In `GapMapResult`, after `thresholds`:

```ts
  demand: DemandBasisOptions & { publicWindowFrom: string };
```

In `reconciliation`, after `fieldMentions`:

```ts
    /** Σ_f postings_f over JobThai rows only. */
    privateFieldMentions: number;
    /** Σ_f postings_f over windowed job-108 rows only. */
    publicFieldMentions: number;
    /** Distinct government announcements behind the public rows in window. */
    publicAnnouncements: number;
    /** Distinct government position-rows in window. */
    publicPositions: number;
    /** Seats behind those positions. Reported, never weighted. */
    publicSeats: number;
```

Populate `publicAnnouncements`, `publicPositions` and `publicSeats` with one more query in the same `Promise.all`:

```ts
    prisma.$queryRaw<Array<{ announcements: number; positions: number; seats: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT jp.job108_announcement_id)::int AS announcements,
             COUNT(*)::int AS positions,
             COALESCE(SUM(jp.position_count), 0)::int AS seats
      FROM job_postings jp
      WHERE jp.source = ${PUBLIC_DEMAND_SOURCE}
        AND jp.posted_date >= ${windowStart}
        AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
        AND ${realDataSql('jp')}
    `),
```

and set `demand` in the returned object:

```ts
    demand: { ...demand, publicWindowFrom: windowStart.toISOString().slice(0, 10) },
```

- [ ] **Step 9: Typecheck and run the suite**

```bash
pnpm --filter @kku/db typecheck && pnpm --filter @kku/db vitest run
```

Expected: exit 0, all tests pass. `verdictFor()` must be untouched — if a verdict test fails, you changed the supply side by mistake.

- [ ] **Step 10: Verify the three bases actually differ**

Restart api first (`packages/` changes do not hot-reload), then:

```bash
cd /home/denpong/projects/program-landscape && pnpm tsx -e "
import { computeGapMap, parseDemandBasis } from '@kku/db';
for (const basis of ['all','private','public'] as const) {
  const r = await computeGapMap({ scope: 'university', scopeId: null,
    thresholds: { under: 0.5, over: 2 }, demand: parseDemandBasis({ basis }) });
  console.log(basis.padEnd(8), 'mentions', String(r.reconciliation.fieldMentions).padStart(6),
    'rows', r.rows.length, JSON.stringify(r.verdictCounts));
}
"
```

Expected: three different `fieldMentions` values, and `all` ≈ `private` + `public`. If `public` reads 0, either the backfill has not run or `posted_date` is outside the window — check before assuming the code is wrong.

- [ ] **Step 11: Commit**

```bash
git add packages/db/src/gap-map.ts packages/db/src/gap-map-rules.ts packages/db/test/gap-map-basis.test.ts
git commit -F - <<'EOF'
feat(gap): a selectable demand basis, defaulting to blended

Four hardcoded source predicates become one gate, so the three bases cannot
disagree about which rows they count. The window applies to public rows only:
JobThai postings are undated — postedDateEstimated is true on all 47,631 — so
windowing them would silently drop the entire private side.

The supply side does not move. supplyShare is KKU's share of graduates and is
basis-independent, so the ratio changes only through the denominator and
verdictFor() is untouched.

Both shares are computed for every row whatever the basis, each normalised by
its OWN sum of per-field numerators. A posting naming k fields counts k times
on whichever side it sits, so the three denominators are three separate sums
and none is derivable from another.

parseDemandBasis throws on an unknown basis rather than defaulting: a shared
link carrying a typo should fail visibly, not quietly render a different
denominator under the same methodology stamp.
EOF
```

---

### Task 12: API — parameters, cache key, provenance

**Files:**
- Modify: `apps/api/src/gap/gap.service.ts`
- Modify: `apps/api/src/gap/gap.controller.ts`
- Create: `apps/api/test/gap-demand-basis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/gap-demand-basis.test.ts
import { describe, expect, it, vi } from 'vitest';
import { CacheService } from '../src/common/cache.service';
import { GapService } from '../src/gap/gap.service';
import { mapMeta } from '../src/gap/gap.controller';

const baseResult = {
  reconciliation: { scoredWithSupply: 83, supplyFromProxy: 13, publicAnnouncements: 4, publicPositions: 11, publicSeats: 97 },
  demand: { basis: 'all' as const, publicWindowMonths: 12, publicWindowFrom: '2025-09-20' },
};

describe('gap map cache key', () => {
  it('separates the three bases', async () => {
    const compute = vi.fn().mockResolvedValue(baseResult);
    const cache = new CacheService();
    const svc = new GapService(cache, compute);
    const args = { scope: 'university' as const, scopeId: null, thresholds: { under: 0.5, over: 2 } };

    await svc.map({ ...args, demand: { basis: 'all', publicWindowMonths: 12 } });
    await svc.map({ ...args, demand: { basis: 'private', publicWindowMonths: 12 } });
    await svc.map({ ...args, demand: { basis: 'public', publicWindowMonths: 12 } });

    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('separates two window lengths', async () => {
    const compute = vi.fn().mockResolvedValue(baseResult);
    const svc = new GapService(new CacheService(), compute);
    const args = { scope: 'university' as const, scopeId: null, thresholds: { under: 0.5, over: 2 } };

    await svc.map({ ...args, demand: { basis: 'all', publicWindowMonths: 12 } });
    await svc.map({ ...args, demand: { basis: 'all', publicWindowMonths: 24 } });

    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe('mapMeta', () => {
  it('states the basis and the window as methodology parameters', () => {
    const meta = mapMeta({
      thresholds: { under: 0.5, over: 2 },
      reconciliation: baseResult.reconciliation,
      demand: baseResult.demand,
      freshnessDate: '2026-09-19',
    });
    const labels = meta.methodologyParameters?.map((p) => p.label) ?? [];
    expect(labels.some((l) => /demand counted from/i.test(l))).toBe(true);
    expect(labels.some((l) => /public announcements/i.test(l))).toBe(true);
  });

  it('caveats that seats are not weighted', () => {
    const meta = mapMeta({
      thresholds: { under: 0.5, over: 2 },
      reconciliation: baseResult.reconciliation,
      demand: baseResult.demand,
      freshnessDate: null,
    });
    expect(meta.caveats?.some((c) => /seat/i.test(c))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter api vitest run test/gap-demand-basis.test.ts`
Expected: FAIL — `mapMeta` does not accept `demand`.

- [ ] **Step 3: Extend `GapMapArgs` and the cache key**

In `apps/api/src/gap/gap.service.ts`, add `demand` to `GapMapArgs`:

```ts
export interface GapMapArgs {
  scope: GapMapScope;
  scopeId: string | null;
  thresholds: GapThresholds;
  demand: DemandBasisOptions;
}
```

and extend the key:

```ts
    const key = CacheService.keyOf(GAP_MAP_CACHE_NS, {
      scope: args.scope,
      scopeId: args.scopeId,
      under: args.thresholds.under,
      over: args.thresholds.over,
      // Without these two the three bases collide in the cache and a reader
      // gets whichever was computed first under someone else's basis — the
      // same class of bug the thresholds already fixed once.
      basis: args.demand.basis,
      publicWindowMonths: args.demand.publicWindowMonths,
    });
```

- [ ] **Step 4: Extend `mapMeta`**

In `apps/api/src/gap/gap.controller.ts`:

```ts
export function mapMeta(args: {
  thresholds: GapThresholds;
  reconciliation: Pick<
    GapMapResult['reconciliation'],
    'scoredWithSupply' | 'supplyFromProxy' | 'publicAnnouncements' | 'publicPositions' | 'publicSeats'
  >;
  demand: GapMapResult['demand'];
  freshnessDate: string | null;
}): Pick<ApiMeta, 'freshnessDate' | 'caveats' | 'methodologyParameters'> {
  const { scoredWithSupply, supplyFromProxy, publicAnnouncements, publicPositions, publicSeats } =
    args.reconciliation;
  const basisLabel: Record<DemandBasis, string> = {
    all: 'Private adverts (JobThai) and public announcements (Job-108)',
    private: 'Private adverts only (JobThai)',
    public: 'Public announcements only (Job-108)',
  };
  return {
    freshnessDate: args.freshnessDate,
    methodologyParameters: [
      { label: 'Demand counted from', value: basisLabel[args.demand.basis] },
      {
        label: 'Public announcements counted since',
        value: `${args.demand.publicWindowFrom} (${args.demand.publicWindowMonths} months)`,
      },
      { label: 'Under-served below a ratio of', value: args.thresholds.under.toFixed(2) },
      { label: 'Over-served above a ratio of', value: args.thresholds.over.toFixed(2) },
      { label: 'Too few adverts to read, below', value: `${JOBTHAI_MIN_POSTINGS_FOR_SIGNAL} adverts` },
    ],
    caveats: [
      ...MAP_CAVEATS,
      `Part of the KKU supply total rests on a single-year enrolment figure standing in for a multi-cohort mean: ${supplyFromProxy} of the ${scoredWithSupply} scored programmes carrying a graduate figure are counted that way. It is the largest single piece of softness in the supply side.`,
      `Public demand counts one row per position-type, never per seat: ${publicPositions} positions across ${publicAnnouncements} announcements, offering ${publicSeats} seats in total. Seats are shown but never weighted, because JobThai carries no headcount column and weighting public seats against private adverts of unknown size would over-weight the public side by an unknowable factor.`,
      `The two sides are extracted differently. Private field-of-study strings come from a deterministic parser tuned to JobThai's corpus; public ones come from the job108-announcement.v1 model prompt, because that parser takes the first whitespace-delimited token and government announcements separate disciplines with spaces. CALIBRATION_SENTENCE`,
      `Government announcements feed the field-of-study layer only. They carry no occupation classification, so they create no occupation rows and no programme links, and they do not move the JobThai demand-alignment health driver directly.`,
    ],
  };
}
```

**Replace `CALIBRATION_SENTENCE`** with the real numbers from Task 9's output, in this form:

> On a stratified sample of 300 JobThai qualification texts the two agreed exactly on N%, the model found fields the parser missed in M% of cases, and the parser found fields the model did not in P%.

Leaving the placeholder in place is a plan failure — the sentence exists to carry a measurement, and an unmeasured caveat is worse than none.

- [ ] **Step 5: Accept the parameters on the route**

In the same controller, extend the map query schema beside `under` / `over`:

```ts
  basis: z.enum(DEMAND_BASES).default(DEFAULT_DEMAND_BASIS),
  publicWindowMonths: z.coerce.number().int().positive().default(DEFAULT_PUBLIC_WINDOW_MONTHS),
```

and at both `mapMeta(...)` call sites, pass the demand block through:

```ts
      meta: mapMeta({ thresholds, reconciliation, demand: result.demand, freshnessDate: freshness.postingsAsOf }),
```

Build the `demand` argument for `gap.map(...)` with `parseDemandBasis({ basis: q.basis, publicWindowMonths: q.publicWindowMonths })`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter api vitest run test/gap-demand-basis.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Verify live**

Restart api, then:

```bash
for b in all private public; do
  echo "--- $b"
  curl -s "http://localhost:4000/api/v1/gap/map?scope=university&basis=$b" \
    | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d['reconciliation']['fieldMentions'], d['demand'])"
done
```

Expected: three different mention counts and the matching `demand` block on each.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/gap/gap.service.ts apps/api/src/gap/gap.controller.ts apps/api/test/gap-demand-basis.test.ts
git commit -F - <<'EOF'
feat(api): carry the demand basis through cache key and provenance

The basis and the window join the cache key. Without them the three bases
collide and a reader gets whichever was computed first under someone else's
basis — the same class of bug the thresholds already fixed once.

Both land in methodologyParameters, which is assembled per request, so the
provenance drawer states which market a share was computed against rather
than leaving a shared link to look like the default.

Three caveats carry numbers rather than hedges: how many seats the share sets
aside, what the two extractors disagree about on a common sample, and that
government rows feed the field layer only.
EOF
```

---

### Task 13: The page

**Files:**
- Modify: `apps/web/app/gap-analysis/page.tsx`
- Modify: the row and expanded-row components under `apps/web/app/gap-analysis/`
- Create: `apps/web/test/gap-analysis-basis.test.tsx`

Read the existing page first and follow its conventions. Note `92cc9e4`: raw cuids reached the screen once through a `?? id` fallback, and the guard against it asserts on the cuid **shape**.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/gap-analysis-basis.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GapRowShares } from '../app/gap-analysis/row-shares';

const row = {
  demandShare: 0.031,
  privateDemandShare: 0.028,
  publicDemandShare: 0.052,
  privatePostings: 480,
  publicPostings: 22,
  supplyShare: 0.019,
};

describe('GapRowShares', () => {
  it('shows both shares with the active one marked', () => {
    render(<GapRowShares row={row} basis="all" />);
    expect(screen.getByText(/2\.8%/)).toBeInTheDocument();
    expect(screen.getByText(/5\.2%/)).toBeInTheDocument();
  });

  it('names what each share is a percentage of', () => {
    render(<GapRowShares row={row} basis="all" />);
    expect(screen.getByText(/of all private adverts naming a field/i)).toBeInTheDocument();
    expect(screen.getByText(/of all public positions naming a field/i)).toBeInTheDocument();
  });

  it('never renders a cuid', () => {
    const { container } = render(<GapRowShares row={row} basis="all" />);
    expect(container.textContent ?? '').not.toMatch(/\bc[a-z0-9]{24}\b/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter web vitest run test/gap-analysis-basis.test.tsx`
Expected: FAIL — `row-shares` does not exist.

- [ ] **Step 3: Write `row-shares.tsx`**

```tsx
// apps/web/app/gap-analysis/row-shares.tsx
import type { DemandBasis } from '@kku/shared';

export interface GapRowSharesProps {
  row: {
    demandShare: number;
    privateDemandShare: number;
    publicDemandShare: number;
    privatePostings: number;
    publicPostings: number;
    supplyShare: number;
  };
  basis: DemandBasis;
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/**
 * Both demand shares, always. The collapsed row shows the share for the
 * active basis; this block shows how it was made, so a reader can see why a
 * verdict is what it is rather than taking a single blended number on trust.
 *
 * Each line names what it is a percentage OF. A bare percentage next to
 * another bare percentage was a reported defect on this page once already.
 */
export function GapRowShares({ row, basis }: GapRowSharesProps): JSX.Element {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div
        className={
          basis === 'private' || basis === 'all'
            ? 'rounded-md border border-strong p-3'
            : 'rounded-md border border-subtle p-3 opacity-70'
        }
      >
        <dt className="text-sm text-secondary">Private demand</dt>
        <dd className="text-xl font-semibold text-primary">{pct(row.privateDemandShare)}</dd>
        <dd className="text-sm text-secondary">of all private adverts naming a field of study</dd>
        <dd className="text-sm text-secondary">{row.privatePostings.toLocaleString()} adverts</dd>
      </div>
      <div
        className={
          basis === 'public' || basis === 'all'
            ? 'rounded-md border border-strong p-3'
            : 'rounded-md border border-subtle p-3 opacity-70'
        }
      >
        <dt className="text-sm text-secondary">Public demand</dt>
        <dd className="text-xl font-semibold text-primary">{pct(row.publicDemandShare)}</dd>
        <dd className="text-sm text-secondary">of all public positions naming a field of study</dd>
        <dd className="text-sm text-secondary">{row.publicPostings.toLocaleString()} positions</dd>
      </div>
    </dl>
  );
}
```

Use the project's own token class names if these differ — check `packages/design/src/css/tokens.css`. Do not introduce a literal colour; ESLint forbids it. Remember the border-utility trap: only `border-subtle`, `border-default`, `border-strong` and `border-transparent` emit CSS.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter web vitest run test/gap-analysis-basis.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the basis control**

Add a three-way control beside the existing threshold controls, writing `basis` into the URL so the state stays shareable — the page's existing convention. Label the options **Both markets**, **Private only**, **Government only**, and put one always-visible line under the table:

> Demand share is each field's share of all adverts naming a field of study, on the selected basis. KKU share is that field's share of KKU's bachelor graduates per year.

- [ ] **Step 6: Add the government evidence block**

In the expanded row, after the existing occupations block, add a government block listing agency, position title, seats and closing date, each linking to its announcement. Render it only when `publicPostings > 0`. When the active basis is `private`, render it collapsed with a note that these positions are not counted in the current basis.

Add `<DataSourceMark source="job-108" />` to that block and keep the existing JobThai mark on the occupations block, per the standing rule that every surface showing source-derived data carries its mark.

- [ ] **Step 7: Verify in the browser**

Start the dev stack if it is not running, then open `http://localhost:3000/gap-analysis` and check, reading the page as a user rather than as its author:

- switching the basis changes the numbers and the URL;
- both shares appear in an expanded row, each saying what it is a percentage of;
- the government block lists real agency names, not ids;
- the provenance drawer states the basis, the window and the four caveats;
- the page works at phone width.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/gap-analysis apps/web/test/gap-analysis-basis.test.tsx
git commit -F - <<'EOF'
feat(web): show both demand shares and the government evidence behind them

The collapsed row shows the active basis; the expanded row shows both shares
so a reader can see why a verdict is what it is rather than taking a blended
number on trust. Each share names what it is a percentage OF — a bare
percentage beside another bare percentage was a reported defect on this page
once already.

Government positions get their own evidence block rather than being forced
into the occupations list, which they cannot join: they carry no occupation
classification. Agency, seats and closing date resolve to a named public
document, which is stronger evidence than the private side can offer.
EOF
```

---

### Task 14: Synonym attribution on the review page

**Files:**
- Modify: `apps/web/app/admin/job-fields/page.tsx` and its client component
- Modify: the API route backing that page

- [ ] **Step 1: Surface the data**

Call `synonymSourcesForField` (Task 10) for the field being reviewed and return, per synonym, which sources contributed it.

- [ ] **Step 2: Render it**

Beside each synonym, show a small source mark or label. Above the approve control, when **every** synonym of a field comes only from `job-108`, show:

> Every synonym of this field comes from government announcements. Approving it will also change which programmes JobThai adverts are matched to, because an approved field's assignments decide that match — and those links feed the JobThai demand-alignment health driver.

- [ ] **Step 3: Keep the existing guidance visible**

Leave the existing "approve narrow fields first" guidance in place. It applies with more force now: the vocabulary is larger and a broad field concentrates thousands of unrelated adverts onto a handful of programmes.

- [ ] **Step 4: Verify**

Open `http://localhost:3000/admin/job-fields`, find a field whose synonyms came only from government text, and confirm the warning appears. Find one with mixed synonyms and confirm both marks appear.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/job-fields
git commit -F - <<'EOF'
feat(admin): show which source contributed each synonym

Approving a field is not cosmetic. Since jobthai-bridge.v3 an APPROVED
field's assignments decide which programmes a posting asks for, and those
links feed jobthai_demand_alignment, a Council-facing health driver weighted
0.75 inside relevance.

A reviewer approving a field built entirely from government text is therefore
changing how JobThai adverts are matched, which is not obvious from the
field's name. Now it says so.
EOF
```

---

### Task 15: Documentation

**Files:**
- Create: `docs/data-sources/job-108.md`
- Modify: `docs/methodologies/gap-map.md`
- Modify: `apps/web/app/changelog/page.tsx`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the source spec**

`docs/data-sources/job-108.md`, following the shape of `docs/data-sources/jobthai.md`: what the source is; the measured facts table from the spec **updated with the real backfill numbers**; the robots.txt position and the identifying user-agent; the extraction prompt and its version; what is deliberately not captured (occupation classification); the PDPA posture; and a session log with today's date.

- [ ] **Step 2: Add the two-basis section to the methodology**

A new section in `docs/methodologies/gap-map.md` covering: the two bases and the default; why the supply side does not move; why each basis needs its own denominator; the unit decision and why seats are not weighted; the window and why it is a parameter; and **the calibration result from Task 9 as a table**. Cross-reference it from the existing demand section.

Also record, in §14, that the cohort-completeness and minimum-context-floor questions remain open and are untouched by this change.

- [ ] **Step 3: Decide the version stamp**

Check whether v1.9.7 has been deployed to production:

```bash
grep -n "GAP_MAP_VERSION" packages/db/src/gap-map-rules.ts
```

- If v1.9.7 is **still undeployed**, leave `gap-map.v1`. Add a line to the methodology saying the two-basis rule was part of v1's definition and the map had not shipped.
- If v1.9.7 **has been deployed**, change it to `gap-map.v2`, and add a section stating what moved and that figures computed under v1 are private-basis only.

This is the rule already written down, not a fresh judgement: a version identifies the formula a *published* figure was computed under.

- [ ] **Step 4: Changelog**

Add an entry for this release. While you are in the file, **fix the two stale figures in the existing v1.9.7 entry**: it says the graduate total moved "from 2,682 to 7,050" when the shipped figure is 6,958.6, and that the paper "gains a new section 4.8" when `929780a` moved it to §6. Both are user-facing and both are wrong today.

- [ ] **Step 5: Update CLAUDE.md**

Add a "Recent decisions" entry recording: the five decisions and their measured basis; that the map now reads two sources with `all` as the default; the calibration result; the version-stamp outcome; and the two things that remain deliberately unchanged — the gap verdict still does not feed the health score, and government rows create no occupation or programme links.

- [ ] **Step 6: Final verification**

```bash
cd /home/denpong/projects/program-landscape
pnpm -r typecheck
pnpm test
grep -rcP '\x00' packages/db/src/gap-map.ts packages/shared/src/job108/*.ts apps/ingestion/src/job108/*.ts
```

Expected: typecheck exit 0 on all packages; the full suite green; zero NUL bytes. Do **not** run `pnpm check` and read its failure as yours — it exits at the lint step on a pre-existing 171-error backlog. Confirm instead that `pnpm lint` reports no *new* errors in files this work touched.

- [ ] **Step 7: Commit**

```bash
git add docs/data-sources/job-108.md docs/methodologies/gap-map.md apps/web/app/changelog/page.tsx CLAUDE.md
git commit -F - <<'EOF'
docs: record the public-sector demand source and what it measured

gap-map.md gains the two-basis rule, the unit decision, the window and the
calibration table. It is the authority on every figure on /gap-analysis, so
the numbers go there first and everything else cites it.

Also corrects two stale user-facing figures in the existing v1.9.7 changelog
entry: the graduate total reads 6,958.6, not the intermediate 7,050, and the
paper section is §6, not 4.8.
EOF
```

---

## Deployment notes

Not part of the plan's tasks — hand these to the operator.

1. **Order matters.** Deploy, then run the backfill, then rebuild the taxonomy, then review. The map shows no public demand until the backfill runs, and no rows at all on a fresh database until the taxonomy is built.
2. **The backfill on prod** is `docker compose exec -T ingestion node /app/dist/scripts/job108-backfill.js` — dry run first (free), then `--apply` (~$27, ~70 minutes at 2 s spacing). It is resumable, so an interrupted run continues.
3. **Rebuild the taxonomy afterwards** with `pnpm jobthai:fields` — dry run (~$0.26, and this one is *not* free) then `--apply`. Government strings only enter the vocabulary on a rebuild.
4. **Then review at `/admin/job-fields`**, narrow fields first.
5. **No new environment keys, no new buckets, no compose changes.** The connector needs no credentials.

---

## Self-review notes

Checked against the spec, section by section: transport (Task 7), unit (Tasks 5–6), window (Tasks 11–12), extraction and calibration (Tasks 5, 7, 9), taxonomy (Tasks 10, 14), architecture and failure isolation (Task 7), data model (Task 2), gap map (Tasks 11–13), scheduling (Task 3), cost (Task 8's dry-run output), PDPA (Task 7's scrub test), version stamp (Task 15), testing (distributed), out of scope (nothing in any task touches the health score or the occupation layer).

One thing the spec said imprecisely and this plan corrects: the spec describes extraction as recorded "through `@AiCall`". That decorator is the api-side mechanism; in ingestion the equivalent is `extractStructuredWithParseRetry` over the `AiService` built by `createIngestionAiService()`, whose recorder writes the `AiInference` row. Same audit trail, different entry point. Tasks 7 and 9 use the ingestion mechanism.
