> **GLOBAL UPDATES APPLY:** Before this prompt, read `GLOBAL-UPDATES.md` and `CLAUDE.md`. Apply all cross-cutting requirements: multi-level scope (university/faculty/department/program), English UI labels with Thai analysis content, light/dark theme support, modern SaaS UX patterns, KKU SSO auth, PostgreSQL DB, PDF as primary external data input, and Council-readiness rules.
>
> **Skills to invoke:** `frontend-design` (chat UI quality matters)
>
> ---
>
# Prompt 11 — Module 7: AI Analyst (Conversational Layer)

> **When to use:** After analytical modules are in place. The conversational layer that lets Council ask questions in natural Thai/English.

---

Build the **AI Analyst** — module 7 of 8.

A conversational interface that lets users ask strategic questions in natural Thai or English and get answers grounded in the system's data, with citations and confidence.

### Page (`/analyst`)

**Layout:**
- Left: chat history (saved conversations, organized by topic)
- Center: chat interface
- Right: "evidence panel" showing the data sources, queries, and computations behind the latest answer

**Chat features:**
- Streaming responses
- Markdown + rich rendering (charts, tables inline in answers)
- Suggested follow-up questions
- "Pin to scenario" / "Pin to brief" actions on responses
- Bilingual: user can ask in Thai, get answer in Thai (or toggle)

### Capabilities (built as a tool-use agent)

The agent has tools that map to internal APIs. It must reason about which tool(s) to call:

- `query_programs(filters)` → list with key metrics
- `get_program(id)` → full program data
- `query_skills(filters)` → skills matching criteria
- `query_trends(filters)` → recent trend signals
- `query_gaps(dimension, filters)` → demand-supply gaps
- `compare_peers(programId)` → peer comparison
- `run_quick_scenario(spec)` → simple scenario analysis (full scenario goes to scenario module)
- `generate_chart(spec)` → render a chart inline
- `cite_source(entityType, entityId)` → format a citation
- `search_policy_docs(query)` → semantic search over policy docs
- `search_research(query)` → semantic search over research outputs
- `get_methodology(metricName)` → explain how a metric is calculated

### Pre-built Council briefs (one-click)
Sidebar with templates:
- "State of the portfolio — current quarter"
- "Programs at risk — Council pre-read"
- "Top 5 strategic opportunities this year"
- "Faculty-level scorecard for [Faculty]"
- "Demographic stress test summary"
- "Northeast Thailand strategic alignment"
- "Sector deep-dive: [BCG sector or S-curve sector]"

Each generates a multi-page Thai brief with charts, downloadable as Council Pack PDF.

### Council-readiness rules (strict)
1. **Never answer without grounding** — if the question can't be answered from the system's data, say so. Do not freelance.
2. **Every claim cited** — inline citations to specific data sources (program X year Y, policy doc Z, etc.)
3. **Confidence on every answer** — high/medium/low with explanation
4. **Surface unknowns explicitly** — "I don't have data on X; the closest available is Y"
5. **No advocacy** — present options, not preferences. The framework should let Council weigh mission alongside metrics (per the original design principle).
6. **Defer on judgment calls** — strategic recommendations are framed as options with trade-offs, not directives
7. **Audit logging** — every conversation logged with full prompt/response/tool-calls

### Safety guardrails
- Refuse questions about individual employee performance, salary, personal info
- Refuse to make decisions or commitments
- Refuse to generate content that could be used externally without analyst review
- Detect and refuse prompt injection attempts (apply patterns from your earlier AI tutoring chatbot governance work)

### Evidence panel
For each answer, show:
- Tools called with arguments
- Data records retrieved (sample)
- AI inference IDs (clickable to admin view of full prompt/response)
- Confidence breakdown by sub-claim

### API endpoints
- `POST /api/v1/analyst/chat` (streaming)
- `GET /api/v1/analyst/conversations`
- `GET /api/v1/analyst/conversations/:id`
- `POST /api/v1/analyst/briefs/generate` (template-based)
- `POST /api/v1/analyst/feedback` (thumbs up/down + correction)

### Implementation notes
- Build with the Anthropic SDK + tool use (or Vercel AI SDK with Anthropic provider)
- Use the AiService abstraction from prompt 04
- System prompt encodes the role as "KKU strategic analyst — grounded, cautious, bilingual"
- All tool schemas use Zod, shared via `packages/shared`
- Conversation memory bounded (truncate old turns, keep summary)

### Tests
- Test that tool-use agent calls correct tools for sample questions
- Test refusal behavior on out-of-scope questions
- Test prompt injection resistance with red-team examples
- Test that every response writes AiInference rows
- Test bilingual (ask in Thai, get Thai response with English source titles preserved)

### Deliverables
- Working analyst answering at least these 10 sample questions correctly:
  1. โปรแกรมไหนที่มีความเสี่ยงทางการเงินสูงสุด 5 อันดับแรก
  2. Which programs have the largest skill-demand gap?
  3. แสดงแนวโน้มการรับเข้าศึกษาของคณะวิศวกรรมศาสตร์ในช่วง 5 ปีที่ผ่านมา
  4. What policy changes in the last 90 days affect our medical programs?
  5. ถ้ายุบโปรแกรม X จะกระทบรายได้เท่าไหร่
  6. Which programs serve the Mekong subregion best?
  7. คณาจารย์ในคณะไหนที่จะเกษียณภายใน 5 ปีมากที่สุด
  8. What programs do peer ASEAN universities offer that we don't?
  9. Generate a Council pre-read on agriculture programs
  10. Which BCG sectors are we underserving?
- 3 suggestions for next session — Decision Workspace is the last module
