# Prompt 04 — Skills Taxonomy & AI Extraction Pipeline

> **When to use:** After PDF intake. The AI backbone — creates the shared skill vocabulary that lets curriculum, jobs, research, and policy docs talk to each other.
>
> **Skills to invoke:**
> - `pdf-reading` (since most curriculum source docs are PDFs)
> - `frontend-design` (for the skill explorer + extraction review UI)

---

Read `CLAUDE.md`, `GLOBAL-UPDATES.md`, `docs/pdf-ingestion.md`, and the existing PDF pipeline.

Build the skills taxonomy and the AI-powered extraction pipeline that maps curriculum content (extracted from PDFs) and job postings to a unified skill graph.

### Taxonomy
1. Hierarchical taxonomy in `Skill` table
2. Bootstrap:
   - ~500 ESCO skills covering tech, science, engineering, business, health, agriculture, education
   - ~100 Thailand-specific skills (BCG economy, S-curve sectors); seed manually from TPQI if available
   - Mark skills as KKU-curated when applicable
3. Parent-child relationships up to 4 levels
4. Each skill gets an embedding using the configured embedding provider — embed `${nameEn} | ${nameTh} | ${category}`

### AI service abstraction (critical)

Build `AiService` in `packages/shared/src/ai/`:

```ts
interface AiService {
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  embed(req: EmbeddingRequest): Promise<EmbeddingResponse>;
  extractStructured<T>(req: ExtractionRequest, schema: ZodSchema<T>): Promise<ExtractionResponse<T>>;
  translate(req: TranslateRequest): Promise<TranslateResponse>; // Thai ↔ English
  vision(req: VisionRequest): Promise<VisionResponse>; // for tough PDF pages
}
```

Implementations:
- `AnthropicAiService` (default — uses Claude)
- `OpenAiService` (alternative)
- `IntelSphereAiService` (placeholder routing to KKU's multi-AI gateway — your existing infra)

Every call:
- Logged to `AiInference` (use `@AiCall()` decorator from prompt 02)
- Includes input, output, model, token counts, latency, cost estimate
- Surfaces confidence score
- Returns sources when retrieval was used

**Language-aware behavior:**
- Default generation language: Thai for analysis content, English for technical/UI fallback
- Extraction prompts handle Thai input fluently
- Translation pass cached (don't re-translate the same content)

### Curriculum extraction pipeline

Pulls from PDFs already processed by prompt 03b (CurriculumExtractor populated `Course` rows with descriptions).

1. Job: `ExtractCourseSkillsJob` — for each Course with description, prompt LLM to extract skills from taxonomy
2. Structured extraction with Zod schema
3. Few-shot prompt with 5+ examples of Thai + English course descriptions → skill IDs
4. Returns: `{ skills: [{ skillId, weight, evidence }], proposedSkills: [{ nameTh, nameEn, suggestedParent, rationale }] }`
5. Confidence < 0.6 → review queue
6. Roll up Course→Skill via `CurriculumCourse` (weighted by credits) into `ProgramSkill`, then `DepartmentSkill`, then `FacultySkill` (use the materialized views from prompt 01 where possible, or compute via job)

### Job posting extraction pipeline
1. `ExtractJobPostingSkillsJob` — same pattern as courses
2. Also extract: occupation code (ISCO-08), seniority level, key responsibilities
3. Compute `OccupationDemand` aggregates nightly

### Policy document processing
For each `PolicyDocument` from PDF pipeline:
- Generate Thai + English summaries (Thai primary)
- Tag relevant skills (vector similarity over skill embeddings)
- Tag relevant programs (via skill overlap with `ProgramSkill`)
- Score impact with reasoning
- Create `TrendSignal` if impact ≥ medium

### Admin review UI

Build `/admin/extraction-review` (ADMIN/ANALYST):
- Queue of low-confidence extractions
- Side-by-side: source text (or PDF page snippet) vs extracted skills
- Approve / edit / reject inline
- Proposed new skills queue with merge-with-existing or create-new
- Stats dashboard: extraction throughput, confidence distribution, model performance over time, cost per extraction

Use prompt 02b components. SaaS-grade UI.

### Skill explorer UI

Build `/skills` (all authenticated users):
- Browse taxonomy as a tree (expandable)
- Search Thai + English with `pg_trgm` fuzzy match + vector similarity
- **Scope-aware**: with the global ScopeSelector in top bar, the skill view shows coverage at the selected scope (university / faculty / department / program)
  - At university: shows skills covered by any program
  - At faculty: shows skills covered by programs in that faculty
  - At department: shows skills covered by programs in that department
  - At program: shows the skills for that program
- Per-skill detail: which programs cover it (at current scope), which job postings demand it, demand trend chart, "find similar skills" via vector search
- Demand vs coverage indicator per skill at current scope

### Tests
- Extract on 10 hand-labeled course descriptions from PDFs; assert F1 ≥ 0.7
- Test that low-confidence routes to review queue
- Test policy doc → trend signal flow end-to-end
- Test scope-aware skill view returns correct skills at each level
- Test that every AI call writes `AiInference`
- Test Thai-language extraction matches English-language extraction quality

### Governance
Update `docs/ai-governance.md`:
- Prompt locations (link to source files; treat prompts as code, version-controlled)
- Confidence thresholds and escalation
- Human-in-the-loop checkpoints
- Bias / fairness for program-affecting decisions (apply principles from your high school AI tutoring chatbot policy work)
- Model versioning policy
- Translation handling and caching
- Cost tracking per module

### Deliverables
- Working extraction with % of seeded courses successfully mapped
- Skill explorer UI rendering taxonomy with scope filter working
- Extraction review queue UI
- 3 suggestions for next session — my plan is to start the modules with Portfolio Cockpit
