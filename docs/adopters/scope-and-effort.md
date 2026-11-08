# Scope and effort

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/adopters/scope-and-effort.md)

**Outcome.** You know what the repository does not give you and can plan the work in order, with effort estimates.

## What you are NOT getting

Be clear-eyed about this before you plan. You are receiving source code and documentation. You are not receiving:

| Not included | Consequence |
|---|---|
| **KKU's data** | No student, staff, financial, research, evaluation, or outcome records. Every analytical surface starts empty |
| **Credentials** | No database passwords, API keys, SSO client secrets, or service accounts. The `.env.example` values are placeholders |
| **The 297-programme master sheet** | KKU's curated programme list, with MHESI codes and sequence numbers. You must build your own equivalent |
| **KKU's curriculum PDFs** | 228 documents. Yours to source |
| **KMITL Skill Mapping credentials** | You must request your own client ID and secret key from KMITL |
| **Scopus / Elsevier API keys** | Institutional subscription; via your library |
| **Ranking subscriptions** | THE, QS, SCImago, IMD |
| **KKU's DPO approval** | Not transferable. See [PDPA and governance](./pdpa-and-governance.md) |
| **Council-specific methodology weightings** | The health-score weights encode KKU Council positions. See [Adapt a methodology to your institution](../guides/adapt-a-methodology.md) |
| **KKU's trademarks and visual identity** | The name, crest, and logos are reserved, not licensed. You must rebrand. See [Licence — CC BY-NC-SA 4.0](./README.md#licence--cc-by-nc-sa-40) and [Rebrand the platform](../guides/rebrand.md) |
| **A ruling on what "NonCommercial" permits you** | KKU has not published an interpretation. Get your intended use confirmed in writing. See [Licence — CC BY-NC-SA 4.0](./README.md#licence--cc-by-nc-sa-40) |

### Things in the repository that are unfinished, and you inherit as unfinished

Honesty here is worth more than a clean-looking feature list:

- **The AUN-QA criteria list is unverified.** `packages/shared/src/aunqa/criteria.ts` carries an explicit provenance warning in its own header: the criteria were written from an AI assistant's knowledge of AUN-QA v4, **no AUN-QA guide exists in the repository**, and nothing has been checked against the published document. Two of the criteria (Student Support Services, Facilities & Infrastructure) have no data in the platform at all and are listed separately so a reader cannot mistake six criteria for the whole framework. Further: of three KKU curricula sampled, the QA framework each declares is WFME or TQF — **none names AUN-QA**. Organising evidence along AUN-QA is an analytical overlay, not a claim the source documents make. **Verify against the official guide before this touches any accreditation submission.**
- **Cost allocation is v0** and no per-programme cost figure is Council-facing. See [Adapt a methodology to your institution](../guides/adapt-a-methodology.md).
- **`kku-alumni` has no real connector**, so graduate outcomes and province-level supply are not wired at KKU either. The regional gap analysis renders with an explicit deferred note on the supply side.
- **The Thailand map is schematic, not a true choropleth** — six regional blocks with intensity colouring, because per-province graduate data does not exist yet.
- **`Release bundle` CI is red** on a pre-existing repo-wide lint backlog.
- **Five catalog entries are deprecated** (`kku-tcas-funnel`, `jobthai`, `jobsdb`, `scopus`, `openalex`) and retained only so historical `IngestionRun` rows do not orphan. Do not wire them.
- **Storybook is configured but has no stories.** `/styleguide` in the web app serves the visual-contract purpose instead.
- **A per-template export-reason dialog** — the `@RequireExportReason` decorator and `DataExportGuard` are scaffolded but no live route uses them (gate 8 of the readiness checklist is satisfied at the infrastructure level, not the UI level).

## Suggested order of work, with effort estimates

Estimates assume one or two competent full-stack developers who have not seen this codebase, and include the time spent waiting for access to institutional systems — which is usually the critical path.

| Phase | Work | Estimate |
|---|---|---|
| 0 | **Confirm your intended use is within CC BY-NC-SA's NonCommercial term, in writing from KKU.** Blocking if your use is anywhere near commercial | Days to weeks, not yours to control |
| 1 | Local instance running; fork configured with upstream; read `CLAUDE.md`, `architecture.md`, `evaluation-pipeline.md` | 3–5 days |
| 2 | Rebrand; fork `CLAUDE.md`; claim `/setup`; upload your faculties and departments | 1 week |
| 3 | Upload your programme list with MHESI codes, then whichever metric spreadsheets you already hold (enrolment, finance, staff, programme teaching staff, publications) | 1–2 weeks (data-gathering, not code) |
| 4 | Start institutional access requests for **everything** in parallel — registrar, HR, finance, UniCon, evaluations | Start on day one; expect 4–12 weeks to resolve |
| 5 | First UniCon connector (DS2001 or DS2004) | 1–3 days once access exists |
| 6 | Remaining three UniCon connectors | 1 week |
| 7 | Tier 2 external sources — KMITL, TCAS, World Bank, policy report feeds | 1–2 weeks, credential-bound |
| 8 | Programme PDF acquisition and the digest pipeline | 2–4 weeks; document acquisition dominates |
| 9 | First Tier 3 rewrite (registrar — highest leverage), replacing the matching spreadsheet uploads | 2–4 weeks |
| 10 | Remaining Tier 3 connectors as priority dictates | 2–4 weeks each |
| 11 | Methodology adaptation with your Council or equivalent body | 2–4 weeks, mostly institutional not technical |
| 12 | SSO integration; production deployment; network team engagement | 2–3 weeks |
| 13 | DPO review and sign-off | Parallel with everything; start early |
| 14 | 30-day green-history window per connector before Council-facing use | 30 days, unavoidable, plan for it |

**A realistic first-useful-output milestone is four to six months if you go connector-first**, dominated by data access and document acquisition rather than engineering. **With spreadsheet uploads it is weeks**: phases 2–3 give you a populated cockpit and deep-dive from data your offices can already export, and phases 4–10 then replace manual uploads with automation rather than standing between you and a first result. The engineering is largely done; what you are buying with this codebase is those months, not the ones after.

**Sequencing advice that matters more than the estimates:** start every access request in week one, before you write any code. A connector is one to three days of work and eight weeks of waiting for a service account. Order the queue by that fact.

## Next step

Continue with [Architecture](../architecture.md).
