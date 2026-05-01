# KMITL Skill Mapping

**Slug:** `kmitl-skill-mapping` · **Phase:** B · **Kind:** API · **Cadence:** `0 6 * * 1` (weekly Monday 06:00) · **Status:** 🚧 mocked (Phase A scaffolded 2026-05-01)

---

## What it is

Aggregated skill-demand intelligence built and curated by **King Mongkut's Institute of Technology Ladkrabang (KMITL)** from three input streams: LinkedIn profiles, Thai job-postings, and university graduate records. Exposed via a REST API (`https://skill.kmitl.ac.th/api/v1`) to authorized institutional partners — KKU has access via the institutional partnership.

**Replaces** the original prompt-14 plan to ingest JobThai + JobsDB directly. Trade-offs:

- ✅ No per-posting raw records — we get **percentages at career/group/sub-group level**, dramatically simpler PDPA posture
- ✅ Includes built-in **skill growth rates** (`skills_growth_overview`) — skill-level trend signal we'd otherwise compute ourselves
- ✅ Includes **industry composition** + **university composition** per career — feeds Sector model + Benchmarking peer comparison
- ❌ No salary information (loss vs JobThai/JobsDB)
- ❌ No province granularity (only global vs Thailand)

## Access

| | |
|---|---|
| URL / endpoint | `https://skill.kmitl.ac.th/api/v1` |
| Auth | Bearer token. Method 1 (server-to-server): `base64(clientId:secretKey)`. Method 2 (browser): 5-min ephemeral hash-derived token. We use Method 1 — see `packages/shared/src/ingestion/kmitl-token.ts`. |
| Credentials env vars | `KMITL_SKILL_MAPPING_BASE_URL`, `KMITL_SKILL_MAPPING_CLIENT_ID`, `KMITL_SKILL_MAPPING_SECRET_KEY` |
| Rate limits | Not published. Connector throttles to 5 req/s (200ms sleep between requests) — same posture as kku-research's polite-pool throttle |
| Concurrency we'll use | Single-threaded |
| Request timeout | 30s per request |
| Data residency | Thailand (KMITL's servers, IP `161.246.127.161`). No cross-border transfer concerns. |

## Data shape (real source)

Eight read-only `GET` endpoints, all returning JSON. No body, no query parameters.

| Endpoint | Returns |
|---|---|
| `/` | Welcome message + version (smoke test) |
| `/groups` | Flat list of career groups: `[{ id, name }]` |
| `/groups/{id}` | Full group payload (sub-groups, skills overview, growth, industries, universities, both global + Thailand variants) |
| `/groups/{id}/{subId}` | Same shape as group, scoped to one sub-group |
| `/career` | Flat career list: `[{ id, name, sub_groups[], groups[] }]` |
| `/career/{id}` | Per-career skill mix, growth, industries, universities, global + Thailand |
| `/skills` | Skill master list: `[{ id, name }]` |
| `/industries` | Industry master list: `[{ id, name }]` |
| `/universities` | University master list: `[{ id, name }]` |

The richest payloads are the group + career detail endpoints. They each return:

```jsonc
{
  "id": 101,
  "name": "...",
  "skills_overview":            [{ "group": "...", "skill": "...", "amount": 1240, "percentage": 78.4 }],
  "job_posts_overview":         [{ "group": "...", "skill": "...", "amount": 980,  "percentage": 62.0 }],
  "common_skills_overview":     [{ "skill": "...", "amount": 720,  "percentage": 45.6 }],
  "skills_growth_overview":     [{ "skill": "...", "percentage": 38.2 }],
  "industries_overview":        [{ "industry": "...", "percentage": 25.4 }],
  "universities_overview":      [{ "university": "...", "percentage": 12.8 }],
  "counts":                     { "sample": 12345, "sample_th": 4567, "job_posts_sample": 8910, "job_posts_sample_th": 3456 },
  // Plus `thailand_*` mirrors of every array (Thailand-only subset)
}
```

Notable gotchas:

- The PDF guideline (1.9.1-OBT, dated 2024-02-01) is the design reference. Real responses may have drifted; the discovery script (`pnpm kmitl:capture all`) is the source of truth.
- Skills are returned as **free-text names** (`"Python"`, `"AI/ML"`, `"PLC"`) — no stable ID to our `Skill` table. Connector resolves via case-insensitive exact match against `Skill.nameEn`/`nameTh`; unmatched names land with `skillId = NULL` and the raw name in `KmitlCareerSkillDemand.skillNameRaw` for analyst triage.
- `id` fields on careers/groups/skills/industries/universities are **integers**, stable across calls but specific to KMITL's taxonomy (no ISCO-08, no ESCO crosswalk).
- Confidential per the API guideline: do not redistribute the API responses or the API documentation outside the project.

## Mapping to our schema

Three new dedicated tables (additive migration `20260501120000_kmitl_skill_mapping`). Not overloaded into `OccupationDemand` because (a) KMITL careers aren't ISCO-08, (b) values are percentages not counts, (c) data lineage stays obvious for the Council provenance drawer.

| Source field | Our target | Table | Notes |
|---|---|---|---|
| `careers[].id` | `kmitl_career_id` (UNIQUE) | `KmitlCareer` | Stable upstream id |
| `careers[].name` | `career_name` | `KmitlCareer` | |
| Group/sub-group context | `group_name`, `sub_group_name`, `kmitl_group_id`, `kmitl_sub_group_id` | `KmitlCareer` | |
| `skills_overview[]` (`source = profiles`) | one row per (career × skill × scope × source) | `KmitlCareerSkillDemand` | `dataSource = PROFILES`, `dataScope = GLOBAL` |
| `thailand_skills_overview[]` | same | `KmitlCareerSkillDemand` | `dataScope = THAILAND` |
| `job_posts_overview[]` | same | `KmitlCareerSkillDemand` | `dataSource = JOB_POSTINGS`, `dataScope = GLOBAL` |
| `thailand_job_posts_overview[]` | same | `KmitlCareerSkillDemand` | `dataSource = JOB_POSTINGS`, `dataScope = THAILAND` |
| `skills_growth_overview[]` | one row per (context × skill × scope) | `KmitlSkillGrowth` | context is `'group' \| 'sub_group' \| 'career'` |
| `industries_overview[]`, `universities_overview[]`, `counts` | `KmitlCareerSkillDemand.metadata` (JSONB) | — | Promote to dedicated tables only if downstream consumers need them |

Skill resolution: exact match on `Skill.nameEn` (lowercased + trimmed); fallback `Skill.nameTh`; unmatched → `skillId = NULL`. Sample of unmatched names surfaced via `IngestionRun.metadata.unmappedSkillSamples` for analyst triage. Same pattern as kku-finance unmapped divisions, kku-research unmatched authors.

## Backfill plan

- **Horizon**: KMITL doesn't publish snapshot history; the API exposes only the *current* aggregate. We snapshot weekly via the cron and accumulate our own time-series in `KmitlCareerSkillDemand.snapshotAt` and `KmitlSkillGrowth.snapshotAt`.
- **Chunking**: One run = one full crawl of all groups + careers. Wall-clock estimate: 5–10 min depending on group count (~50 groups × 200ms throttle).
- **Sanity check**: total `KmitlCareerSkillDemand` row count per run should be stable within ±5% week over week (i.e., we expect the taxonomy to be slow-changing). Drift greater than that triggers a data-quality alert.

## Monitoring after go-live

Specific failure modes to alert on:

- 401/403 — token compromised or revoked. Per KMITL guideline: notify their team to revoke + reissue.
- 5xx burst — upstream outage; connector retries 3x with backoff.
- Schema drift — Zod validation errors on the response body. Fixture in `apps/ingestion/test/fixtures/kmitl-skill-mapping/` is the version-controlled reference.
- Career count drops by >25% week-over-week → silent data loss upstream.
- New unmapped skill names spike (>50 per run) → analyst review batch.
- Generic per-source: freshness > 2× cadence (>2 weeks since last success); error rate > 10%.

## Contact

| Role | Person | Contact |
|---|---|---|
| Owning division | KMITL — Skill Mapping team | (issued credentials directly to KKU partnership) |
| KKU technical contact | denpong@kku.ac.th (this project) | — |
| Escalation | KKU ↔ KMITL institutional liaison | TBD before prod flip |

## PDPA posture

- **Personal data categories collected:** *none*. API contract is aggregate-only — percentages and counts at career/group/skill level. No per-person fields, no employer names.
- **Legal basis (PDPA §24):** §24(4) — legitimate interests of KKU governance + planning. KMITL has obtained primary consent / legal basis from data subjects (LinkedIn ToS + job-poster public-by-context).
- **Retention:** indefinite for aggregate snapshots (necessary for time-series demand analysis).
- **Cross-border transfer:** *no* — KMITL is Thailand-resident (server IP `161.246.127.161`).

The discovery script (`apps/ingestion/src/scripts/capture-kmitl-skill-mapping.ts`) enforces a no-PII guard before any fixture is written: any object key matching `/email|phone|address|tax_id|citizen|passport/i` aborts the capture.

## Known issues

A running log as the integration lands + matures. Date each entry.

- *(none yet — Phase A scaffolded 2026-05-01)*

## Session log

- `2026-05-01` — kickoff: chose KMITL Skill Mapping API as substitution for jobthai + jobsdb. PDF manual at `/home/denpong/skillmapping.pdf` (do NOT commit — confidential per KMITL header).
- `2026-05-01` — Phase A landed: schema (`KmitlCareer`, `KmitlCareerSkillDemand`, `KmitlSkillGrowth`), catalog entry, real-connector stub, auth helper, discovery script scaffold, jobthai/jobsdb deprecated.
- `YYYY-MM-DD` — Phase B: credentials added, `pnpm kmitl:capture all` run, fixtures committed.
- `YYYY-MM-DD` — Phase C: real fetch/transform/load implementation, ≥3 green runs.
- `YYYY-MM-DD` — Phase D: health-score demand dimension lit up, gap-analyzer kmitl source default.
- `YYYY-MM-DD` — 30-day green-history gate cleared (per `docs/readiness-checklist.md` gate 11).
- `YYYY-MM-DD` — promoted to prod.
