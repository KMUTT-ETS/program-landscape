# การเขียน connector

> **English:** [English version](../../guides/write-a-connector.md)

**ผลลัพธ์** ท่านเขียน connector ที่แทน mock ด้วยระบบจริงของสถาบันได้ โดยไม่สูญเสียข้อมูลแหล่งที่มา

## Interface

ประกาศไว้ใน `packages/shared/src/ingestion/types.ts` มีสี่เมธอด และ runner เรียกตามลำดับนี้:

```
healthCheck(ctx) → HealthStatus          // can we reach the source at all?
fetch(ctx)       → RawRecord[]           // pull, unchanged, from upstream
transform(ctx, raw) → NormalizedRecord[] // map to our schema; 0..n per raw
load(ctx, normalized) → LoadResult       // write, idempotently
```

ชนิดข้อมูลสามแบบ:

- `RawRecord` — `{ externalId, data: unknown, sourceTimestamp }` โดย `externalId` คือคีย์ที่ใช้ตัดข้อมูลซ้ำข้ามการรันแต่ละครั้ง
- `NormalizedRecord` — `{ target, externalId, payload, freshnessDate, sourcePdfId? }` โดย `target` ระบุตารางปลายทาง
- `LoadResult` — `{ recordsFetched, recordsLoaded, recordsFailed, metadata }` ก้อน `metadata` จะไปโผล่ที่ `/admin/data-sources/<slug>` และเป็นที่สำหรับใส่ตัวอย่างรหัสที่แปลงไม่ได้ จำนวนแถวแยกตามการกระจายตัว และอะไรก็ตามที่นักวิเคราะห์ต้องใช้คัดกรอง

## connector จริงหน้าตาเป็นอย่างไร

`apps/ingestion/src/connectors/sources/unicon-ds2001/connector.ts` ยาว 310 บรรทัด และเป็นไฟล์ที่คุ้มค่าแก่การอ่านมากที่สุด รูปธรรมคือ:

- `healthCheck` เปิดการเชื่อมต่อด้วย `configFromEnv('UNICON_DS2001_DB')` แล้วรัน `SELECT 1` จากนั้นส่งค่า `user@host:port/database` ที่ใช้เชื่อมต่อจริงกลับมาในข้อความ หน้า admin จะได้แสดงว่าต่อไปที่ไหนกันแน่
- `fetch` รัน projection คอลัมน์แบบเจาะจงชุดเดียว (คือเส้นแบ่งความไว้วางใจด้านข้อมูลส่วนบุคคล) แล้ว **ปฏิเสธที่จะไปต่อเมื่อได้ศูนย์แถว** — `throw new NonRetryableError('EMPTY_DATA', 'DS2001 returned 0 rows — refusing to wipe')` ข้อนี้สำคัญเพราะ `load` ใช้วิธีแทนที่ทั้ง snapshot การ fetch ที่ได้ค่าว่างจึงเท่ากับลบ snapshot ทิ้งทั้งก้อน ลอกกลไกป้องกันตัวนี้ไปใช้ด้วย
- `fetch` ยังเก็บยอดรวมรายการรันไว้ที่ `this.runState` (จำนวนแยกตามประเภทบุคลากร ตามสัญชาติ และแถวที่ hash ไม่ได้) ซึ่งไปจบที่ `LoadResult.metadata`
- `transform` hash `CITIZEN_ID` ตรงเส้นแบ่ง และคืน `[]` สำหรับแถวที่หาคีย์ไม่ได้ — จำนวนแถวที่ hash ไม่ได้ถูกนับไว้ ไม่ได้ถูกทิ้งเงียบ ๆ
- `load` ลบแถวเดิมที่อยู่ในขอบเขต `(academicYear, semester)` เดียวกัน แล้ว insert เป็นก้อนละ 1,000 แถวผ่าน `createMany` พร้อมประทับ `ingestionRunId: ctx.runId` ลงทุกแถว **การประทับนี้บังคับ** ดู [กับดักที่ 2](../adopters/traps.md#กับดักที่-2-realdatawhere--ส่วนที่ว่างเปล่าทั้งที่ฐานข้อมูลมีข้อมูล)

## รูปแบบ mock → real

ทุก slug ในแคตตาล็อกมี connector แบบ mock ส่วน implementation จริงเพิ่มเข้ามาคู่กัน ไม่ใช่เขียนทับ ตารางจับคู่อยู่ใน `apps/ingestion/src/connectors/registry.ts`:

```ts
{
  slug: 'kku-registry',
  mock: () => new KkuRegistryConnector(),
  real: () => new KkuRegistryRealConnector(),
}
```

การเลือกโหมดอยู่ใน `packages/shared/src/ingestion/connector-mode.ts` เจอตัวไหนก่อนใช้ตัวนั้น:

1. `CONNECTOR_<SLUG>_MODE` — เอา slug มาแปลงเป็นตัวพิมพ์ใหญ่ อักขระที่ไม่ใช่ตัวอักษรหรือตัวเลขเปลี่ยนเป็น `_` (เช่น `CONNECTOR_KKU_REGISTRY_MODE=real`)
2. `CONNECTOR_MODE` — ค่าตั้งต้นของทั้งระบบ
3. ค่าตายตัวสุดท้ายคือ `mocked`

ถ้าตั้ง slug ไว้เป็น `real` แต่ยังไม่ได้ลงทะเบียน factory `real` ตัว registry จะ log คำเตือนไว้ให้เห็นชัด แล้ว **ถอยไปใช้ mock** การพลิก env โดยยังไม่ได้เขียนคลาสจึงไม่เคยทำให้ระบบ ingestion ล่ม

**การย้อนกลับคือ "ตั้ง env กลับเป็น `mocked`" แล้วรีสตาร์ต worker** ไม่ต้องย้ายข้อมูล ไม่ต้องแก้ schema รักษาคุณสมบัตินี้ไว้ในทุก connector ที่เขียนขึ้นใหม่ นี่คือเหตุผลเดียวที่เกตข้อ 11 ในรายการตรวจสอบความพร้อมทำได้จริง

## คู่มือปฏิบัติการต่อ connector หนึ่งตัว

`prompts/14-integration-session-template.md` (128 บรรทัด) คือคู่มือที่มีอยู่แล้ว ใช้ตามนั้นได้เลยทั้งฉบับ ข้อที่ต่อรองไม่ได้คือ:

- **หนึ่ง slug ต่อหนึ่ง session** ไม่ใช่สองตัว ไม่ใช่ครึ่งตัว connector สองตัวแปลว่าสอง session จะทำขนานกันก็ได้ แต่ห้ามมัดรวม
- **รายการตรวจสอบก่อน session ต้องเสร็จครบก่อนเขียนโค้ดบรรทัดแรก** ได้แก่ กรอกข้อกำหนดให้เกินระดับโครงร่าง เก็บข้อมูลรับรองไว้ใน secret store ของสภาพแวดล้อมปลายทาง commit ตัวอย่าง payload ไว้ที่ `apps/ingestion/test/fixtures/<slug>/` (อย่างน้อยหนึ่งเคสปกติและหนึ่งเคสขอบ) เจ้าของข้อมูลยืนยันว่า endpoint นิ่งแล้ว และถ้ามีข้อมูลส่วนบุคคลเข้ามาเกี่ยวข้อง ต้องมีลายมือชื่อกำกับของเจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล
- **เกณฑ์ปิดงาน:** ต้องมีการรันสำเร็จ **อย่างน้อยสามครั้ง** ให้เห็นที่ `/admin/data-sources/<slug>` โดยไม่มีความล้มเหลวเลยตลอดสิบครั้งที่พยายาม พร้อมบันทึกค่าอ้างอิงสำหรับตรวจจับความเบี่ยงเบน (จำนวนแถวและการกระจายตัวของฟิลด์สำคัญ) ไว้ในข้อกำหนด
- **สิ่งที่อยู่นอกขอบเขตของ session แบบ connector อย่างชัดเจน:** การขยับเวอร์ชันระเบียบวิธี การเขียนข้อมูลลงตารางโดเมน และการแก้ UI แต่ละอย่างเป็น session ของตัวเอง

รัน connector โดยไม่ผ่าน BullMQ ด้วย `pnpm connector:run <slug>` เส้นทางโค้ดเดียวกับ worker แต่วนรอบพัฒนาได้เร็วกว่ามาก

## กฎเรื่องแฟล็ก `mocked` / `status`

ตอนพลิก connector ไปเป็น real แถวใน `data_sources` ต้องอัปเดต **ทั้ง** `status` และ `mocked` พร้อมกันในคราวเดียว สองคอลัมน์นี้เป็นอิสระต่อกัน และ `status='real'` ไม่ได้แปลว่า `mocked=false` ทำผิดข้อนี้แล้วจะได้ UI ที่ว่างเปล่าทั้งที่เห็นแถวข้อมูลอยู่ใน SQL ชัด ๆ `pnpm data-sources:audit` มีไว้จับความเบี่ยงเบนแบบนี้โดยเฉพาะ ให้รันทุกครั้งหลังพลิก connector และหลังรีเซ็ตฐานข้อมูล

## ขั้นต่อไป

อ่านต่อที่ [เอกสารหลักสูตรและ pipeline การสรุปด้วย AI](./curriculum-pdfs-and-ai-digest.md)
