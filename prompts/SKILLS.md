# Claude Skills Reference

When you start each Claude Code session, **explicitly invoke the relevant Claude skill(s)** at the top of your prompt. This loads battle-tested guidance into the session and improves output quality dramatically.

## How to invoke a skill in Claude Code

At the start of any session, say:

> "Before starting, please read and apply the skill at `<skill-path>`."

Or, more specifically:

> "Use the `frontend-design` skill for this work."

Claude Code will load the skill's `SKILL.md` and apply its guidance.

## Skill mapping per prompt

| Prompt | Skills to invoke | Why |
|---|---|---|
| 00 — Bootstrap | `frontend-design`, `theme-factory` | Establish design system and aesthetic direction |
| 01 — Data model | (none specific) | Pure backend |
| 02 — Auth & API | (none specific) | Pure backend |
| 02b — Design system | `frontend-design`, `theme-factory`, `brand-guidelines` | This IS the design session |
| 02c — PDF generation (Gotenberg) | `pdf`, `frontend-design` | Builds the centralized PDF service with TH Sarabun New |
| 03 — Ingestion framework | (none specific) | Architecture |
| 03b — PDF ingestion | `pdf-reading` | Core to this prompt |
| 04 — Skills & AI | `pdf-reading` | Curriculum docs come as PDFs |
| 05 — Cockpit | `frontend-design` | Critical — first impression |
| 06 — Deep-Dive | `frontend-design`, `pdf` | UI + printable brief |
| 07 — Trends Radar | `frontend-design`, `pdf-reading` | UI + policy doc parsing |
| 08 — Gap Analyzer | `frontend-design` | Visualization-heavy |
| 09 — Scenario Planner | `frontend-design`, `pdf` | UI + scenario pack PDF |
| 10 — Benchmarking | `frontend-design`, `pdf-reading` | UI + peer doc parsing |
| 11 — AI Analyst | `frontend-design` | Chat UI quality matters |
| 12 — Decision Workspace | `frontend-design`, `pdf`, `docx`, `pptx` | UI + Council Pack exports |
| 13 — Hardening | (none specific) | Ops/security |

## What each skill brings

### `frontend-design` — production-grade UI quality
- Pushes Claude toward distinctive, intentional design (not generic AI aesthetics)
- Enforces typography, color, spatial composition, and motion thinking
- Critical for Council-facing modules where polish drives trust
- **Use this for every UI session.** This is your "UI UX Pro Max."

### `theme-factory` — light/dark theming
- Pre-built theme tokens you can apply or extend
- Color systems that work in both modes
- Accessibility-aware

### `brand-guidelines` — brand consistency
- Helps maintain KKU brand identity across all surfaces
- You'll need to provide KKU's actual brand assets (logo, colors, fonts) as inputs

### `pdf-reading` — PDF ingestion
- Handles text-heavy, scanned, table-heavy, and form PDFs differently
- Tells Claude when to use OCR vs. text extraction
- Critical because Thai government/policy docs come as messy PDFs (often scanned)

### `pdf` — PDF generation (design thinking only)
- For Council Pack briefs, scenario packs, decision reports
- **Note:** Actual PDF bytes always come from Gotenberg (see prompt 02c). The `pdf` skill provides design conventions and structure thinking; it does NOT mean using in-process PDF libraries like puppeteer or react-pdf.

### `docx`, `pptx`, `xlsx` — document exports
- For when Council members want Word/PowerPoint/Excel versions
- Used in Decision Workspace's export functionality

## A note on skill invocation in long projects

Claude Code's skill system loads skills on demand. For a multi-month build:
- **Pin skills in CLAUDE.md.** Add a "Skills used in this project" section so every session reads it.
- **Per-session reminders.** At the top of each prompt, restate the skill(s) for that session.
- **Don't over-invoke.** Loading too many skills at once dilutes their guidance. Use the per-prompt mapping above.

## Custom skill suggestion

After a few sessions, consider creating a **KKU-specific custom skill** that captures:
- KKU brand tokens (colors, fonts, logo paths)
- Thai typography rules (Sarabun, Noto Sans Thai, etc.)
- Council communication conventions
- Standard disclaimers and provenance footers

The `skill-creator` example skill at `/mnt/skills/examples/skill-creator/` shows how. Once built, every future session can invoke it instead of re-explaining the same conventions.
