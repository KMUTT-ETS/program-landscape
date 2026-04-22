> **GLOBAL UPDATES APPLY:** Before this prompt, read `GLOBAL-UPDATES.md` and `CLAUDE.md`. Apply all cross-cutting requirements: multi-level scope (university/faculty/department/program), English UI labels with Thai analysis content, light/dark theme support, modern SaaS UX patterns, KKU SSO auth, PostgreSQL DB, PDF as primary external data input, and Council-readiness rules.
>
> **Skills to invoke:** `frontend-design`, `pdf-reading` (for peer brochure parsing)
>
> ---
>
# Prompt 10 — Module 6: Competitive Benchmarking

> **When to use:** After scenarios. Positions KKU programs against peers — Thai, ASEAN, global.

---

Build the **Competitive Benchmarking** module — module 6 of 8.

### Page (`/benchmarking`)

**Top: peer set selector**
- Saved peer sets (Thai top-10, ASEAN top-20, Global subject leaders, Custom)
- Per-program: auto-suggested peers (based on subject + ranking + region)
- Per-faculty: peer faculties at peer institutions

**Center: comparative views**

1. **Portfolio comparison**
   - KKU vs each peer institution: program count, subject distribution, level distribution
   - "What they have we don't" white-space list
   - "What we have they don't" distinctive list

2. **Subject leadership**
   - For each subject area: world ranking trend (THE/QS/SCImago)
   - KKU's percentile vs peer set
   - Research output gap

3. **Program-level comparison** (`/benchmarking/programs/:id`)
   - Side-by-side curriculum structure vs up to 5 peer programs
   - Credits, required vs elective ratio, signature courses, capstone, internship
   - Faculty composition comparison
   - Outcome comparison (employment, salary) where data available

### Peer data acquisition (note: this is data-intensive)

**Connectors needed (most can be mocked initially):**
- `THERankingsConnector` — Times Higher Education subject rankings
- `QSRankingsConnector` — QS subject rankings
- `SCImagoConnector` — research-based rankings (free)
- `OpenAlexConnector` — research output (already from prompt 03)
- `PeerProgramScraperConnector` — generic scraper for peer university program pages, with manual curation queue for messy results

Mock data should include realistic peer programs for at least 5 KKU subject areas.

### AI layer
- For each KKU program: suggest peers based on description similarity (vector search over `PeerProgram.embedding`)
- Curriculum gap analysis: AI identifies what peer curricula contain that KKU's doesn't, and vice versa
- Distinctiveness scoring: how unique is this KKU program's curriculum vs the peer set?
- Strategic positioning brief: AI explains where KKU sits in the competitive landscape per subject

### White space detection
- Sub-page `/benchmarking/white-spaces`
- AI-curated list: programs that >3 peers offer but KKU doesn't
- Per white space: estimated demand, fit with KKU strengths, suggested launch path
- Cross-references to Gap Analyzer opportunities

### Council-readiness features
- Every comparison clearly labels data freshness (rankings published annually; some peer data may be stale)
- "Comparable basis" disclosure — explicitly note when comparison may be apples-to-oranges (e.g., different credit systems)
- Per-peer notes editable by analysts to capture context

### API endpoints
- `GET /api/v1/benchmarking/peer-sets`
- `GET /api/v1/benchmarking/portfolio?peerSetId=`
- `GET /api/v1/benchmarking/subjects`
- `GET /api/v1/benchmarking/programs/:id/peers`
- `GET /api/v1/benchmarking/white-spaces`
- `POST /api/v1/benchmarking/peer-sets` (create custom)
- `POST /api/v1/benchmarking/programs/:id/peers/suggest` (AI suggest)

### Tests
- Test peer suggestion via embedding similarity
- Test white-space detection logic
- Test ranking trend calculation

### Deliverables
- Working benchmarking with at least 3 KKU programs having full peer data
- White-space list with at least 5 entries
- 3 suggestions for next module — AI Analyst is next
