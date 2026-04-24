# Rollout plan — Program Landscape

Phased rollout to the University Council and supporting administrative tiers. Designed to catch issues in front of a friendly audience before the system enters the Council chamber.

---

## Guiding principles

1. **Bring one faculty live at a time.** The full Program Landscape is accurate *once all faculties' data is curated*. Until then, partial views create pressure to draw conclusions from incomplete data.
2. **Dean-first, then Council.** Deans are the technical audience. Feedback from them refines the app before Council sees it.
3. **Pair every rollout with a training session.** 30-minute hands-on walkthrough beats a written guide for executive audiences.
4. **Surface confidence everywhere.** If a module shows < 80% data completeness at a given scope, badge it as "preview" — we're not hiding the gaps.

---

## Phase 0 · Stabilisation (weeks -4 to 0)

**Audience:** IT + analysts + tech-forward deans (3-4 people).

**Scope:**
- Deploy to staging infrastructure.
- Seed all 297 programs from the Cabinet Resolution's `มคอ.2` PDFs using the Gemini-backed extractor.
- Run `/admin/data-quality` weekly — push completeness > 80% on enrollment + financial metrics.
- Nightly `pnpm ai:eval` must pass with 0 regressions.
- Restore drill executed + signed off by KKU IT (see `docs/backup-dr.md`).

**Exit criteria:**
- All 8 modules have non-trivial data on at least 5 faculties.
- `/api/v1/ready` returns 200 for 7 consecutive days.
- PDPA sign-off from KKU DPO.
- 4 user guides reviewed by the target audience.

---

## Phase 1 · Dean pilot (weeks 1-4)

**Audience:** Deans of 3 faculties (Engineering, Business, Agriculture) + their program managers.

**Scope:**
- Production deploy (`program-landscape.kku.ac.th`).
- 2-hour onboarding workshop per faculty (live demo + Q&A).
- Weekly office hours with the analyst team.
- Feedback loop: deans submit a weekly Disagree-button-based issue list.

**What we watch:**
- Login success rate (SSO gremlins are the #1 risk).
- AI call volume + cost (quota calibration).
- Disagree rate per module — if > 20% of outputs get flagged, the module goes back for prompt tuning.

**Exit criteria:**
- 3 faculties actively using the app (≥ 5 sessions/week per faculty).
- No P1 incidents in 2 weeks.
- Dean acceptance letter signed.

---

## Phase 2 · Full executive rollout (weeks 5-8)

**Audience:** All VPs + all Deans + all Department Heads (~60 users).

**Scope:**
- Training modules delivered to each audience tier (live for VPs; recorded for DEPT_HEAD).
- `/changelog` page highlighting recent feature additions.
- First-run wizard for new users — role-appropriate tour covering the 3 modules they'll use most.
- Weekly status email to all executives (automated from `/admin/system-status`).

**What we watch:**
- AI cost (expect a 2-3x spike as users experiment).
- DSAR requests (expect a couple from faculty members checking their data).
- Performance — p95 latency on cockpit load must stay < 2s.

**Exit criteria:**
- All 19 faculties have at least one user actively using the app weekly.
- No P1 or P2 incidents in 2 weeks.

---

## Phase 3 · Council introduction (weeks 9-12)

**Audience:** University Council (~25 members) + Council Secretariat.

**Scope:**
- Council Secretariat trained on Council Pack generation.
- First Council meeting uses the app for one agenda item (pilot); the rest of the agenda continues in traditional format.
- Council members receive a one-page Thai-language quick-start (`docs/guides/council-th.md`).
- Dedicated on-call IT support during Council week.

**What we watch:**
- Council-session reliability — zero tolerance for P1 during a meeting.
- Provenance usage — are members actually clicking through to confirm data sources? Tracked via `AuditLog.action='provenance.view'`.
- Post-meeting survey of Council members.

**Exit criteria:**
- One full Council meeting completed using the app for all agenda items.
- Council President signs off on ongoing use.

---

## Phase 4 · Steady state (month 4+)

- Monthly Ops review (disk / AI cost / regressions).
- Quarterly restore drill.
- Annual PDPA sign-off.
- Continuous 8-module feature evolution on a 2-week sprint cadence.
- Annual methodology audit — rerun every `methodologyVersion` against historical data to check for silent drift.

---

## Rollback triggers

Any of these flip the app back to "analyst-only view" while we fix:

- **AI governance incident** — an AI output reaches Council Pack with a provably wrong fact that would change a decision.
- **PDPA breach** — personal data exposed outside the audit envelope.
- **> 2 P1 incidents in a week.**
- **Disagreement rate > 30% on any module for 2 consecutive weeks.**

---

## Training materials

- **Council members** (Thai, visual) — `docs/guides/council-th.md`.
- **VPs + Deans** (English, detailed) — `docs/guides/executive.md`.
- **Analysts** — `docs/guides/analyst.md`.
- **Admin + IT Ops** — `docs/guides/admin-runbook.md`.
- **Live workshops:** 2-hour deans onboarding, 30-min Council members briefing, full-day analyst deep-dive.

---

## Success metrics

At the end of Phase 4 (month 6 from launch):

- ≥ 80% weekly active rate among Deans.
- ≥ 50% of Council members view the Council Pack in-app (vs. only printed).
- ≥ 20 Council decisions recorded in the workspace, all with snapshot + at least one outcome review.
- AI cost ≤ $500/month.
- Zero PDPA incidents.
- At least 3 methodology versions shipped (evidence we're learning from real use).
