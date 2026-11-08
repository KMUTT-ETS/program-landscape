# โครงสร้างของ codebase

> **English:** [English version](../../adopters/codebase-layout.md)

**ผลลัพธ์** ท่านรู้ว่าโค้ดแต่ละส่วนอยู่ที่ใด และกฎใดที่ทุกการแก้ไขต้องรักษาไว้

```
apps/
  web/         Next.js 14 App Router — all UI. Server components by default.
  api/         NestJS — REST API at /api/v1, RBAC, audit logging, PDF service.
  ingestion/   NestJS standalone — BullMQ workers, connectors, one-shot scripts.

packages/
  shared/      Zod schemas, AI service + prompts, RBAC, connector contract,
               source catalog, scenario engine, forecasting. No DB imports.
  db/          Prisma schema + migrations + every scope-aware query helper and
               scoring methodology. This is where the analytics actually live.
  ui/          Component library — charts, viz primitives, council-readiness
               widgets (ProvenanceButton, ConfidenceBadge, FreshnessBadge).
  design/      Design tokens (OKLCH) + the Tailwind preset. See guides/rebrand.md.
  pdf-templates/  React components rendered to HTML, then to PDF by Gotenberg.

docs/          See the appendix for the full map.
prompts/       The original Claude Code build manual. See guides/extend-with-claude-code.md.
infra/         Docker build contexts — postgres (with extensions), gotenberg,
               nginx, systemd units.
scripts/       Release build, deploy, backup, restore, rollback, smoke test,
               env linking, migration linting.
```

## กฎการวางตัวสองข้อที่ช่วยประหยัดเวลา

**หัวใจเชิงวิเคราะห์อยู่ที่ `packages/db/src/` ไม่ใช่ `apps/api/`** ชั้น API บางมาก การให้คะแนนสุขภาพ การให้คะแนนความเสี่ยง การวิเคราะห์ช่องว่าง การเทียบเคียงคู่เทียบ ชุดคำสั่งค้นข้อมูลของหน้า deep-dive ตัวกรอง provenance ของคุณภาพข้อมูล — ทั้งหมดอยู่ใน `packages/db/src/*.ts` ในรูป exported function ที่ระบุ type ชัดเจน อยากรู้ว่า "ตัวเลขนี้คำนวณยังไง" ให้เริ่มที่นั่น ไม่ใช่ที่ controller

**`packages/shared/` ต้องไม่ import `packages/db/` เด็ดขาด** ทิศทางการพึ่งพาเป็นทางเดียว (`db` พึ่ง `shared`) ถ้าต้องการ implementation ที่ใช้ Prisma ของ interface ที่ประกาศไว้ใน `shared` ให้เอาคลาสจริงไปไว้ใน `db` แล้ว inject เข้ามา ตัวอย่างมาตรฐานของแพตเทิร์นนี้คือ `packages/db/src/ai-inference-recorder.ts`

## กฎความพร้อมสำหรับสภามหาวิทยาลัย

มีหกข้อ ใช้กับทุกโมดูล ทุก endpoint และทุกหน้าจอ ระบุไว้ใน `CLAUDE.md` และตรวจสอบด้วยเกตสิบสองข้อใน `docs/readiness-checklist.md`:

1. `<ProvenanceButton>` บนทุกกราฟ — เปิด drawer ที่บอกแหล่งข้อมูล ความสดของข้อมูล วิธีคำนวณ เวอร์ชันระเบียบวิธี และข้อควรระวัง
2. `<ConfidenceBadge>` พร้อมแหล่งข้อมูลที่คลิกได้ และปุ่ม "ไม่เห็นด้วย" บนทุกผลลัพธ์จาก AI
3. `<FreshnessBadge>` บนทุกจุดข้อมูล
4. `@AuditLog()` บนทุก mutation (`apps/api/src/common/decorators.ts`)
5. `@AiCall()` บนทุกการเรียก AI (ไฟล์เดียวกัน)
6. ทุกตัววัดต้องมี `methodologyVersion` และเอกสารระเบียบวิธีต้องกำกับเวอร์ชันไว้ใน git ใต้ `docs/methodologies/`

หน้าจอที่เพิ่มเข้ามาแล้วยังไม่มีครบหกข้อนี้ ถือว่ายังไม่เสร็จ นี่คือสิ่งที่ทำให้ผลลัพธ์ปกป้องได้ในห้องประชุมสภามหาวิทยาลัย และเป็นส่วนของ codebase ที่น่าข้ามที่สุดแต่แพงที่สุดเมื่อต้องกลับมาใส่ทีหลัง

## ขั้นต่อไป

อ่านต่อที่ [Getting started](../tutorials/getting-started.md)
