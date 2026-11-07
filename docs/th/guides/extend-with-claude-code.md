# การต่อยอดแพลตฟอร์มด้วย Claude Code

> **English:** [English version](../../guides/extend-with-claude-code.md)

**ผลลัพธ์** ท่านต่อยอดแพลตฟอร์มด้วย Claude Code ได้ โดยผลลัพธ์ยังสอดคล้องกับกฎของโครงการ

codebase นี้สร้างขึ้นด้วย Claude Code และข้อเท็จจริงนั้นกำหนดวิธีที่ควรต่อยอดมัน ถ้าจะใช้ผู้ช่วย AI ที่นี่ การตั้งค่าด้านล่างคือสิ่งที่ทำให้ผลลัพธ์ของมันสอดคล้องกับโค้ดที่มีอยู่ แทนที่จะได้โค้ดที่ดูดีแต่ใช้งานจริงไม่ได้

## `CLAUDE.md` คือสัญญา

`CLAUDE.md` ที่รากของ repository ถูกอ่านตอนเริ่มทุก session ของ Claude Code นี่คือเหตุผลที่ AI ผลิตโค้ดที่สอดคล้องกันใน repository นี้ ไฟล์นี้เข้ารหัสคำถามเชิงกลยุทธ์ รายการโมดูล กลยุทธ์ด้านภาษา ธรรมเนียมการเขียนโค้ด กฎความพร้อมสำหรับสภามหาวิทยาลัย รูปแบบการ deploy และบันทึกการตัดสินใจยาว ๆ ที่อธิบายว่า *ทำไม* ทุกอย่างจึงเป็นแบบที่เป็น

**fork ไฟล์นี้แล้วเขียนส่วนที่เป็นเรื่องเฉพาะสถาบันใหม่ก่อน session แรก** โดยเฉพาะ:

| หัวข้อ | สิ่งที่ต้องทำ |
|---|---|
| คำอธิบายโครงการ กลุ่มเป้าหมาย | เขียนใหม่ให้เป็นของสถาบันคุณ |
| คำถามเชิงกลยุทธ์แปดข้อ | เขียนใหม่ — เป็นคำถามของสภามหาวิทยาลัยขอนแก่น และเป็นกรอบที่กำหนดทุกการตัดสินใจเชิงวิเคราะห์ที่ตามมา |
| แปดโมดูล | คงไว้ เว้นแต่จะตัดโมดูลใดออก |
| กลยุทธ์ด้านภาษา | ทบทวน — UI เป็นภาษาอังกฤษล้วน ผลวิเคราะห์เป็นภาษาอังกฤษล้วน โดยมีรายการยกเว้นภาษาไทยแคบ ๆ |
| ชื่อคณะ จำนวนหลักสูตร | แทนที่ |
| สถานะปัจจุบัน / บันทึกการตัดสินใจ | **ตัดให้เหลือแค่ตัวชี้ไปที่ประวัติของ มข. แล้วเริ่มบันทึกของตัวเอง** อย่าลากบันทึก session ของ มข. ขนาด 170 KB มาด้วย เพราะมันจะเบียดพื้นที่บริบทของคุณเอง |
| ธรรมเนียมการเขียนโค้ด รายการสิ่งที่ห้ามทำ | คงไว้ทุกตัวอักษร นี่คือส่วนที่ทำให้ผลลัพธ์ของ AI สอดคล้องกัน |
| คำสั่ง run/test/lint และหัวข้อแพลตฟอร์ม | อัปเดต path และชื่อโฮสต์ |

`prompts/CLAUDE.md.template` คือเทมเพลตดั้งเดิมที่ใช้สร้างไฟล์นี้ และเป็นจุดตั้งต้นที่สะอาดกว่าไฟล์ปัจจุบันขนาด 170 KB

ข้อสังเกตเรื่องบันทึกการตัดสินใจ: `CLAUDE.md` ของ มข. มีหมายเหตุที่ยอมรับเองว่าบันทึกกระโดดจาก v1.1.3 ไป v1.6.1 และงานช่วง v1.2–v1.6 ปล่อยออกไปแล้วแต่ไม่ได้บันทึกไว้ ให้ถือเป็นบันทึกแบบ best-effort และถือว่า `apps/web/app/changelog/page.tsx` คือประวัติการปล่อยเวอร์ชันที่เป็นทางการ

## `prompts/` คือคู่มือการสร้างฉบับดั้งเดิม

ไดเรกทอรี `prompts/` บรรจุ prompt ตามลำดับที่ใช้สร้างแพลตฟอร์มนี้ ตั้งแต่ prompt 00 (bootstrap) ถึง prompt 13b (การ deploy) บวก prompt 14 (การเชื่อมข้อมูลจริง) ที่ยังดำเนินอยู่ โอกาสที่จะได้รันซ้ำมีน้อย แต่นี่คือคำอธิบายที่ดีที่สุดเท่าที่มีว่า *ทำไม* แต่ละระบบย่อยจึงมีรูปร่างแบบนี้ อ่านตัวที่ตรงกับสิ่งที่กำลังจะแก้

`prompts/14-integration-session-template.md` คือเทมเพลต session รายตัว connector ที่ยังใช้งานอยู่ ให้ใช้กับทุก connector ที่เขียน ส่วน `prompts/GLOBAL-UPDATES.md` บรรจุข้อกำหนดที่ตัดข้ามทุกโมดูล และ `prompts/TROUBLESHOOTING.md` รวบรวมรูปแบบความล้มเหลวที่รู้จักแล้ว

## กฎประจำบ้านที่ทำให้ผลลัพธ์ของ AI สอดคล้องกัน

กฎเหล่านี้อยู่ใน `CLAUDE.md` และเป็นสิ่งที่ผู้ช่วย AI จะทำตามถ้าปล่อยไว้ และจะละเมิดเงียบ ๆ ถ้าลบทิ้ง:

- TypeScript strict **ห้าม `any`**
- ตรวจสอบด้วย Zod ที่ทุกเส้นแบ่ง I/O — request, response, ingestion, การสกัดด้วย AI
- ใช้ design token เท่านั้น ห้ามเขียนสี ฟอนต์ หรือระยะห่างตรง ๆ (ESLint บังคับ)
- `@AuditLog()` บนทุก mutation และ `@AiCall()` บนทุกการเรียก AI
- ใช้ server component เป็นค่าตั้งต้น ใช้ client component เฉพาะเมื่อต้องมีการโต้ตอบ
- ใช้ conventional commit (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`)
- รัน `pnpm check` ก่อน commit
- กำกับเวอร์ชันระเบียบวิธีบนทุกตัววัด
- ห้ามใช้ SQL ดิบ ยกเว้นผ่าน `$queryRaw` ของ Prisma พร้อมผลลัพธ์ที่ตรวจสอบด้วย Zod
- ใช้เครื่องมือที่ทำงานข้ามแพลตฟอร์มเท่านั้น — ไม่มี Makefile ไม่ใช้ `rm -rf` (ให้ใช้ `rimraf`) และไม่ต่อ path ด้วยสตริง (ให้ใช้ `path.join()`)

## ชุด prompt สำหรับเริ่มต้น

**หมายเหตุสำคัญเรื่องภาษาในส่วนนี้:** ข้อความ prompt ทั้งแปดชุดด้านล่าง **คงไว้เป็นภาษาอังกฤษโดยเจตนา** เพราะเป็นข้อความที่จะคัดลอกไปวางในเครื่องมือจริง และโมเดลทำงานได้ดีกว่ากับต้นฉบับ ส่วนคำอธิบายรอบ ๆ เป็นภาษาไทย ในแต่ละชุด:

- ย่อหน้าที่ขึ้นต้นด้วย **สิ่งที่ prompt นี้ทำ** คือคำอธิบายภาษาไทย อ่านเพื่อทำความเข้าใจ **อย่าคัดลอก**
- บล็อกอ้างอิงที่ขึ้นต้นด้วยเครื่องหมาย `>` คือ **ข้อความ prompt ภาษาอังกฤษที่ต้องคัดลอกไปวางทั้งบล็อก**
- ย่อหน้าที่ขึ้นต้นด้วย **เสร็จเมื่อ** คือคำแปลภาษาไทยของบรรทัด "Done when" ในบล็อกด้านบน มีไว้เพื่อความเข้าใจเท่านั้น

prompt เหล่านี้เขียนไว้ให้คัดลอกไปรันตามลำดับนี้ โดยแยกเป็นคนละ session ให้แทนที่ `<YOUR UNIVERSITY>` และรายละเอียดในวงเล็บเหลี่ยมด้วยข้อมูลของสถาบันคุณ

---

**Prompt 1 — ทำความเข้าใจภาพรวมของ codebase**

**สิ่งที่ prompt นี้ทำ:** ให้ผู้ช่วย AI อ่าน `CLAUDE.md`, `docs/architecture.md` และ `docs/evaluation-pipeline.md` แล้วเขียนเอกสารปฐมนิเทศสำหรับนักพัฒนาใหม่ในสถาบันของคุณ ครอบคลุมสามเรื่อง คือ (ก) เส้นทางข้อมูลตั้งแต่ connector จนถึงตัวเลขที่ปรากฏบนหน้า Portfolio Overview Cockpit พร้อมระบุชื่อไฟล์ในทุกช่วงต่อ (ข) โมดูลใดในแปดโมดูลที่แสดงผลที่มีประโยชน์ได้ทั้งที่ยังไม่ได้เชื่อมข้อมูลของสถาบันเลย และโมดูลใดว่างเปล่าสนิทจนกว่าจะรัน connector ตัวใดตัวหนึ่ง โดยระบุชื่อ connector กำกับทุกโมดูล (ค) ห้าไฟล์ที่นักพัฒนาจะแตะบ่อยที่สุด พร้อมคำอธิบายไฟล์ละหนึ่งประโยค prompt นี้ห้ามแก้โค้ด

> Read `CLAUDE.md`, `docs/architecture.md`, and `docs/evaluation-pipeline.md`. Then produce a written orientation for a new developer at `<YOUR UNIVERSITY>` covering: (a) the data flow from an ingestion connector through to a number rendered on the Portfolio Overview Cockpit, naming the specific files at each hop; (b) which of the eight modules can render anything useful with zero institutional data wired, and which are completely empty until a specific connector runs — name the connector for each; (c) the five files a developer will touch most often, with one sentence each on what lives there.
>
> Do not change any code. Write the orientation to `docs/adopters/orientation-<ouruni>.md`.
>
> **Done when:** the document exists, every file path in it resolves, and I can trace one number end-to-end from SQL through to a React component by following it.

**เสร็จเมื่อ:** เอกสารนั้นมีอยู่จริง ทุก path ในเอกสารชี้ไปยังไฟล์ที่มีอยู่จริง และไล่ตามตัวเลขหนึ่งตัวได้ตลอดเส้นทางจาก SQL ไปจนถึง React component โดยอาศัยเอกสารนั้น

---

**Prompt 2 — fork `CLAUDE.md` มาเป็นของสถาบันเรา**

**สิ่งที่ prompt นี้ทำ:** เขียน `CLAUDE.md` ใหม่ให้เป็นของสถาบันคุณ โดยคงธรรมเนียมการเขียนโค้ด รายการสิ่งที่ห้ามทำ กฎความพร้อมสำหรับสภามหาวิทยาลัย กฎขอบเขตการวิเคราะห์หลายระดับ ธรรมเนียมโครงสร้างโฟลเดอร์ และคำสั่ง run/test/lint ไว้ทุกตัวอักษร แล้วเขียนใหม่เฉพาะคำอธิบายโครงการและกลุ่มเป้าหมาย คำถามเชิงกลยุทธ์แปดข้อ ชื่อคณะ และหัวข้อแพลตฟอร์ม/การ deploy พร้อมแทนบันทึกการตัดสินใจทั้งก้อนด้วยย่อหน้าเดียวที่ชี้ไปยังประวัติของ มข.

> Rewrite `CLAUDE.md` for `<YOUR UNIVERSITY>`. Keep verbatim: the coding conventions, the "What NOT to do" list, the Council-readiness rules, the multi-level analytical scope rules, the folder conventions, and the run/test/lint commands. Rewrite: the project description and audience, the eight strategic questions (I will give you ours below), the faculty names, and the platform/deployment section (our production host is `<HOST>`, install path `<PATH>`). Replace the entire "Current status" decision log with a single paragraph pointing at KKU's upstream history plus an empty section for ours to accumulate in.
>
> Our strategic questions are: [list yours, or say "keep KKU's eight for now and flag that we must revisit them with our Council"].
>
> **Done when:** `CLAUDE.md` contains no reference to Khon Kaen University except the explicit attribution paragraph, is under 20 KB, and a fresh session reading only that file would follow our conventions rather than KKU's.

**เสร็จเมื่อ:** `CLAUDE.md` ไม่เหลือการอ้างถึงมหาวิทยาลัยขอนแก่นเลย ยกเว้นย่อหน้าแสดงที่มาที่ระบุไว้ชัดเจน ไฟล์มีขนาดต่ำกว่า 20 KB และ session ใหม่ที่อ่านเฉพาะไฟล์นี้จะทำตามธรรมเนียมของสถาบันคุณ ไม่ใช่ของ มข.

---

**Prompt 3 — ปรับแบรนด์**

**สิ่งที่ prompt นี้ทำ:** ปรับแบรนด์แอปพลิเคชันจาก มข. มาเป็นของสถาบันคุณ โดยทำทีละขั้นและหยุดให้ตรวจทานระหว่างขั้น เริ่มจากสำรวจการอ้างอิงทั้งหมด เปลี่ยนชื่อ token สีของแบรนด์ เปลี่ยนค่าสี เปลี่ยนไฟล์โลโก้และ favicon แล้วจึงแก้ข้อความบนหน้าจอ เทมเพลต PDF และข้อความ prompt ของ AI

> Rebrand the application from KKU to `<YOUR UNIVERSITY>`. Work in this order and stop for my review between each step:
>
> 1. Inventory every reference. Grep `apps/web` for "KKU" and "Khon Kaen" (case-insensitive) across `.ts`/`.tsx`, plus `packages/pdf-templates` and `packages/shared/src/ai/prompts`. Give me a categorised list: user-facing copy, PDF template text, AI prompt text, comments, identifiers. Roughly 101 files in `apps/web` alone — do not try to fix them in one pass.
> 2. Rename the brand colour token from `brand-cardinal` to `brand-primary` across `packages/design`, `packages/ui`, and `apps/web`. Keep the OKLCH values unchanged for now so the diff is purely a rename.
> 3. Change the `brand-primary` token values in `packages/design/src/tokens/color.ts` to `<YOUR COLOURS>` for both light and dark mode, and verify both modes still pass WCAG AA for text on surface.
> 4. Replace the logo files at `apps/web/public/brand/` and rebuild the favicon with `pnpm tsx scripts/build-favicon.ts`.
> 5. Fix user-facing copy, PDF templates, and AI prompt text — in that order, one commit each.
>
> Constraints: never hardcode a colour; use tokens only. Do not add tokens to the spacing scale — read `packages/design/src/tokens/spacing.ts` before touching anything spacing-related. Restart the dev server and clear `.next/cache/webpack` after any token change, because the preset does not hot-reload.
>
> **Done when:** `pnpm check` passes, no user-facing surface says "KKU", and both light and dark mode render correctly with our colours.

**เสร็จเมื่อ:** `pnpm check` ผ่าน ไม่มีหน้าจอที่ผู้ใช้เห็นระบุคำว่า "KKU" อีก และทั้งโหมดสว่างและโหมดมืดแสดงผลถูกต้องด้วยสีของสถาบันคุณ

---

**Prompt 4 — โหลดคณะ ภาควิชา และหลักสูตรของเรา**

**สิ่งที่ prompt นี้ทำ:** ข้อมูลหลักสามชุดนี้อัปโหลดเป็น spreadsheet ได้ที่ `/admin/data-setup` อยู่แล้ว ดาวน์โหลดแม่แบบ กรอก แล้วอัปโหลด อาจไม่ต้องใช้ Claude Code เลย ใช้ prompt นี้เมื่อข้อมูลต้นทางเป็นไฟล์ส่งออกที่ต้องจัดรูปให้ตรงกับแม่แบบก่อน รหัสหลักสูตรของ อว. ต้องใส่ในคอลัมน์ *Official Code* เพราะ `Program.mhesiCode` คือทางที่ connector DS1001 และ DS2004 ใช้แปลง `CURR_ID` มาเป็นหลักสูตร

> Turn our organisation data into the Program Landscape import templates. Do not edit any code or seed file.
>
> Read `docs/data-import.md` and the declarations in `packages/db/src/import/datasets/faculties.ts`, `departments.ts` and `programmes.ts` — those declare the exact columns, required fields and validation rules. Our faculties, departments and programmes are in [file], with columns [list them].
>
> Produce three workbooks matching the downloaded templates. Carry the MHESI curriculum code into the programmes sheet's *Official Code* column: `Program.mhesiCode` is how the UniCon DS1001 and DS2004 connectors resolve `CURR_ID` to a programme. Thai faculty names must be spelled the way TCAS writes them. List any row you could not map rather than guessing.
>
> **Done when:** all three workbooks upload at `/admin/data-setup` without a validation error, and `/admin/programs` lists our programmes with correct faculty and department attribution.

**เสร็จเมื่อ:** ไฟล์ทั้งสามอัปโหลดที่ `/admin/data-setup` ได้โดยไม่มีข้อผิดพลาดในการตรวจสอบ และหน้า `/admin/programs` แสดงหลักสูตรของสถาบันคุณพร้อมคณะและภาควิชาที่ถูกต้อง

---

**Prompt 5 — ต่อ connector UniCon ตัวแรก (DS2001 ทะเบียนหลักบุคลากร)**

**สิ่งที่ prompt นี้ทำ:** ทำตามเทมเพลต session รายตัว connector สำหรับ slug `unicon-ds2001` ตัวเดียว โดยให้อ่าน connector เดิมทั้งไฟล์ก่อนแก้อะไร แล้วไล่ตามขั้นตอน — เขียนสคริปต์สำรวจแบบอ่านอย่างเดียว เทียบ schema ของเรากับ projection เดิม ปรับ connector เท่าที่จำเป็น ปรับการแปลงรหัสหน่วยงาน และเพิ่ม transform test สิ่งที่ต้องรักษาไว้คือ projection คอลัมน์ การ hash เลขประจำตัวประชาชน การลดวันเกิดเหลือปีเกิด กลไกป้องกัน `EMPTY_DATA` และการประทับ `ingestionRunId: ctx.runId` ลงทุกแถว

> Follow `prompts/14-integration-session-template.md` for the slug `unicon-ds2001`. One connector only.
>
> Read `apps/ingestion/src/connectors/sources/unicon-ds2001/connector.ts` in full before changing anything — particularly the PII projection in `fetch()`, the `EMPTY_DATA` guard, and the snapshot-replace semantics in `load()`.
>
> Our DS2001 lives at [host/port/database]. Credentials are in `.env` under `UNICON_DS2001_DB_*` — note that key is documented in `.env.prod.example` but missing from `.env.example`; add it to both.
>
> Steps:
> 1. Write a read-only discovery script following the pattern of the existing `probe-*` scripts in `apps/ingestion/src/scripts/`. Report row count, distinct values per reference column, and which columns are NULL-heavy. Refuse to sample any column matching the PII guard pattern. Commit the aggregate output as a fixture under `apps/ingestion/test/fixtures/unicon-ds2001/`.
> 2. Diff our schema against the projection in the existing connector. Report every difference before changing code — I want to see it, not have it fixed silently.
> 3. Adapt the connector minimally. Preserve the column projection, the citizen-ID hashing, the birth-year downcast, the `EMPTY_DATA` guard, and the `ingestionRunId: ctx.runId` stamp on every inserted row.
> 4. Adapt `buildDeptCodeToFacultyMap()` to our organisational codes.
> 5. Add a transform unit test asserting every reference code in the fixture has a mapping.
>
> Then run `pnpm connector:run unicon-ds2001` until we have three consecutive successful runs with identical record counts. Update `data_sources` so `status` and `mocked` are set atomically, and run `pnpm data-sources:audit` to confirm no drift.
>
> **Done when:** three green runs are visible at `/admin/data-sources/unicon-ds2001`, `staff_master_record` rows all carry a non-null `ingestion_run_id`, the faculty-resolution rate is reported, and `pnpm check` passes. Do not touch any other connector or any UI file.

**เสร็จเมื่อ:** เห็นการรันสำเร็จสามครั้งติดกันที่ `/admin/data-sources/unicon-ds2001` แถวใน `staff_master_record` มี `ingestion_run_id` ที่ไม่เป็นค่าว่างครบทุกแถว มีการรายงานอัตราการแปลงรหัสคณะ และ `pnpm check` ผ่าน โดยไม่ไปแตะ connector ตัวอื่นหรือไฟล์ UI ใด ๆ

---

**Prompt 6 — เขียน connector UniCon ตัวที่สองโดยเทียบเคียง (DS2004)**

**สิ่งที่ prompt นี้ทำ:** ทำ `unicon-ds2004` (อาจารย์ประจำหลักสูตร) ด้วยเทมเพลตเดิมและวินัยหนึ่ง connector ต่อหนึ่ง session เหมือนเดิม ตัวนี้ต่างจาก DS2001 สามจุดที่ต้องจัดการให้ชัด คือ (ก) ชื่อตารางต้นทางเข้ารหัสปีการศึกษาและภาคการศึกษาไว้ (ข) ตัว connector อ่าน `TEACH_TYPE_ID` ทั้งสามค่า ไม่ใช่เฉพาะค่า 3 และ (ค) `CURR_ID` ที่จับคู่ไม่ได้ต้องบันทึกไว้โดยให้ `programId = NULL` พร้อมค่า `mhesiCurrId` ดิบ เพื่อให้นักวิเคราะห์ตามต่อ ห้ามทิ้ง

> Now do `unicon-ds2004` — academic staff per programme. Same template, same one-connector discipline.
>
> This one is different from DS2001 in three ways I want you to handle explicitly: (a) the source table name encodes academic year and semester (`ds2004_<YYSEM>`, BE last-two-digits plus semester) and the connector resolves `MAX(suffix)` at runtime — check whether our registrar uses the same convention and adapt if not; (b) it reads all three `TEACH_TYPE_ID` values (1 regular faculty, 2 curriculum lecturer, 3 responsible lecturer), not just type 3, so do not copy the documented view that filters to type 3 only; (c) `CURR_ID` resolves to `Program.mhesiCode` with a `ProgramMhesiAlias` fallback, and unmatched rows must persist with `programId = NULL` and the raw `mhesiCurrId` for analyst follow-up — never dropped.
>
> Before writing code, tell me what you expect to differ between our DS2004 and KKU's, based on our discovery output.
>
> **Done when:** three green runs, the programme-resolution rate is reported in `LoadResult.metadata`, unmatched rows are visible and countable rather than silently discarded, and the DS2001 faculty-resolution rate has improved now that the bridge table is populated.

**เสร็จเมื่อ:** มีการรันเขียวสามครั้ง มีรายงานอัตราการแปลงรหัสหลักสูตรใน `LoadResult.metadata` แถวที่จับคู่ไม่ได้มองเห็นและนับได้ ไม่ใช่ถูกทิ้งเงียบ ๆ และอัตราการแปลงรหัสคณะของ DS2001 ดีขึ้นเพราะตารางสะพานเชื่อมมีข้อมูลแล้ว

---

**Prompt 7 — ปรับระเบียบวิธีคะแนนสุขภาพให้ใช้น้ำหนักของเรา**

**สิ่งที่ prompt นี้ทำ:** ให้ผู้ช่วย AI เขียนบทวิเคราะห์ก่อน ยังไม่แตะโค้ด ครอบคลุมทุกมิติและทุกตัวขับเคลื่อน แหล่งข้อมูลของแต่ละตัว ตัวใดบ้างที่วันนี้จะคืนค่าว่างเพราะยังไม่ได้ต่อ connector ที่เกี่ยวข้อง และน้ำหนักตัวใดที่เข้ารหัสวิจารณญาณของสภามหาวิทยาลัยขอนแก่นไว้ ไม่ใช่หลักการทั่วไป จากนั้นเมื่ออนุมัติบทวิเคราะห์แล้วจึงลงมือทำเวอร์ชันของเรา พร้อมเลขเวอร์ชันใหม่ เอกสารระเบียบวิธีที่อัปเดตใน commit เดียวกัน และการทดสอบที่ครอบคลุมกฎเรื่องค่าว่าง

> Read `docs/methodologies/health-score.md` and `packages/db/src/health-score.ts` (currently `health-score.v4.0`), and `docs/evaluation-pipeline.md` for how the score feeds lifecycle, risk, and BCG classification.
>
> Produce a written analysis first — no code — covering: every dimension and driver, where each driver's data comes from, which drivers return null for us today given which connectors we have wired, and which weights encode a KKU Council judgement rather than a general principle. Flag anything you are unsure about rather than guessing.
>
> Then, and only after I have approved the analysis, implement our variant: a new version constant, our weights, our methodology document at `docs/methodologies/health-score.md` updated in the same commit, and tests covering the null-handling rule (a missing metric is excluded from the average, never substituted with 0 or 50) and our specific weight changes.
>
> **Done when:** the analysis document exists and I have approved it; the version constant is bumped; the doc and code agree; `dataCompletenessPct` is still computed and surfaced; and existing scored rows carrying the old version still render with their original version stamp.

**เสร็จเมื่อ:** เอกสารบทวิเคราะห์มีอยู่จริงและผ่านการอนุมัติแล้ว เลขเวอร์ชันถูกขยับ เอกสารกับโค้ดตรงกัน `dataCompletenessPct` ยังถูกคำนวณและแสดงผลอยู่ และแถวคะแนนเดิมที่ประทับเวอร์ชันเก่าไว้ยังแสดงผลด้วยเวอร์ชันเดิมของมัน

---

**Prompt 8 — รัน pipeline เอกสารหลักสูตร**

**สิ่งที่ prompt นี้ทำ:** ตั้งค่าและรัน pipeline นำเข้า PDF หลักสูตรของสถาบันคุณ ตั้งแต่สร้าง manifest แบบ JSONL สำหรับ `pnpm pdf:bulk-load` (โดย dry-run ก่อนเสมอ และ **ห้ามสร้างตัวจับคู่ชื่อไฟล์แบบคลุมเครือ**) ทดลองสรุปสามหลักสูตรต่างระดับเพื่อดูว่า `program-digest.v1` รับมือกับรูปแบบเอกสารของคุณได้หรือไม่ แล้วจึงรันเป็นชุด อนุมัติผล และปิดท้ายด้วยการรัน pipeline เต็มหนึ่งหลักสูตรโดยข้ามเฟส 4

> Set up and run the curriculum-PDF ingestion pipeline for our programmes.
>
> 1. Read `docs/pdf-ingestion.md` and the header of `apps/ingestion/src/scripts/programs-pipeline.ts`.
> 2. Build a JSONL manifest for `pnpm pdf:bulk-load` from our PDFs at [path], keyed on programme code. Dry-run first and show me the match rate and the unmatched list before committing anything. Do not build a fuzzy filename matcher — KKU retired theirs after it mislinked about 30 programmes; unmatched PDFs get attached by hand through `/admin/programs/[id]?tab=files`.
> 3. Run `pnpm programs:digest` on three programmes of different levels. Show me the extracted digest for each, and specifically: does `program-digest.v1` handle our curriculum document format, or does it assume KKU's layout? Report any prompt changes you would need — but do not edit a published prompt version in place; a behaviour change means a new version constant.
> 4. Once I approve the sample, run `pnpm programs:digest-bulk` and report cost, failure count, and per-failure reason.
> 5. Run `pnpm programs:approve-pending` and report how many skills matched our taxonomy versus landed in the `PROPOSED_SKILL` queue.
>
> Then run `pnpm programs:pipeline <code> --skip=phase4` on one programme end-to-end (skipping phase 4 because our registrar connectors are not wired yet) and show me the resulting Deep-Dive page.
>
> **Done when:** every programme with an available PDF has an approved digest; the `PROPOSED_SKILL` queue count is reported as an analyst worklist; and one programme's Deep-Dive renders with real extracted content rather than empty states.

**เสร็จเมื่อ:** ทุกหลักสูตรที่มี PDF มีผลสรุปที่ผ่านการอนุมัติแล้ว มีการรายงานจำนวนในคิว `PROPOSED_SKILL` ในฐานะรายการงานของนักวิเคราะห์ และหน้า Deep-Dive ของหลักสูตรหนึ่งแสดงเนื้อหาที่สกัดมาจริง ไม่ใช่สถานะว่าง

---

## จุดที่การใช้ AI ช่วยจะพลาดในโครงการนี้ — เรื่องนี้ต้องพูดให้เจาะจง

ผู้ช่วย AI เก่งจริงกับงานเชิงกลใน codebase นี้ ทั้งการเขียน connector โดยเทียบเคียงตัวที่มีอยู่ การกวาดเปลี่ยนชื่อข้ามร้อยไฟล์ การเขียน transform test จาก fixture และการร่างเอกสาร ใช้มันกับงานเหล่านั้น

แต่มัน **เชื่อถือไม่ได้ และมักผิดแบบมั่นใจเต็มร้อย กับสิ่งที่[หน้ากับดัก](../adopters/traps.md)ระบุไว้พอดี**:

- **สเกลระยะห่าง** AI ที่ฝึกมากับ Tailwind จะเขียน `h-4 w-4` บนไอคอน และเขียน `pl-9` เป็น padding โดยไม่ลังเล ทั้งคู่ผิดในโครงการนี้ในแบบที่ไม่เกิด error ขึ้นมาเลย ได้แค่ผลลัพธ์ที่ขนาดผิด ข้อบกพร่องสองรายการใน repository นี้เกิดจากสาเหตุนี้ตรง ๆ ให้สั่งมันอ่าน `packages/design/src/tokens/spacing.ts` และ `icon.ts` ก่อนแตะ utility ใดที่เกี่ยวกับระยะห่างหรือขนาด
- **การประทับ provenance** `ingestionRunId: ctx.runId` บนทุกแถวที่ insert เป็นสิ่งที่ลืมง่ายมาก และผลของการลืมคือ UI ว่างเปล่าเงียบ ๆ ไม่ใช่ error ให้กำหนดเป็นเกณฑ์ยอมรับที่ระบุชัดในทุก prompt ที่เกี่ยวกับ connector
- **การตัดสินใจเรื่อง schema** ฟิลด์ใหม่ควรเป็นคอลัมน์ เป็นก้อน JSONB หรือเป็นตารางใหม่ migration นี้เป็นแบบเพิ่มเข้าไปหรือทำลายข้อมูล unique constraint ทำงานอย่างไรกับความหมายของ NULL ใน Postgres — เรื่องเหล่านี้ต้องให้มนุษย์ตัดสิน codebase มีคำตอบที่ได้มาด้วยราคาแพงอยู่แล้ว (เช่น การ upsert ด้วย `findFirst → update | create` เขียนมือ ในกรณีที่ compound unique key มี NULL อยู่ด้วย) ซึ่ง AI จะคิดขึ้นมาเองไม่ได้
- **น้ำหนักในระเบียบวิธี** สิ่งเหล่านี้เข้ารหัสการตัดสินคุณค่าเชิงสถาบัน ว่าหลักสูตรใดสำคัญและเพราะอะไร AI จะผลิตน้ำหนักที่ฟังดูสมเหตุสมผลออกมาได้ทันที และ "ฟังดูสมเหตุสมผล" คือสิ่งที่ผิดที่สุดสำหรับตัวเลขที่จะใช้ปิดหลักสูตร
- **แนวปฏิบัติด้าน PDPA** AI จะเขียน `SELECT *` ให้อย่างเต็มใจ ทุก projection คือเส้นแบ่งความไว้วางใจที่ต้องมีลายมือชื่อของมนุษย์ และของเจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล ไม่ใช่ของโมเดล
- **การ "แก้" สิ่งที่จงใจไม่ใส่ไว้** ทั้งคีย์ระยะห่าง `3.5` ที่หายไป กฎค่าว่างไม่ใช่ศูนย์ และรายการในแคตตาล็อกที่เลิกใช้แล้วแต่ยังเก็บไว้ — ทุกอย่างดูเหมือนบั๊กแต่ไม่ใช่ คอมเมนต์ในโค้ดอธิบายเหตุผลไว้แล้ว ทำให้แน่ใจว่า AI ได้อ่าน

กฎที่ใช้ได้จริงคือ ปล่อยให้ AI เขียน แล้วอ่านสิ่งที่มันเขียนในหกหมวดข้างต้นด้วยตาตัวเองทุกครั้ง

## ขั้นต่อไป

อ่านต่อที่ [การ fork และการรับ fix จาก upstream](./upstream-fixes.md)
