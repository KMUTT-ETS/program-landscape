# Prompt 14 — Real Data Integration (Parallel Workstream)

> **When to use:** After mock system is working end-to-end (typically after prompt 12). Run as a series of focused mini-sessions, one connector at a time.
>
> **Skills to invoke per integration:** `pdf-reading` for PDF-based sources; otherwise none specific.

---

The system runs on mocks. Now wire real data sources, one at a time. Do NOT try to do this all in one session — each integration is its own mini-project with its own quirks.

## Integration approach (per source)

For each data source, follow this rhythm:

1. **Survey the real source** — read documentation, get credentials, understand the data shape
2. **Write integration spec** in `docs/data-sources/<source-name>.md`: API endpoints / file formats / auth method / rate limits / data quality issues / contact person at owning org
3. **Replace the mock connector** with the real connector implementation
4. **Map the real data shape** to our normalized schema; document mismatches
5. **Test on a small slice** (1 day, 1 program, 1 region) before full sync
6. **Run a backfill** for historical data
7. **Set up monitoring** for the source's specific failure modes
8. **Update CLAUDE.md** with the integration's status and any operational notes

## Priority order (suggested)

### Phase A — Internal KKU systems (highest leverage; you control these)

1. **KKU Registry (REG)** — programs, courses, enrollment funnel
   - Likely SQL Server or Oracle backend; may need a read replica or middleware API
   - Watch for: course code changes over time, programs that have been renamed, archived programs
2. **KKU Finance** — revenue, expenses
   - Cost methodology likely doesn't exist at program level; this triggers the Phase 0 cost model effort
   - Get Finance Division as a project stakeholder before integration
3. **KKU HR** — faculty roster, ranks, qualifications, dates
   - PDPA-sensitive — minimum data principle, audit access
4. **KKU Alumni** — graduate outcomes from existing surveys
   - Survey data is often partial; document sample sizes
5. **KKU Research Affairs** — research outputs (then cross-reference Scopus/OpenAlex)
6. **MHESI-CISA** — your existing system; should be straightforward
7. **Thailand Digital Transcript** — your existing infrastructure; major asset for skill-level data

### Phase B — National Thai sources

8. **NSO labor force survey** — mostly PDF; route through PDF pipeline
9. **TPQI occupational standards** — mix of PDF and API
10. **TCAS / ทปอ. score data** — mix of PDF and Excel
11. **JobThai or JobsDB** — requires an access agreement; budget concern; OK to start with one and expand
12. **MHESI policy publication monitor** — RSS or scrape; routes new PDFs to pipeline
13. **NESDC, NXPO, BOI, EECO** — bulk-load last 24 months of PDFs through the PDF pipeline as a one-time batch, then add monitor for new ones

### Phase C — Regional and international

14. **OpenAlex** — free; covers research output well; replace Scopus mock
15. **WEF Future of Jobs reports** — annual; PDF
16. **OECD / World Bank labor data** — APIs available
17. **Peer university scraping** — tedious; consider hand-curating top 20 ASEAN peers manually first, then automate
18. **Lightcast or LinkedIn Economic Graph** — paid; defer until budget is clear

## For each integration session, use this prompt template

```
Read CLAUDE.md and GLOBAL-UPDATES.md.

I'm wiring the real <SOURCE NAME> integration today.

Background:
- Current mock connector: apps/ingestion/src/connectors/<file>.ts
- Real source: <description, URL, owning org>
- Access method: <API / scrape / PDF / extract>
- Credentials I have: <env vars set>
- Data shape: <brief description, link to spec doc>

Tasks:
1. Read the existing mock connector and the schema it normalizes to.
2. Read the integration spec at docs/data-sources/<source>.md (create if not exists; ask me for details if missing).
3. Implement the real connector preserving the same Connector interface.
4. Add necessary env vars to .env.example with documentation.
5. Run a small test fetch (just 1-100 records).
6. Show me the raw response shape vs our normalized shape — flag any mismatches before doing the full implementation.
7. Once I approve, complete the load + the historical backfill plan.
8. Add monitoring: connector-specific health checks, alert thresholds.
9. Update CLAUDE.md "Current status" with this integration done.
10. Commit with conventional message.

Skill to invoke for this session: <pdf-reading if PDF source, else skip>

Important constraints:
- Do not delete the mock connector yet; rename it to <Name>MockConnector and keep alongside the real one. The mock is useful for tests forever.
- Add a feature flag (env var) to swap between mock and real per environment.
- Document any data quality issues encountered in docs/data-sources/<source>.md.
- If real data shape doesn't fit our schema, propose a schema change as a separate PR — don't silently denormalize.
```

## Cost-model sub-project (special handling)

This deserves its own dedicated workstream, not a single integration session.

The KKU Finance integration will likely surface that program-level cost data doesn't exist cleanly. You'll need to build an **activity-based costing model** that allocates:
- Direct teaching cost (faculty time × hourly rate × course load)
- Allocated facility cost (room utilization, lab depreciation)
- Allocated research support cost
- Allocated administrative overhead
- Allocated student services

Recommended approach:
1. Form a small joint team with Finance Division (2-3 people)
2. Pick 5 sample programs across faculties (different sizes, different fields)
3. Manually compute cost for those 5 programs using available data
4. Document the methodology in `docs/methodologies/cost-allocation.md` with version 1.0
5. Get Finance Division to formally approve the methodology
6. Implement the methodology in code (new `CostAllocationEngine` service)
7. Backfill 3 years for all 297 programs
8. Sanity-check against any existing department-level cost data
9. Iterate methodology to v1.1, v1.2, etc. based on feedback
10. Council reviews and accepts the methodology before any decisions are made on it

This is likely a **2-3 month effort** independent of the app build.

## PDF source bulk loading

After PDF intake pipeline is real (prompt 03b done), do a one-time bulk load:

```
Read CLAUDE.md.

I want to bulk-load historical policy and report PDFs from these sources:
- MHESI: <URL pattern or list>
- NESDC: <URL pattern or list>
- NXPO: <URL pattern or list>
- BOI: <URL pattern or list>
- EECO: <URL pattern or list>
- WEF Future of Jobs: <annual reports list>

Tasks:
1. Build a one-time bulk loader script in apps/ingestion/src/scripts/bulk-pdf-load.ts.
2. For each source, generate a list of URLs to fetch (last 24 months).
3. Show me the list before downloading — let me approve.
4. Download with respectful rate limits (~1 req/2s per source).
5. Push each through the PDF pipeline.
6. Report at the end: how many succeeded, how many in review queue, how many failed.
7. Do not commit downloaded PDFs to git (add to .gitignore); they live in MinIO.

Skill to invoke: pdf-reading
```

## Monitoring after real data is live

Add to admin dashboard:
- Per-source freshness — alert if any source > 2x its expected cadence without sync
- Per-source error rate — alert if > 10% of records fail validation
- PDF extraction queue depth — alert if > 100 pending review
- AI cost per day per module — alert if 7-day moving average increases > 25%
- Data drift detection — alert if newly arrived data shows >50% deviation from historical patterns (could indicate broken upstream)

## Checklist for "ready for Council use"

Before showing this system to actual Council members:

- [ ] At least KKU REG, Finance, HR, Alumni integrated (Phase A items 1–4)
- [ ] Cost methodology approved by Finance Division
- [ ] At least 200 historical PDFs loaded and processed
- [ ] At least 90 days of real job posting data
- [ ] At least one peer comparison set with real data
- [ ] All Council-facing UI tested in both light + dark
- [ ] At least one Council member did a usability walkthrough
- [ ] Methodology docs reviewed by relevant deans
- [ ] AI governance doc reviewed by KKU's AI ethics body (if exists; create one if not)
- [ ] PDPA compliance review complete
- [ ] Disaster recovery drill done
- [ ] Two analyst-level users trained as operators
