> **GLOBAL UPDATES APPLY:** Before this prompt, read `GLOBAL-UPDATES.md` and `CLAUDE.md`. Apply all cross-cutting requirements: multi-level scope (university/faculty/department/program), English UI labels with Thai analysis content, light/dark theme support, modern SaaS UX patterns, KKU SSO auth, PostgreSQL DB, PDF as primary external data input, and Council-readiness rules.
>
> **Skills to invoke:** none specific (ops/security session)
>
> ---
>
# Prompt 13 — Hardening, Deployment, Governance

> **When to use:** After all 8 modules are functional. Prepares the system for real Council use.

---

The 8 modules are functional. Now harden the system for actual Council use.

### Security
1. Audit all endpoints for authorization gaps. Generate a security review report.
2. Implement CSRF protection, secure cookies, HSTS, CSP headers.
3. Add per-role data export controls — anything containing personal data (faculty info, student demographics) requires audit reason and is logged.
4. Rate limit AI endpoints aggressively. Per-user daily quotas.
5. Secrets management: move all API keys to environment variables, document secret rotation.
6. SQL injection / Prisma safety review.
7. Dependency vulnerability scan (npm audit, snyk-style).

### Performance
1. Profile cockpit load time; target < 2s p95.
2. Add Redis caching layer for expensive aggregations with sensible TTLs and invalidation on ingestion.
3. Database index review — examine slow queries, add missing indexes.
4. Move PDF generation to background workers (don't block request thread).
5. Set up CDN-style asset serving for static charts/images.

### Observability
1. Structured logging (pino or similar) across all services.
2. OpenTelemetry tracing on web → api → ingestion.
3. Metrics dashboard (Prometheus + Grafana, or hosted equivalent):
   - Request rates, latencies, error rates per endpoint
   - Ingestion job success/failure rates
   - AI inference latency, cost, confidence distribution
   - Active user counts by role
4. Alerts: ingestion failures, AI error spikes, slow endpoints, p95 latency > target.

### Data quality
1. Build a data quality dashboard (`/admin/data-quality`):
   - Completeness % per program per metric
   - Freshness aging (any data > 90 days highlighted)
   - Schema validation failures from ingestion
   - Anomaly detection (sudden 50% changes flagged)
2. Build a data lineage view — for any metric, show the chain from source → transformation → display.

### AI governance hardening
1. Review all prompts in code; ensure system prompts include the Council-readiness rules from the AI Analyst module.
2. Add output filtering: refuse to output personal info, refuse advocacy, refuse decision commitments.
3. Implement model fallbacks: if primary model fails, fall back to secondary. Log the swap.
4. Track AI cost per module, per user — surface in admin dashboard.
5. Build an AI evaluation suite: 50 gold-standard questions with expected behaviors. Run nightly; alert on regression.
6. Document the full AI governance posture in `docs/ai-governance.md`:
   - Model versioning policy
   - Prompt versioning (prompts in code, reviewed via PR)
   - Confidence calibration approach
   - Human-in-the-loop checkpoints
   - Bias monitoring (especially around faculty-affecting decisions)
   - Incident response for AI errors
   - Apply the principles from the high school AI tutoring chatbot system prompt policy work — fairness, transparency, prompt injection resistance, accountability hooks

### Deployment

The full deployment setup (Dockerfiles, `docker-compose.prod.yml`, pack-and-ship bundling, deploy/rollback/backup scripts, Nginx config) is covered in **prompt 13b**. In this hardening session, cover only:

1. Database migration safety: forward-only migrations, pre-deploy DB snapshot taken automatically
2. Backup strategy: daily snapshots with 30-day retention + monthly archives for 1 year; restore drill documented
3. Disaster recovery doc
4. CI/CD posture: PR runs lint + typecheck + test; tag creates a signed release bundle; production deploy is manual (humans SSH and run `./deploy.sh` — for a Council-facing system, the manual gate is correct)

Defer the actual bundling + deploy scripts to prompt 13b.

### Documentation for Council & users
1. **Council user guide** (Thai) — short, visual, covers cockpit + briefs + scenarios. Style consistent with other KKU executive materials.
2. **Executive guide** — for VPs and deans
3. **Analyst guide** — for the people maintaining the system
4. **Admin runbook** — for IT operations
5. **Methodology compendium** — every formula, every assumption, every model versioned and explained

### Onboarding
1. First-run wizard for new users (role-appropriate tour)
2. Contextual help (? icons throughout)
3. "What's new" changelog visible to users

### Compliance
1. PDPA (Thailand Personal Data Protection Act) review — document data flows, consent, retention.
2. Data subject access request workflow.
3. Audit log retention policy.
4. Faculty data sensitivity review (especially around financial data tied to individuals).

### Stakeholder readiness
Build a "system status" page accessible to executives showing:
- Data freshness across all sources
- Recent significant changes
- Pending AI reviews
- System health
- Recent decisions

### Deliverables
- Security review report
- Performance benchmarks (before/after)
- Production deployment doc
- All four user guides (drafts)
- AI governance doc finalized
- Suggestions for the rollout plan
