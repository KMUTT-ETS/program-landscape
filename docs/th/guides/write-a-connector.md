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
- `ctx.log.info/warn/error(msg, meta?)` — เขียน log ผ่านตัวนี้เสมอ ห้ามใช้ `console` ตัวรันจะเก็บทุกบรรทัด (รวมเครื่องหมายขั้นตอน `[runner]` และ stack ของข้อผิดพลาด) ไว้ในตาราง `ingestion_run_logs` ผู้ดูแลเปิดดูได้จากปุ่ม **Log** ของแต่ละการรันที่ `/admin/data-sources/<slug>` และเห็นแบบสดระหว่างที่การรันยังทำงานอยู่ ระบบจะปิดบังเลขประจำตัวประชาชน อีเมล และเบอร์โทรศัพท์ จำกัดไว้ที่ 5,000 บรรทัดต่อการรัน และลบทิ้งเมื่อครบ 90 วัน — แต่ถึงอย่างนั้นก็ห้าม log ชื่อบุคคลหรือข้อมูลทั้งแถว

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

## นำเข้าชุดข้อมูลจาก HTTP API

### เมื่อใดควรใช้

หากระบบทะเบียน การเงิน หรือบุคคลของท่านมี HTTP/JSON API อยู่แล้ว ท่านเติมชุดข้อมูลเดียวกับที่การนำเข้าจากสเปรดชีตเติมได้ (ดู[การนำเข้าข้อมูลของสถาบัน](../data-import.md)) โดยไม่ต้องเขียน connector เต็มรูปแบบ คลาสฐาน `DatasetApiConnector` (`apps/ingestion/src/connectors/base/dataset-api-connector.ts`) ดึงเรกคอร์ด ท่านแมปเรกคอร์ดเป็นแถวของชุดข้อมูล ส่วนการตรวจสอบและการโหลดใช้ pipeline เดียวกับการอัปโหลด การโหลดผ่าน API จึงอยู่ภายใต้กฎทุกข้อเหมือนการอัปโหลด connector หนึ่งตัวเติมได้หลายชุดข้อมูล โดยโหลดตามลำดับความพึ่งพา

รองรับเฉพาะ HTTP ที่ตอบเป็น JSON หากเป็น SOAP, GraphQL, database view หรือ SFTP ให้ส่งออกเป็น XLSX แล้วอัปโหลด

### สร้างโครง connector

```bash
pnpm connector:new --name myuni-classes --dataset class-offerings
```

`--dataset` รับ slug ของชุดข้อมูลหนึ่งตัวหรือหลายตัวคั่นด้วยจุลภาค (`--dataset external-grants,external-grant-team`) หาก slug ไม่ถูกต้อง คำสั่งจะแสดงรายการที่ใช้ได้ slug ของทุกชุดข้อมูลอยู่ในตารางหัวข้อ "ชุดข้อมูลที่นำเข้าได้ในปัจจุบัน" ของ [การนำเข้าข้อมูล](../data-import.md) และ `pnpm connector:new --list` พิมพ์รายการนี้ `--display-name "<text>"` กำหนดชื่อที่แสดงในหน้าผู้ดูแล และ `--dry-run` แสดงสิ่งที่จะสร้างโดยไม่เขียนไฟล์ ตัวสร้างโครงจะสร้างคลาส connector และไฟล์ทดสอบใต้ `apps/ingestion/` ลงทะเบียน connector และเพิ่มรายการ data source ในแคตตาล็อก แล้วพิมพ์ขั้นตอนถัดไป ท่านเติมสองเมธอด:

```ts
export class MyuniClassesConnector extends DatasetApiConnector {
  readonly slug = 'api-myuni-classes';
  readonly displayName = 'Myuni Classes API';
  readonly datasets = ['class-offerings'] as const;

  protected async fetchAll(ctx: ConnectorContext, api: ApiClient): Promise<readonly unknown[]> {
    // talk to the API with api.getJson(path, ZodSchema) or api.paginate(...)
  }

  protected toRows(records: readonly unknown[]): DatasetRows {
    // return { 'class-offerings': [ { <template header>: value, ... } ] }
  }
}
```

ค่าตั้งต้นมาจาก environment โดย `<SLUG>` คือ slug ของ connector ตัวพิมพ์ใหญ่และเปลี่ยน `-` เป็น `_` ดังนั้น `api-myuni-classes` ได้ `API_MYUNI_CLASSES`:

```bash
CONNECTOR_API_MYUNI_CLASSES_BASE_URL=https://registrar.example.ac.th/api/v1
CONNECTOR_API_MYUNI_CLASSES_TOKEN=<bearer token>
# optional
CONNECTOR_API_MYUNI_CLASSES_MAX_ROWS=50000
CONNECTOR_API_MYUNI_CLASSES_ALLOW_SHRINK=true
```

ห้าม commit token

### แมปและรวมข้อมูล

- คีย์ของแต่ละแถวคือข้อความหัวคอลัมน์ในเทมเพลตของชุดข้อมูล ตรงตามเทมเพลต XLSX ดาวน์โหลดเทมเพลตจากหน้าของชุดข้อมูลเพื่อดูหัวคอลัมน์ ไฟล์ทดสอบที่สร้างให้ตรวจว่ามีหัวคอลัมน์ที่จำเป็นครบ
- ตรวจสอบทุก HTTP response ด้วย Zod `api.getJson` รับ schema เป็นอาร์กิวเมนต์ที่สอง และ `api.paginate` ไล่หน้าของ endpoint แบบรายการ
- ไคลเอนต์ลองใหม่เมื่อเกิดความล้มเหลวชั่วคราว แต่ไม่ลองใหม่กับ 401, 403, 404 และ redirect เพราะหมายถึง token, path หรือ URL ผิด การลองซ้ำมีแต่ซ่อนปัญหา
- แปลงปีเอง ระบบของไทยจำนวนมากใช้ พ.ศ. ส่วนชุดข้อมูลต้องการตามที่เทมเพลตระบุ
- ขีดจำกัดแถวเริ่มต้นคือ 10,000 ต่อชุดข้อมูล (`IMPORT_MAX_ROWS`) `CONNECTOR_<SLUG>_MAX_ROWS` เพิ่มได้สูงสุด 100,000 การโหลดที่จะลบข้อมูลของภาคเรียนหรือหลักสูตรไปมากจะถูกปฏิเสธ เว้นแต่ตั้ง `CONNECTOR_<SLUG>_ALLOW_SHRINK=true`
- ข้อผิดพลาดจากการตรวจสอบรายงานเป็นชุดข้อมูล ลำดับเรกคอร์ด (เริ่มที่ 1) คอลัมน์ และข้อความ โดยไม่แสดงค่าที่ผิด การรันหยุดที่ชุดข้อมูลแรกที่การตรวจสอบปฏิเสธ ชุดข้อมูลหลังจากนั้นรายงานว่ายังไม่ได้รัน ชุดข้อมูลที่ล้มเหลวระหว่างโหลด (เช่น ไม่มี data source `xlsx-<slug>` ให้รัน `pnpm data-sources:sync --apply`) จะถูกทำเครื่องหมาย FAILED ชุดข้อมูลที่โหลดไปก่อนหน้ายังอยู่ในรายงาน และการรันจะไม่ถูกลองใหม่
- `api.paginate` ยอมรับหน้าว่างที่ยังมี next cursor แต่จะหยุดด้วยข้อผิดพลาด PAGINATION เมื่อพบสามหน้าติดกัน เมธอด `fetchAll` และ `toRows` ที่ scaffolder สร้างให้จะ throw `NOT_IMPLEMENTED` จนกว่าท่านจะเขียนเสร็จ การกด "Run now" เร็วเกินไปจึงล้มเหลวครั้งเดียวแทนที่จะลองใหม่

### รันและตรวจสอบ

1. ตั้งค่าตัวแปร environment ใน `.env`
2. รัน `pnpm data-sources:sync --apply` คำสั่งนี้สร้าง data source ของ connector และเปลี่ยนชื่อแหล่งข้อมูลของชุดข้อมูลนำเข้าจาก "(spreadsheet import)" เป็น "(institution import)" ระบบที่ติดตั้งอยู่แล้วต้องรันหนึ่งครั้งหลังอัปเกรด
3. รีสตาร์ท ingestion worker
4. กด "Run now" ที่ `/admin/data-sources` หรือรัน `pnpm connector:run api-myuni-classes`
5. รัน `pnpm connector:verify api-myuni-classes` คำสั่งนี้ตรวจแบบอ่านอย่างเดียวว่า connector ลงทะเบียนและตั้งค่าแล้ว การรันล่าสุดสำเร็จ และแถวของแต่ละชุดข้อมูลมีที่มาของการรันกำกับ แอปมองเห็น และเชื่อมกับหลักสูตร ผลแสดงเป็น PASS, FAIL, WARN หรือ SKIP ต่อการตรวจแต่ละข้อพร้อมขั้นถัดไป connector ถือว่าเสร็จเมื่อไม่มี FAIL

หากท่านใช้ AI coding agent เขียน connector ให้ agent ใช้ skill `managing-connectors` ใน `.claude/skills/managing-connectors/` ซึ่งพา agent วางแผนการแมป เขียน ตรวจสอบ และดูแล connector

แถวข้อมูลจะปรากฏที่ `/admin/data-setup/raw/<dataset>` โดยคอลัมน์ Source เป็น `API: <connector name>` และการโหลดแสดงในประวัติ Uploads ของชุดข้อมูล การรันของ connector เองเก็บ import run ของแต่ละชุดข้อมูล คำเตือน และข้อผิดพลาดจากการตรวจสอบไว้ใน metadata ของการรัน หน้าผู้ดูแลยังไม่แสดงรายงานนี้ แต่ปุ่ม "Log" ของการรันที่ล้มเหลวจะแสดงรหัสและข้อความของข้อผิดพลาด แถวจาก API ถูกเก็บภายใต้ data source `xlsx-<slug>` ของชุดข้อมูลเดียวกับที่การอัปโหลดใช้ เพราะเส้นทางอ่านข้อมูลจำนวนมากค้นหาแถวของชุดข้อมูลด้วยชื่อนี้ metadata ของ import run บันทึก `via: 'api'`

หากต้องการฝึกโดยไม่มีระบบจริง `pnpm workshop:mock-api <mock output folder>` เปิดข้อมูลจำลองที่สร้างไว้ผ่าน HTTP (ดู [Session 3](../workshop/03-university-data.md#mock-api-server)) และ [นำเข้าข้อมูลจาก API (ฝึกปฏิบัติ)](../tutorials/load-data-from-an-api.md) พาทำ connector ที่สมบูรณ์กับ API จำลองตั้งแต่ต้นจนจบ

### สองแหล่งข้อมูลสำหรับชุดข้อมูลเดียว

ชุดข้อมูลหนึ่งเติมได้ทั้งจากการอัปโหลดและจาก API ระบบไม่ปฏิเสธ แต่การโหลดสองแหล่งไม่ได้ผสานกัน:

- Class Offerings และชุดข้อมูลอื่นที่ผูกกับภาคเรียน: แหล่งที่โหลดภาคเรียนนั้นทีหลังสุดจะแทนที่สิ่งที่อีกแหล่งโหลดไว้ในภาคเรียนนั้น
- ชุดข้อมูลที่ผูกกับหลักสูตร: เป็นแบบเดียวกัน ต่อหลักสูตร
- ชุดข้อมูลที่ upsert: แถวหนึ่งอาจมีค่าจากทั้งสองแหล่งปนกัน

หลักการเดียวกันใช้กับ API connector สองตัวที่เติมชุดข้อมูลเดียวกัน เช่น หนึ่งตัวต่อหนึ่งวิทยาเขต connector แต่ละตัวนับเป็นแหล่งข้อมูลของตัวเอง และ `pnpm connector:new` จะพิมพ์หมายเหตุเมื่อชุดข้อมูลที่ระบุมี connector อื่นเติมอยู่แล้ว แหล่งที่โหลดทีหลังสุดเป็นผู้ชนะ ดังนั้นให้ connector ที่ใช้ชุดข้อมูลร่วมกันดูแลภาคเรียนหรือหลักสูตรที่แยกกัน หรือยอมรับว่าการรันครั้งหลังจะแทนที่ครั้งก่อน

หน้าของชุดข้อมูลแสดงแบนเนอร์เมื่อมีแหล่งข้อมูลตั้งแต่สองแหล่งขึ้นไปเคยโหลด โดยระบุชื่อทุกแหล่ง พร้อมตารางภาคเรียนหรือหลักสูตรที่ได้รับผลกระทบ และคำเตือนเดียวกันปรากฏในผลการอัปโหลดและถูกเก็บไว้กับการรันของ connector "Start over" ลบแถวจากการอัปโหลดและจากการรัน API ทั้งหมด

### ข้อมูลส่วนบุคคล

API บางตัวส่งเรกคอร์ดต่อนักศึกษาหนึ่งคน ให้รวมข้อมูลภายใน `toRows` ให้ได้ระดับของชุดข้อมูล (เช่น จำนวนนักศึกษาที่ลงทะเบียนต่อกลุ่มเรียน หรือจำนวนบัณฑิตต่อหลักสูตรต่อปี) และไม่ส่งค่าระดับนักศึกษาต่อไป ชุดข้อมูลที่รายงานเป็นกลุ่ม เช่น Course Evaluations, Digital Competency, Employer Feedback, Graduate Outcomes, Staff Salary by Funding และ Compensation จะปฏิเสธกลุ่มที่เล็กกว่า 5 เหมือนการอัปโหลดทุกประการ ส่วน Class Offerings และ Enrolment ไม่มีขั้นต่ำนี้ ผู้เขียน connector จึงเป็นผู้ตัดสินว่าจะส่งกลุ่มเรียนขนาดเล็กต่อไปหรือไม่ โค้ดของ connector ต้องไม่บันทึก log เรกคอร์ดที่ดึงมา และ metadata ของการรันมีเพียงจำนวนและตำแหน่ง ไฟล์ตัวอย่างสำหรับทดสอบต้องเป็นข้อมูลที่แต่งขึ้นหรือทำให้ไม่ระบุตัวตนแล้ว ห้ามคัดลอกจากระบบจริง

## ขั้นต่อไป

อ่านต่อที่ [เอกสารหลักสูตรและ pipeline การสรุปด้วย AI](./curriculum-pdfs-and-ai-digest.md)
