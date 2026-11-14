---
name: workshop-slides
description: Use when asked to make, translate or extend a Canva slide deck for the adopter workshop (docs/workshop sessions, pre-work, early notice) or any Program Landscape explainer for adopter IT staff — a canva.link URL plus "create a deck / slides / presentation" about a session, the pipeline, the Deep-Dive, connectors or testing.
---

# Workshop slides in Canva

## Overview

Workshop decks are for Thai university IT staff who may not be fluent in English. Every deck in the family looks and reads the same: Thai explanations, English technical terms, numbered English kickers, a teal light theme, an AI usage declaration, and facts checked against the code. The user watches the deck fill in Canva, so **save after every slide**.

Reference decks: "Deep-Dive Data Map" (`https://canva.link/mm3vs3ixs7solgv`) and "Program Pipeline" (`https://canva.link/csae5uqzgbqsx47`). Read one with `read-design` if unsure of a convention.

## Sources — the facts come from here

| Deck topic | Read first | Then verify against |
|---|---|---|
| A workshop session | `docs/workshop/<NN>-*.md` and its Thai twin `docs/th/workshop/<NN>-*.md` | the scripts in `package.json`, the code paths the page names |
| Schedule, timing | `docs/workshop/README.md`, `facilitator.md` | — |
| A pipeline / module | its guide under `docs/guides/` or `docs/tutorials/` | the source file (e.g. `packages/shared/src/pipeline/program-phases.ts`) |

Every number, command, path, route and flag on a slide must appear in the code or the docs. Where a doc and the code disagree, use the code. Cost figures carry their measurement ("วัดจากหลักสูตร ป.ตรี 126 รายวิชา บน OpenRouter"). Sessions marked "coming soon" get a preview slide only.

No personal data on slides (org PDPA policy). Invented example figures sit under a `MOCK DATA — ตัวเลขสมมติเพื่อการสอน` banner. Never use retired product names (see CLAUDE.md).

## Language

| Element | Language | Example |
|---|---|---|
| Kicker | English, numbered | `03 · EXECUTION ORDER` |
| Title, body, table cells, footnotes | Thai | `12 phases รันตามลำดับ dependency` |
| Technical terms inside Thai | English, as written in the code/UI | phase, pipeline, job, queue, worker, skill taxonomy, embeddings, null, ingestion run, skip/fail |
| Commands, flags, paths, env vars, table/function names, UI labels | English, verbatim | `pnpm programs:pipeline <code>`, `AI_PROVIDER`, "Run full pipeline" |
| Thai official terms | Thai | มคอ.2, ป.ตรี, สภามหาวิทยาลัย |
| Comments in code boxes | Thai | `# หลักสูตรเดียว (code, ลำดับ หรือ id)` |

Write short Thai sentences. Never italicise Thai text.

## Deck structure

1. **Title** — kicker `Program Landscape · IT Track …`, English title, Thai one-line subtitle, footer in English: `Program Landscape — KKU Curriculum Intelligence Platform · November 2026` (the month the deck is made).
2. **`00 · AI USAGE DECLARATION`** — title `การประกาศการใช้ AI ในการทำสไลด์ชุดนี้`, three cards, 3 bullets each, footer naming the tools and the files checked against. State only what really happened: if slides were saved as they were made, do not claim the user approved each save.
   - **AI ช่วยทำ** (blue `#1D4ED8`): ร่างโครงเรื่อง ข้อความ และ layout ใน Canva ผ่าน connector · อ่านโค้ดและเอกสารใน repo เพื่อสรุป <topic> · แปลเนื้อหาเป็นภาษาไทย คงศัพท์เทคนิคเป็นภาษาอังกฤษ
   - **ผู้สอนทำ** (green `#15803D`): กำหนดหัวข้อ กลุ่มผู้ฟัง และแนวภาษา · สั่งแก้และตรวจทานเนื้อหา · รับผิดชอบความถูกต้องของเนื้อหาทั้งหมด
   - **ข้อมูลที่ AI เห็น** (orange `#C2410C`): เฉพาะซอร์สโค้ดและเอกสารของระบบ · ตัวเลขตัวอย่างเป็น MOCK / ค่าประมาณ ไม่ใช่ข้อมูลจริง · ไม่มีข้อมูลส่วนบุคคล (PII) ส่งให้ AI หรือ Canva
   - Footer: `เครื่องมือ: Claude Code · โมเดล Claude (Anthropic) · Canva connector — ตรวจเทียบกับ <files>`
3. **Content slides** `01 · …` to `NN · …`, one idea each. Good shapes: inputs → process → outputs (3 cards with arrows), a flow of numbered boxes, a header-row table, a 2×2 card grid, a UI-steps column beside a dark terminal box.
4. **Last slide** — troubleshooting, recap or "Done when" with the doc path for the full page.

Size: one slide per section of the session page, usually 8–12 content slides. No clock times on slides (the schedule moves; put timings in `docs/workshop/`, not the deck) — durations like "ประมาณ 20 นาที" are fine. No speaker notes unless asked.

Leave pages you did not create untouched; the user may add their own (e.g. a prompt slide).

If the docs contradict each other (e.g. two different session times), do not pick one silently: tell the user which files disagree.

## Visual spec (1920×1080, white background)

| Element | Spec |
|---|---|
| Left accent bar | shape top 0 left 0, 24×1080, `#0F766E` |
| Kicker | top 90 left 120, 26 bold `#0F766E` |
| Title | top 135 left 120 width 1700, 64 bold `#0F172A` |
| Card | rounded rect r24, `#F1F5F9` (neutral) or `#CCFBF1` (highlight); dark emphasis `#0F766E` with white text |
| Card heading | 30–36 bold `#0F766E` |
| Body | 28, `#1E293B`, line height 1.5; bullets via `list_level 1, list_marker disc` (steps: `decimal`) |
| Arrow | triangle path `M0 0 L100 50 L0 100 Z`, 28×40, `#0F766E` |
| Terminal box | rect `#0F172A`, heading `#5EEAD4`, code 27 `#E2E8F0` |
| Footnote | 24–26 `#64748B`, normal style |

Rectangle path for any shape: `M0 0 H100 V100 H0 Z`, viewBox 100×100.

## Canva mechanics

The details and a worked slide are in `canva-recipe.md`. The rules that bite:

- `add_text` ignores styling: every new text box is 16 px black. Each slide takes **two** `edit-design` calls: (1) shapes and text, (2) `format_text` on the locator IDs that call returned.
- Save as you go: after adding the blank pages, and after each slide is styled and its thumbnail checked, `finalize: "commit"`, then `read-design` with `open_transaction: true` and `page_metadata` to reopen. **Re-read the page list after every reopen** — the user edits the same design and page indices shift. Match pages by `id`, never by remembered index.
- `add_page` appends at the end; move a page with `reorder_page` (anchor + before/after).
- After each call, look at the returned thumbnail: overflow, a Thai line breaking mid-word, a box too tall for its text. Fix with `resize_element` / `position_element` or a manual `\n` before committing.
- The user asked to watch it fill in: tell them in one line which slide you are on before each long step.

## Common mistakes

| Mistake | Fix |
|---|---|
| Deck written in English | Thai body, English terms — see Language |
| No AI usage declaration | Slide 2, always |
| One commit at the end | Commit after every slide |
| Styling passed to `add_text` | Second call with `format_text` |
| New colour scheme | Use the teal spec above |
| Editing by remembered page index after the user added a page | Re-read `page_metadata`, match by id |
| Numbers from memory | Cite the doc/code line; flag measured-on-one-programme figures |
