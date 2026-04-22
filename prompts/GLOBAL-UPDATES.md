# GLOBAL UPDATES — Cross-Cutting Requirements

> **Read this first, every session.** These requirements apply to every prompt in this set. Whenever a prompt references "the global requirements," it means this document.
>
> When you start a Claude Code session, paste this document or reference it. Add it to `CLAUDE.md` so every session inherits it automatically.

---

## 1. Multi-level analytical scope

Every analytical view, metric, chart, and AI insight must support **four scope levels**, switchable via a persistent scope selector in the top bar:

1. **University** (KKU as a whole — all 297 programs)
2. **Faculty** (e.g., Faculty of Engineering)
3. **Department** (e.g., Department of Computer Engineering)
4. **Program** (a single curriculum)

**Implementation rules:**
- Scope state lives in URL (`?scope=faculty&id=eng`) so views are shareable.
- All API endpoints accept `scope` and `scopeId` parameters.
- All aggregations roll up cleanly: program → department → faculty → university.
- Role-based access controls scope visibility:
  - `COUNCIL` / `EXECUTIVE` / `ANALYST` / `ADMIN`: all scopes
  - `DEAN`: full data for own faculty (and its departments/programs); aggregated only for others
  - Add a `DEPT_HEAD` role: full data for own department, read-only for own faculty
- The scope selector is a single component (`<ScopeSelector />`) in `packages/shared` — built once in prompt 02b, reused everywhere.
- AI Analyst (prompt 11) tools take `scope` arguments and respect them.

**Schema implication:** add `Department` model — see updated prompt 01.

---

## 2. Language strategy: English UI, Thai analysis content

A pragmatic split that matches how KKU's senior leadership actually works:

- **UI labels (menus, buttons, headers, form fields, error messages, navigation):** English only. Stable, technical clarity for the digital team.
- **Analysis content (AI-generated narratives, briefs, recommendations, summaries, explanations, scenario descriptions, trend signals, methodology notes):** Thai primary, with an "EN" toggle that triggers an on-demand English translation.

**Implementation rules:**
- Use `next-intl` only for the small set of analysis-content strings that are static. Most analysis content is dynamic (AI-generated) and stored Thai-first.
- AI generation prompts explicitly request Thai output for content; English on toggle calls a translation pass (cached).
- Data labels (program names, faculty names, course titles): store both `nameTh` and `nameEn`; display both where space permits, Thai primary where space is tight.
- Charts: axis labels in English (UI), data labels in Thai (content).
- All Council Pack PDFs default to Thai with optional English appendix.

**Out of scope:** No general TH/EN UI toggle. The UI is English-only.

---

## 3. Theming: light + dark mode

Required from day one.

- Use CSS variables for all colors, never hardcoded hex.
- Token system in `packages/shared/src/design/tokens.ts` with light + dark variants.
- Theme toggle in user menu, persisted per user (DB), with system-preference default.
- Every chart, every component, every PDF preview must work in both modes.
- Charts use a color palette that's accessible (WCAG AA) in both modes — verify with automated check.
- Built in detail in **prompt 02b**, then enforced everywhere.

---

## 4. Modern SaaS UI/UX

The visual benchmark is **Linear, Vercel, Stripe Dashboard, Retool, Notion** — not legacy university IT systems.

- Density-tunable layouts (compact / comfortable / spacious user setting)
- Command palette (Cmd/Ctrl+K) for navigation and search across everything
- Keyboard shortcuts everywhere with a discoverable shortcut sheet (?)
- Inline loading states (skeletons, not spinners) and optimistic UI for mutations
- Subtle motion (Framer Motion or CSS transitions, max 200ms, never gratuitous)
- Empty states that are helpful, not decorative
- Toasts for confirmations, never modals where a toast suffices
- Side panels (Linear-style) for detail views instead of full page navigation where appropriate
- Bulk actions on tables
- Saved views, filters in URL, shareable links to any state
- Responsive but desktop-first (Council members work on laptops/big screens)
- Use the **`frontend-design` skill** every UI session to enforce quality

---

## 5. Authentication: KKU SSO (next-auth)

Replace the generic OIDC placeholder with KKU SSO integration via next-auth.

- Use `next-auth` v5 with a configurable provider — KKU SSO is most likely OIDC-compliant; if it's CAS/SAML, use the appropriate community provider.
- Provider config driven by environment variables: `KKU_SSO_ISSUER`, `KKU_SSO_CLIENT_ID`, `KKU_SSO_CLIENT_SECRET`, `KKU_SSO_REDIRECT_URI`.
- On first SSO login, auto-provision the `User` row using KKU SSO claims (employee ID, email, name).
- Default role is `VIEWER` (lowest privilege); admin promotes from there.
- Map KKU faculty/department codes from SSO claims to our `Faculty`/`Department` records when available.
- Keep a fallback "credentials" provider for local dev only (disabled in production via env flag).
- Document the actual KKU SSO endpoint, claim mapping, and any quirks in `docs/auth/kku-sso.md` (you fill in real values when wiring).

---

## 6. PostgreSQL is the only DB

Already specified, but reinforce: no SQLite for tests, no MongoDB, no DuckDB. Use PostgreSQL with these extensions:

- `postgis` — regional analysis (provincial-level data)
- `pgvector` — embeddings for skills, jobs, policy docs, peer programs
- `pg_trgm` — fuzzy Thai/English search

All ORM access via Prisma. For analytical workloads (heavy aggregations), use raw SQL via Prisma's `$queryRaw` with Zod validation of results.

For local dev: PostgreSQL 16 in docker-compose. For tests: testcontainers spinning real PostgreSQL (not a mock).

---

## 7a. PDF generation: Gotenberg + TH Sarabun New (mandatory)

All PDF output (Council Packs, briefs, scenario packs, decision records, weekly digests, sectoral reports) is generated by a centralized service backed by **Gotenberg** with **TH Sarabun New** embedded.

- TH Sarabun New is Thailand's Cabinet-mandated standard font for official documents (Cabinet Resolution, 7 September 2010). 16pt is the standard body size.
- A custom Gotenberg Docker image (built in `infra/gotenberg/`) installs the four Sarabun weights system-wide so Chromium can embed them.
- All app code calls `PdfGenerationService` (built in **prompt 02c**) — no module generates PDFs directly with puppeteer, react-pdf, or any other in-process library.
- All PDFs use light theme regardless of the user's UI theme preference.
- Thai CSS rules: `font-size: 16pt`, `line-height: 1.5+`, `word-break: keep-all` (without this Thai breaks at character boundaries instead of word boundaries).
- Charts in PDFs are inline SVG, not images.

If you find yourself reaching for any other PDF library, stop — you are violating this rule.

## 7. PDF as primary external data input

Most external data sources for KKU's context come as PDFs:
- MHESI/NESDC/NXPO/BOI policy documents
- Annual labor force survey reports (NSO)
- Peer institution program brochures
- Industry/sector reports (BCG sectors, S-curve roadmaps)
- WEF / OECD / McKinsey reports
- Internal KKU committee reports, faculty meeting minutes
- Course syllabi (มคอ.2, มคอ.3) — though some are now in CHE-CHECO digital format

**Implementation requirement:** A robust PDF intake pipeline is a first-class feature, not an afterthought. Built in **prompt 03b** using the `pdf-reading` Claude skill.

The pipeline must handle:
- Native text PDFs (extract text directly)
- Scanned PDFs (OCR with Thai language support — use Tesseract with `tha` model, or a vision-capable LLM as fallback)
- Mixed PDFs (some pages scanned, some native)
- Table-heavy PDFs (NSO statistical tables, financial reports)
- Form PDFs (some surveys)
- Long PDFs (200+ page reports — chunk and process)
- Thai-language PDFs (the majority)

Output: structured records routed to the correct domain (policy doc, peer program, industry report, etc.).

---

## 8. Always invoke Claude skills

When starting a session, **always** invoke the relevant Claude skills (see `SKILLS.md`).

For UI sessions: use `frontend-design` (and `theme-factory` early on).
For PDF sessions: use `pdf-reading` (intake) or `pdf` (generation).
For document exports: `docx`, `pptx`, `xlsx`.

Pin the skill invocation pattern in `CLAUDE.md` so every session knows to do this.

---

## 9. Reminder: Council-readiness rules (unchanged)

These remain non-negotiable:
- Provenance on every chart
- Confidence + sources on every AI output
- Freshness timestamp on every data point
- Audit logging on every mutation and AI call
- Methodology versioning on every metric

## 10. Cross-platform development + production deployment

**Dev:** Windows via WSL2 (Ubuntu 24.04). **Prod:** on-prem Ubuntu server on KKU's internal network with Docker + Docker Compose v2. **Deployment model:** pack-and-ship — build on dev, bundle into tarball, transfer to prod, deploy with one script. Prod never pulls from Docker Hub.

**Production URL & networking:**
- Public URL: `https://program-landscape.kku.ac.th`
- GitHub repo: `https://github.com/khon-kaen-university/program-landscape`
- Container images: `ghcr.io/khon-kaen-university/program-landscape-<service>:<version>`
- Install path on prod server: `/opt/program-landscape/`
- **End-to-end TLS model:**
  - KKU's university reverse proxy terminates the public cert for `program-landscape.kku.ac.th`
  - KKU proxy then **re-encrypts** and forwards to our server over HTTPS on `:8443` using a **self-signed cert** that our nginx presents
  - KKU proxy is configured with `proxy_ssl_verify off` (or our cert's SHA-256 fingerprint is pinned)
- Internal nginx container handles path-based routing (`/api/*` → api, `/*` → web) on HTTPS
- App-level config (NextAuth `NEXTAUTH_URL`, NestJS `trust proxy`) must be set so URLs generated by the app use `https://program-landscape.kku.ac.th`

Rules:
- **No Makefile.** Use `pnpm` scripts for all developer tasks.
- **LF line endings everywhere** via `.gitattributes`. Critical for Docker builds and Prisma on Windows.
- **Paths via `path.join()`.** Never string-concatenate with `/` or `\`.
- **File deletion via `rimraf`.** Never `rm -rf` in scripts outside Docker.
- **Shell scripts live in Docker or on the Ubuntu prod server only.** Dev tooling is Node-based TypeScript.
- **Prisma `binaryTargets`** includes `native`, `linux-musl-openssl-3.0.x`, and `windows`.
- **Docker Compose v2 syntax:** `docker compose` (space), not `docker-compose` (hyphen).
- **All production images built for `linux/amd64`.** Use `docker build --platform linux/amd64` when building.
- **UTF-8 terminals.** Windows Terminal, not legacy cmd.exe.

See `WINDOWS-DEV.md` for dev setup. See prompt 13b for production deployment.
