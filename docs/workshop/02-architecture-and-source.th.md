# Session 2: สถาปัตยกรรมระบบและ Source Code

> **English:** [`02-architecture-and-source.md`](./02-architecture-and-source.md)

**เวลา** ประมาณ 90 นาที

## เป้าหมาย

รู้ว่าส่วนต่าง ๆ อยู่ที่ใดใน repository ไล่ตามส่วนหนึ่งของ Deep-Dive จาก browser ไปจนถึงฐานข้อมูล
เรียนรู้กติกาที่ทุกการแก้ไขต้องทำตาม และจบด้วยแอปที่ทำงานอยู่ โดยท่านลงชื่อเข้าใช้ในฐานะผู้ดูแลระบบ

## ส่วนประกอบ

Program Landscape เป็น repository เดียวที่มีหลายโปรแกรมทำงานร่วมกัน ทั้งหมดเขียนด้วย TypeScript

| โฟลเดอร์ | คืออะไร |
|---|---|
| `apps/web` | เว็บไซต์ (Next.js) มีหน้าต่าง ๆ เช่น `/programs/<id>` ซึ่งคือ Deep-Dive |
| `apps/api` | API (NestJS) ที่ `http://localhost:4000/api/v1` ทุกหน้าอ่านข้อมูลจากที่นี่ |
| `apps/ingestion` | worker เบื้องหลัง: connector ที่ดึงข้อมูลเข้า และ AI pipeline |
| `apps/docs-site` | เว็บไซต์เอกสารนี้ |
| `packages/db` | schema ของฐานข้อมูล (Prisma) รวมถึง query และการคำนวณ |
| `packages/shared` | โค้ดที่หลายแอปใช้ร่วมกัน: สิทธิ์ AI service และรายการ connector |
| `packages/ui` | ส่วนประกอบหน้าจอที่ใช้ร่วมกัน: กราฟ badge ตาราง |
| `packages/design` | สี ฟอนต์ และระยะห่างสำหรับโหมดสว่างและมืด |
| `packages/pdf-templates` | แม่แบบของรายงาน PDF |

บริการสี่ตัวทำงานใน Docker: `postgres` (ฐานข้อมูล), `redis` (คิวงานและแคช),
`minio` (ที่เก็บแฟ้ม เช่น PDF ที่อัปโหลด) และ `gotenberg` (แปลงหน้าเป็น PDF)

รายละเอียดเพิ่มเติม: [Architecture](../architecture.md) และ
[คู่มือผู้นำไปใช้](../adopters/README.th.md)

## ไล่ตามส่วนหนึ่งของ Deep-Dive ตั้งแต่ต้นจนจบ

ส่วน Finance ของ Deep-Dive เป็นเส้นทางสั้น ๆ ที่ผ่านทุกชั้น

1. **หน้าเว็บ** `apps/web/app/programs/[id]/page.tsx` ขอข้อมูลแต่ละส่วนจาก API
   สำหรับ Finance จะเรียก `/programs/<id>/financials` และ `FinancialsSection`
   ใน `client.tsx` ในโฟลเดอร์เดียวกันเป็นผู้วาด
2. **Endpoint** ใน `apps/api/src/programs/deep-dive.controller.ts` เมธอด
   `@Get('financials')` มีเครื่องหมายสามอย่าง:
   - `@Authorized('financials:read:all')`: เรียกได้เฉพาะผู้ใช้ที่มีสิทธิ์นี้
   - `@Provenance(...)`: แหล่งข้อมูลและเวอร์ชันวิธีการที่แสดงในหน้าต่าง provenance ของกราฟ
   - `assertProgramAccessible(...)`: ขอบเขตของผู้ใช้ต้องครอบคลุมหลักสูตรนี้
3. **Query** เรียก `programFinancials` ใน `packages/db/src/program-deep-dive.ts`
   ซึ่งอ่านตาราง `financial_metrics` ด้วย `realDataWhere()`

**ทำไม `realDataWhere()` จึงสำคัญ** ฟังก์ชันนี้เก็บเฉพาะแถวที่มาจากแหล่งข้อมูลจริง คือการอัปโหลด
หรือการรัน connector ที่ไม่ใช่ข้อมูลจำลอง แถวที่ไม่มีการเชื่อมโยงนี้จะถูกซ่อน นี่คือเหตุผลที่บางส่วนแสดงว่างเปล่า
แม้มีแถวอยู่ในฐานข้อมูล และเป็นเหตุผลที่โค้ดของท่านต้องบันทึกว่าแต่ละแถวมาจากการรันใด

ให้ assistant ไล่เส้นทางเดียวกันไปพร้อมกับท่าน:

```text
Trace the Finance section of the Program Deep-Dive from apps/web/app/programs/[id]/page.tsx
to the database. For each step name the file and function, and explain what
@Authorized, @Provenance and realDataWhere() each do there. Do not change any file.
```

จากนั้นลองอีกส่วนหนึ่งด้วยตนเอง:

```text
Which API endpoint and which database function feed the "Outcomes"
section of the Program Deep-Dive? Show the file paths.
```

## กติกาที่ทุกการแก้ไขต้องทำตาม

ระบบนี้สร้างขึ้นเพื่อการตัดสินใจเรื่องการเปิด ควบรวม หรือปิดหลักสูตร ทุกตัวเลขจึงต้องตรวจสอบย้อนกลับได้
โค้ดที่ท่านเพิ่มใน session 4 และ 5 ต้องทำตามกติกาเหล่านี้:

1. **ทุกกราฟแสดงว่าข้อมูลมาจากที่ใด** ปุ่ม provenance เปิดแสดงแหล่งข้อมูล ความใหม่ วิธีการ และเวอร์ชัน
2. **ทุกผลลัพธ์จาก AI แสดงความเชื่อมั่นและแหล่งที่มา** และให้ผู้อ่านแสดงความเห็นแย้งได้
3. **ทุกจุดข้อมูลแสดงว่าข้อมูลใหม่เพียงใด**
4. **ทุกการแก้ไขข้อมูลถูกบันทึกใน audit log** ผ่าน `@AuditLog()`
5. **ทุกการเรียก AI ถูกบันทึก** ผ่าน `@AiCall()`
6. **ทุกการคำนวณมีเวอร์ชันของวิธีการ** อธิบายไว้ใน `docs/methodologies/`

นอกจากนี้: TypeScript แบบ strict ห้ามใช้ `any` ตรวจข้อมูลนำเข้าด้วย Zod และใช้สีจาก design token เท่านั้น
รายการทั้งหมดอยู่ใน [project contract](../../CLAUDE.md)

## เริ่มแอปและยืนยันผู้ดูแลระบบ

ทำตาม [Getting started](../tutorials/getting-started.th.md) ขั้นที่ 5, 6 และ 7:
เริ่มแอปด้วย `pnpm dev` ตรวจสอบว่าทำงานปกติ และยืนยันผู้ดูแลระบบคนแรกที่ `/setup`
ทำขั้นที่ 7 ทันที เพราะผู้ที่เปิดหน้า setup คนแรกจะได้เป็นผู้ดูแลระบบ

## เสร็จเมื่อ

- `http://localhost:3000` แสดงแอป และท่านลงชื่อเข้าใช้ในฐานะผู้ดูแลระบบ
- `http://localhost:4000/api/v1/ready` รายงานว่าทุกส่วนที่ระบบพึ่งพาทำงานปกติ
- ท่านบอกชื่อแฟ้มทั้งสามบนเส้นทางของส่วน Finance ได้
