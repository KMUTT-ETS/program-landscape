# บทเรียน: นำเข้าข้อมูลจาก API (ฝึกปฏิบัติ)

> **English:** [`load-data-from-an-api.md`](../../tutorials/load-data-from-an-api.md)

**ผลลัพธ์** connector ที่ท่านเขียนเองเติมชุดข้อมูล Enrolment จาก HTTP API แถวข้อมูลแสดงที่ `/admin/data-setup/raw/enrollment-metrics` โดยมี Source เป็น "API: Practice Intake API" อยู่คู่กับแฟ้มที่ท่านอัปโหลด และท่านรู้วิธีทำแบบเดียวกันกับระบบของท่านเอง

**จุดเริ่มต้น** แอปที่ทำงานอยู่บนเครื่องของท่าน ผู้ดูแลระบบคนแรกลงชื่อเข้าใช้แล้ว และนำเข้ามหาวิทยาลัยจำลองไว้แล้ว (ขั้นที่ 1 บอกวิธี) คำสั่งทุกคำสั่งด้านล่างรันจากโฟลเดอร์ราก (root) ของ repository

**เวลา** ประมาณหนึ่งชั่วโมง ไม่มีค่าใช้จ่าย AI

บทเรียนนี้เป็นการฝึกกับ API จำลองที่ทำหน้าที่แทนระบบทะเบียน กฎทุกข้ออ้างอิงจาก [นำเข้าชุดข้อมูลจาก HTTP API](../guides/write-a-connector.md)

## ก่อนเริ่ม

ทำบทเรียนนี้บนระบบสำหรับฝึกที่มีแต่ข้อมูลจำลองเท่านั้น การโหลดจาก API แทนที่ข้อมูลแบบเดียวกับการอัปโหลด และ API จำลองส่งตัวเลขที่แต่งขึ้น หากทำบนระบบที่มีข้อมูลจริงของมหาวิทยาลัย ตัวเลขที่แต่งขึ้นจะเขียนทับตัวเลขจริง

## ขั้นที่ 1: สร้างและนำเข้ามหาวิทยาลัยจำลอง

1. เขียนแฟ้ม input แล้วสร้างแฟ้ม spreadsheet จำลอง ตามที่อธิบายไว้ในหัวข้อ "ไม่มีแฟ้มส่งออก? สร้างชุดข้อมูลจำลองสำหรับมหาวิทยาลัยของท่าน" ของ [ช่วงที่ 3](../workshop/03-university-data.md)

   ```bash
   pnpm workshop:mock my-university.json --out workshop-mock-out
   ```

2. อัปโหลดแฟ้มตามลำดับหมายเลขที่ `/admin/data-setup` อย่างน้อยจนถึง `04-enrollment-metrics.xlsx` หลักสูตรต้องมีอยู่ในระบบก่อน connector จึงจะโหลดตัวเลขของหลักสูตรนั้นได้

ท่านควรเห็นชุดข้อมูล Enrolment ที่ `/admin/data-setup/raw/enrollment-metrics` มีหนึ่งแถวต่อหลักสูตรต่อปี และมีการอัปโหลดหนึ่งรายการในประวัติ Uploads

## ขั้นที่ 2: เปิด API จำลอง

ในหน้าต่าง terminal ที่สอง

```bash
pnpm workshop:mock-api workshop-mock-out --token practice-token
```

โปรแกรมพิมพ์ base URL คือ `http://127.0.0.1:4010/api/v1` และรับการเชื่อมต่อจากเครื่องของท่านเท่านั้น หากไม่ใส่ `--token` จะสร้าง token ใหม่ทุกครั้งที่เปิด การกำหนด token ตายตัวช่วยให้ไม่ต้องแก้ `.env` ทุกครั้ง เปิดทิ้งไว้

## ขั้นที่ 3: ดูว่า API ส่งอะไรกลับมา

เลือกรหัสหลักสูตรหนึ่งรหัสจาก `03-programmes.xlsx` แล้วขอข้อมูลการรับเข้า

```bash
MOCK_TOKEN=practice-token
curl -H "Authorization: Bearer $MOCK_TOKEN" \
  http://127.0.0.1:4010/api/v1/programmes/<programme code>/intake
```

ท่านจะได้หนึ่ง object ต่อปี

```json
{ "data": [ { "year_be": 2568, "applied": 412, "admitted": 180, "enrolled": 151,
              "retained_year2": 0, "graduated_on_time": 0, "graduated_late": 0, "dropouts": 0 } ] }
```

เทียบกับ template ของ Enrolment (ดาวน์โหลดได้จากหน้าของชุดข้อมูล)

| ฟิลด์ของ API | หัวคอลัมน์ใน template |
|---|---|
| รหัสใน URL | `Programme Code` |
| `year_be` ลบ 543 | `Academic Year` |
| `applied` | `Applications` |
| `admitted` | `Admitted` |
| `enrolled` | `Enrolled` |
| `retained_year2` | `Retained to Year 2` |
| `graduated_on_time` | `Graduated on Time` |
| `graduated_late` | `Graduated Late` |
| `dropouts` | `Dropouts` |

สังเกตสามเรื่อง ปีเป็นพุทธศักราช ชื่อฟิลด์ต่างจากหัวคอลัมน์ และไม่มี route สำหรับขอรายชื่อหลักสูตร connector จึงต้องรู้เองว่าจะถามรหัสใด รหัสที่ API ไม่รู้จักจะตอบ 404

## ขั้นที่ 4: สร้างโครง connector

```bash
pnpm connector:new --name practice-intake --dataset enrollment-metrics
```

คำสั่งนี้สร้างแฟ้มสามแฟ้มและลงทะเบียน connector ให้

- `apps/ingestion/src/connectors/sources/institution/practice-intake/connector.ts` คลาสที่ท่านต้องเติม พร้อม type `EnrollmentMetricsRow` ที่ระบุหัวคอลัมน์ทุกคอลัมน์
- `apps/ingestion/test/institution/practice-intake.test.ts` ชุดทดสอบที่เริ่มต้นแบบข้าม (skipped)
- `apps/ingestion/test/institution/practice-intake.fixture.json` เรกคอร์ดตัวอย่างสำหรับทดสอบ ตอนนี้ยังว่าง

## ขั้นที่ 5: เขียน fetchAll และ toRows

แทนที่เนื้อหาของ `connector.ts` ด้วย

```ts
import { z } from 'zod';

import { prisma } from '@kku/db';
import type { ConnectorContext } from '@kku/shared';

import type { ApiClient } from '../../../base/api-client';
import { NonRetryableError } from '../../../base/base-connector';
import { DatasetApiConnector, type DatasetRows } from '../../../base/dataset-api-connector';

/** One year of intake for one programme, as the mock API returns it. */
const IntakeYear = z.object({
  year_be: z.number().int(),
  applied: z.number().int(),
  admitted: z.number().int(),
  enrolled: z.number().int(),
  retained_year2: z.number().int(),
  graduated_on_time: z.number().int(),
  graduated_late: z.number().int(),
  dropouts: z.number().int(),
});
const IntakeResponse = z.object({ data: z.array(IntakeYear) });

/** What fetchAll hands to toRows: the programme code plus one year of intake. */
type IntakeRecord = z.infer<typeof IntakeYear> & { programmeCode: string };

const BE_OFFSET = 543;

export class PracticeIntakeConnector extends DatasetApiConnector {
  readonly slug = 'api-practice-intake';
  readonly displayName = 'Practice Intake API';
  readonly datasets = ['enrollment-metrics'] as const;

  /** The programmes to ask the API about: every programme the app already holds. */
  protected async programmeCodes(): Promise<string[]> {
    const rows = await prisma.program.findMany({ select: { code: true }, orderBy: { code: 'asc' } });
    return rows.map((r) => r.code);
  }

  protected async fetchAll(_ctx: ConnectorContext, api: ApiClient): Promise<readonly unknown[]> {
    const records: IntakeRecord[] = [];
    for (const code of await this.programmeCodes()) {
      try {
        const res = await api.getJson(`/programmes/${encodeURIComponent(code)}/intake`, IntakeResponse);
        for (const year of res.data) records.push({ programmeCode: code, ...year });
      } catch (err) {
        // A programme the API has no intake for answers 404: skip it, keep the rest.
        if (err instanceof NonRetryableError && err.code === 'HTTP_404') continue;
        throw err;
      }
    }
    return records;
  }

  protected toRows(records: readonly unknown[]): DatasetRows {
    const rows = (records as readonly IntakeRecord[]).map((r) => ({
      'Programme Code': r.programmeCode,
      'Academic Year': r.year_be - BE_OFFSET, // the API speaks Buddhist Era; the dataset wants Common Era
      Applications: r.applied,
      Admitted: r.admitted,
      Enrolled: r.enrolled,
      'Retained to Year 2': r.retained_year2,
      'Graduated on Time': r.graduated_on_time,
      'Graduated Late': r.graduated_late,
      Dropouts: r.dropouts,
    }));
    return { 'enrollment-metrics': rows };
  }
}
```

แต่ละส่วนทำอะไร

- **`IntakeResponse`** อธิบายรูปแบบของคำตอบด้วย Zod โดย `api.getJson` ตรวจทุกคำตอบเทียบกับรูปแบบนี้ หาก API เปลี่ยนไป การรันจะล้มเหลวอย่างชัดเจนแทนที่จะโหลดตัวเลขผิด การตรวจนี้ยังเป็นเหตุผลที่ `toRows` ถือว่าเรกคอร์ดเป็น `IntakeRecord` ได้ เพราะไม่มีอะไรมาถึงที่นี่โดยไม่ผ่านการตรวจใน `fetchAll`
- **`programmeCodes`** ตอบคำถามว่า "จะถามรหัสใด" จากหลักสูตรที่มีอยู่ในแอปแล้ว แยกเป็นเมธอดของตัวเองเพื่อให้ชุดทดสอบแทนที่ได้
- **ส่วนที่จัดการ 404** ข้ามหลักสูตรที่ API ไม่รู้จัก ข้อผิดพลาดอื่นทั้งหมดหยุดการรัน token ผิด (401) หรือ base URL ผิดจะล้มเหลวทันทีและไม่ลองซ้ำ
- **`toRows`** สร้างหนึ่ง object ต่อหนึ่งแถว โดยใช้ข้อความหัวคอลัมน์ของ template เป็น key และแปลงปี โดยไม่ตรวจอะไรเอง การรันจะตรวจแถวเหล่านี้เหมือนแผ่นงานที่อัปโหลดทุกประการ

จากนั้นตรวจว่าคอมไพล์ผ่าน

```bash
pnpm --filter ingestion typecheck
```

## ขั้นที่ 6: ทดสอบการแมป

1. ใส่เรกคอร์ดที่แต่งขึ้นหนึ่งรายการใน `practice-intake.fixture.json`

   ```json
   [
     { "programmeCode": "PRACTICE-01", "year_be": 2567, "applied": 120, "admitted": 80,
       "enrolled": 60, "retained_year2": 55, "graduated_on_time": 0, "graduated_late": 0, "dropouts": 2 }
   ]
   ```

2. ใน `practice-intake.test.ts` เปลี่ยน `describe.skip(` เป็น `describe(` แล้วเพิ่มหนึ่งบรรทัดต่อจาก `expect` ที่มีอยู่

   ```ts
   expect(firstEnrollmentMetrics?.['Academic Year']).toBe(2024);
   ```

3. รันชุดทดสอบ

   ```bash
   pnpm --filter ingestion exec vitest run test/institution/practice-intake.test.ts
   ```

ท่านควรเห็น `1 passed` ไฟล์ตัวอย่างสำหรับทดสอบต้องเป็นข้อมูลที่แต่งขึ้นหรือทำให้ไม่ระบุตัวตนแล้วเสมอ ห้ามคัดลอกจากระบบจริง

## ขั้นที่ 7: ตั้งค่าและรัน

1. เพิ่มใน `.env` (token คือค่าที่ท่านส่งให้ API จำลอง)

   ```bash
   CONNECTOR_API_PRACTICE_INTAKE_BASE_URL=http://127.0.0.1:4010/api/v1
   CONNECTOR_API_PRACTICE_INTAKE_TOKEN=practice-token
   ```

2. สร้าง data source ของ connector

   ```bash
   pnpm data-sources:sync --apply
   ```

3. รัน

   ```bash
   pnpm connector:run api-practice-intake
   ```

ท่านควรเห็น `outcome=SUCCEEDED` และ `recordsLoaded` เท่ากับจำนวนหลักสูตร-ปี หากต้องการใช้ปุ่ม "Run now" ที่ `/admin/data-sources` แทน ให้เริ่ม `pnpm dev` ใหม่ก่อน เพื่อให้ ingestion worker รู้จัก connector ตัวใหม่

หากล้มเหลว ให้เปิด `/admin/data-sources` เลือก `api-practice-intake` แล้วกด "Log" ที่การรันที่ล้มเหลวใน "Recent runs" บรรทัดสุดท้ายแสดงรหัสข้อผิดพลาดและข้อความ ซึ่งระบุชุดข้อมูล ลำดับเรกคอร์ด และคอลัมน์ โดยไม่แสดงค่า กรณีที่พบบ่อย

| รหัสหรือข้อความ | สาเหตุ |
|---|---|
| `HTTP_401` | token ใน `.env` ไม่ตรงกับของ API จำลอง |
| `CONFIG … No base URL` | ไม่มี `CONNECTOR_API_PRACTICE_INTAKE_BASE_URL` |
| `NOT_IMPLEMENTED` | `connector.ts` ยังเป็นโครงที่สร้างไว้ |
| `Academic Year … in the future` | ไม่ได้แปลงปีจากพุทธศักราช |
| `This code does not exist in Programmes` | ยังไม่ได้อัปโหลดหลักสูตรในขั้นที่ 1 |

## ขั้นที่ 8: ตรวจผลลัพธ์

1. เปิด `/admin/data-setup/raw/enrollment-metrics`
   - ตาราง Uploads มีแถวใหม่ที่ Source เป็น "API: Practice Intake API" อยู่ถัดจากการอัปโหลดแฟ้มของท่าน
   - แบนเนอร์ "Two sources feed this dataset" บอกว่าตอนนี้ทั้งการอัปโหลดและ API โหลด Enrolment
2. เปิด `/admin/data-sources` แล้วเลือก source `api-practice-intake` ส่วน "Recent runs" แสดงการรันเป็น SUCCEEDED พร้อมจำนวนแถวที่โหลด และ "Log" แสดงขั้นตอนของการรัน รายงานแยกตามชุดข้อมูล (import run ใดโหลด Enrolment และคำเตือน) ถูกเก็บไว้กับการรัน แต่หน้านี้ยังไม่แสดง คำเตือนเรื่องสองแหล่งข้อมูลแสดงที่แบนเนอร์ในข้อ 1
3. เปิด `/programs/<id>` ของหลักสูตรหนึ่ง ส่วน Students อ่านจากแถวเดียวกัน คือ API ให้ตัวเลขชุดเดียวกับที่ spreadsheet ให้

เนื่องจาก Enrolment จับคู่ทีละแถว แถวที่ API โหลดกับแถวที่ท่านอัปโหลดสำหรับหลักสูตรและปีเดียวกันจึงเป็นแถวเดียวกัน ค่าของแถวเป็นของแหล่งที่โหลดล่าสุด สำหรับชุดข้อมูลที่ครอบคลุมทั้งภาคเรียน เช่น Class Offerings การโหลดล่าสุดจะแทนที่ทั้งภาคเรียน ดูหัวข้อ "สองแหล่งข้อมูลสำหรับชุดข้อมูลเดียว" ใน [คู่มือการเขียน connector](../guides/write-a-connector.md)

## ขั้นที่ 9: เก็บกวาด

connector นี้เป็นโค้ดสำหรับฝึก หากต้องการลบ

1. ลบโฟลเดอร์ `apps/ingestion/src/connectors/sources/institution/practice-intake/` และแฟ้มสองแฟ้มใน `apps/ingestion/test/institution/`
2. ลบบรรทัดที่เครื่องมือสร้างโครงเพิ่มไว้เหนือ marker `// connector:new entries` ใน `apps/ingestion/src/connectors/sources/institution/index.ts` และ `packages/shared/src/ingestion/institution-catalog.ts` รวมทั้งบรรทัด import ที่เพิ่มไว้ด้านบนของ `index.ts`
3. ลบสองบรรทัด `CONNECTOR_API_PRACTICE_INTAKE_*` ออกจาก `.env`

แถวที่ connector โหลดไว้ยังคงอยู่ "Start over" ในหน้า Enrolment ลบแถวทั้งจากการอัปโหลดและจากการรัน API หากยังใช้ข้อมูลนี้ ให้อัปโหลด `04-enrollment-metrics.xlsx` อีกครั้งหลังจากนั้น

## แบบฝึกหัดของท่าน: Class Offerings

API จำลองยังส่งข้อมูลกลุ่มเรียนด้วย และเป็นแบบฝึกหัดถัดไป ซึ่งมีสองเรื่องที่บทเรียนนี้ไม่ต้องใช้

- `/terms/<year>/<semester>/sections` แบ่งหน้า ให้ใช้ `api.paginate` กับ `next_cursor`
- `/terms/<year>/<semester>/enrolments` ส่งหนึ่งเรกคอร์ดต่อนักศึกษาหนึ่งคนต่อกลุ่มเรียน อย่าส่งเรกคอร์ดระดับนักศึกษาต่อไป ให้นับรวมต่อกลุ่มเรียนภายใน `toRows` และตัดสินใจว่าจะทำอย่างไรกับกลุ่มเรียนที่มีนักศึกษาน้อยกว่า 5 คน (Class Offerings ไม่ปฏิเสธกลุ่มเหล่านี้)

สร้างโครงด้วย `pnpm connector:new --name practice-classes --dataset class-offerings` รายการ route อยู่ใน `apps/ingestion/src/scripts/workshop-mock-api/README.md`

## ขั้นต่อไป

- [นำเข้าชุดข้อมูลจาก HTTP API](../guides/write-a-connector.md) สำหรับกฎทุกข้อ ทั้งขีดจำกัด การลองซ้ำ ข้อมูลส่วนบุคคล และสองแหล่งข้อมูล
- [การนำเข้าจาก spreadsheet](../data-import.md) ว่าแต่ละชุดข้อมูลเก็บอะไร
- เชื่อมต่อระบบของท่านเอง สร้างโครง connector สำหรับชุดข้อมูลที่ API ของท่านเติม ชี้ `CONNECTOR_<SLUG>_BASE_URL` ไปที่ระบบนั้น และทำงานบนระบบสำหรับฝึกจนการรันผ่านโดยไม่มีข้อผิดพลาด
