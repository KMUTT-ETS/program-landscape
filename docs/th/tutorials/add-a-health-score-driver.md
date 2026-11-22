# บทเรียน: เพิ่ม driver ของ health score

> **English:** [`add-a-health-score-driver.md`](../../tutorials/add-a-health-score-driver.md)

**ผลลัพธ์** driver ใหม่ชื่อ `employer_satisfaction` คำนวณจากชุดข้อมูล Employer Feedback ที่ท่านโหลดอยู่แล้ว แสดงใน drawer ของมิติ Outcomes ใน Program Deep-Dive พร้อมปี จำนวนผู้ตอบ และค่าเฉลี่ย roll up ไปยังระดับคณะและมหาวิทยาลัยได้ ทุกคะแนนประทับ methodology version ของสถาบันท่านเอง และ tests ของ health score ผ่านทั้งหมด

**จุดเริ่มต้น** dev stack ที่รันอยู่ และนำเข้ามหาวิทยาลัยจำลองไว้แล้ว (`pnpm workshop:mock` แล้วอัปโหลดที่ `/admin/data-setup`) รวมถึงชีต Employer Feedback ตรวจได้โดยเปิด Deep-Dive ของหลักสูตรใดก็ได้ แล้วดูรายการ Top employers คำสั่งทุกคำสั่งด้านล่างรันจากโฟลเดอร์ราก (root) ของ repository

**เวลา** ประมาณ 80 นาที ไม่มีค่าใช้จ่าย AI

การแก้ 7 จุดเดียวกันนี้ใช้ได้กับทุกชุดข้อมูลที่สถาบันของท่านโหลดอยู่แล้ว แผนที่ของโฟลเดอร์อยู่ที่ `packages/db/src/health-score/README.md` ให้เปิดค้างไว้อีกแท็บ

## ก่อนเริ่ม

ทำบน branch สำหรับฝึก anchor ด้านล่าง (0.60 และ 0.95) เป็นค่าสมมติสำหรับบทเรียนนี้ และ revision `workshop.1` ห้ามนำขึ้นระบบจริง เมื่อทำจริง ให้เลือก anchor จากข้อมูลของท่านเอง และใช้ prefix ของ revision ของสถาบันท่าน (ขั้นที่ 6)

ตอบคำถามนี้ก่อน: Deep-Dive แสดงความพึงพอใจของนายจ้างอยู่แล้ว แต่มันเปลี่ยน health score หรือไม่? คำตอบคือไม่ ชีต Employer Feedback ใช้แค่รายการ Top employers ไม่มี driver ของ health score ตัวไหนอ่านมัน บทเรียนนี้จะทำให้มันเป็น driver ในมิติ Outcomes เพราะเป็นการประเมินบัณฑิต เหมือน `employment_rate` และ `job_relevance` ส่วนมิติ Relevance ถามคนละคำถาม (หลักสูตรตรงกับความต้องการหรือไม่)

## Driver ทำงานอย่างไร

Driver แปลงแถวของชุดข้อมูลเป็นคะแนน 0 ถึง 100 หนึ่งค่า หรือ null

| ขั้น | เกิดอะไรขึ้น | อยู่ที่ไหน |
|---|---|---|
| 1. Rows | นับเฉพาะแถวที่อัปโหลดจริง: ทุก query ต้องใส่ `...realDataWhere()` | ไฟล์ของมิติ |
| 2. Raw figure | ค่าที่คำนวณได้ พร้อมปีและขนาดตัวอย่าง | field `raw` ของ driver ซึ่ง drawer ใน Deep-Dive แสดงผล |
| 3. Curve | anchor สองจุด: เท่ากับหรือต่ำกว่าจุดล่างได้ 0 เท่ากับหรือสูงกว่าจุดบนได้ 100 ระหว่างนั้นเป็นเส้นตรง | `tuning.ts` |
| 4. Driver | ตัวเลข 0 ถึง 100 หรือ null เมื่อข้อมูลไม่พอจะสรุปได้ | `{ label, value, raw }` |

คะแนนของมิติคือค่าเฉลี่ยของ driver ที่**ไม่เป็น null** คะแนนรวมคือค่าเฉลี่ยของห้ามิติ

### Object ของ driver

ทุก driver คืนค่ารูปแบบเดียวกัน กำหนดโดย Zod schema ใน `packages/db/src/health-score/schema.ts`

```ts
drivers: z.array(
  z.object({
    label: z.string(),
    value: z.number().min(0).max(100).nullable(),
    raw: z.unknown(),
  }),
),

// HealthScore['drivers'][number] =
//   { label: string; value: number | null; raw: unknown }
```

| Key | ความหมาย |
|---|---|
| `label` | ต้องตรงกับรายการใน `DIMENSION_DRIVERS` ไม่เช่นนั้นจะถูกนับว่าไม่ได้คำนวณ |
| `value` | คะแนน 0–100 หลังผ่าน curve ค่า `null` แปลว่าไม่มีข้อมูล ไม่นับในค่าเฉลี่ย และไม่เคยนับเป็น 0 |
| `raw` | หลักฐานสำหรับ drawer: ปี จำนวนผู้ตอบ ค่าเฉลี่ย และ `reason` เมื่อ `value` เป็น null |

Type ไม่ตรวจช่วง 0–100 และไม่ตรวจการสะกด label ให้เรียก `clamp()` และคัดลอก label จาก `drivers.ts` ถ้าสะกด label ผิด เช่น `employer_satisfication` typecheck จะผ่าน แต่ driver จะหายจาก Outcomes และ completeness ลดลง

### กฎ null

สมมติว่าหลักสูตรหนึ่งยังไม่มีผลสำรวจนายจ้าง driver ควรได้ 0 หรือไม่นับเลย?

| | `employment_rate` | `student_satisfaction` | `employer_satisfaction` | Outcomes |
|---|---|---|---|---|
| A: ให้ 0 | 80 | 70 | 0 | 50 |
| B: ไม่นับ | 80 | 70 | null | 75, completeness 67% |

B คือกฎ การ์ด A ลงโทษหลักสูตร 25 คะแนนจากการสำรวจที่ไม่เคยทำ และกรรมการสภามหาวิทยาลัยจะอ่านว่า "นายจ้างไม่พอใจบัณฑิตของเรา" การ์ด B ไม่นำ driver นี้เข้าค่าเฉลี่ย และ completeness ที่ลดลงบอกผู้อ่านว่าขาดข้อมูลอะไร Driver คืน null พร้อมเหตุผลใน `raw` ไม่ใช่ 0 และไม่ใช่ 50

## การแก้ 7 จุด

path ทั้งหมดอยู่ใต้ `packages/db/src/` เว้นแต่ระบุไว้

| ขั้น | ไฟล์ | สิ่งที่แก้ |
|---|---|---|
| 2 | `health-score/drivers.ts` | ลงทะเบียน label |
| 3 | `health-score/tuning.ts` | รวมตัวเลขทุกตัวไว้ที่เดียว |
| 4 | `health-score/outcomes.ts`, `scoreOutcomesProgram` | คำนวณสำหรับหนึ่งหลักสูตร |
| 5 | `health-score/outcomes.ts`, `scoreOutcomesScope` | Roll up ไปยังคณะและมหาวิทยาลัย |
| 6 | `health-score/tuning.ts`, `INSTITUTION_REVISION` | ประทับ methodology version ใหม่ |
| 7 | `packages/db/test/` | pin, parity และ checklist tests |
| 8 | `program-setup-checklist.ts`, docs site, methodology | บอกว่าตัวเลขมาจากไหน |

ขั้นที่ 4 และ 5 อยู่ในไฟล์มิติเดียวกัน ทุกมิติมี programme scorer และ scope scorer ต้องแก้ทั้งคู่ ก่อน v5.0 scope scorer ตามหลังอยู่ 2 ถึง 4 driver ทำให้ทุกคณะได้คะแนนต่ำกว่าหลักสูตรของตัวเองราว 12 คะแนน ตอนนี้ parity test จับเรื่องนี้ได้

## ขั้นที่ 1: ออกแบบ driver บนกระดาษ

เขียน driver card ก่อนเขียนโค้ด ชีต Employer Feedback (`employer-feedback` ใน [การนำเข้าจาก spreadsheet](../data-import.md)) มีคอลัมน์ดังนี้

| Programme Code | Survey Year | Employer | Satisfaction (0–1) | Respondents |
|---|---|---|---|---|
| ENG-ME-BSC | 2024 | ว่าง = All employers | 0.87 | 12 |

หนึ่งแถวต่อหลักสูตร ปีที่สำรวจ และนายจ้าง หรือหนึ่งแถวที่ช่อง Employer ว่าง หมายถึงนายจ้างทั้งหมดรวมกัน ตอน import ระบบปฏิเสธแถวที่มีผู้ตอบน้อยกว่า 5 คน

เขียนหกบรรทัด: label, มิติ, raw figure คำนวณจากแถวไหน, ค่าไหนได้ 0 และค่าไหนได้ 100, เป็น null เมื่อใด และระดับคณะ roll up อย่างไร จากนั้นเทียบกับการ์ดนี้

| บรรทัด | คำตอบของเรา |
|---|---|
| Label | `employer_satisfaction` |
| มิติ | Outcomes คู่กับ `employment_rate` และ `job_relevance` |
| Raw figure | ใช้ปีสำรวจล่าสุด ถ้ามีแถว "All employers" ใช้แถวนั้น ถ้าไม่มี ใช้ค่าเฉลี่ยถ่วงน้ำหนักตามจำนวนผู้ตอบของแถวในปีนั้น |
| Curve | 0.60 → 0, 0.95 → 100 แบบ linear |
| เป็น null เมื่อ | ไม่มีผลสำรวจ หรือผู้ตอบน้อยกว่า 10 คน |
| Roll-up ระดับคณะ | ค่าเฉลี่ยของค่า driver แต่ละหลักสูตร |

เหตุผลของแต่ละบรรทัด

- **ใช้ปีล่าสุดปีเดียว** ผลดีในอดีตจึงไม่บังผลแย่ล่าสุด
- **แถว All employers มาก่อน** ถ้าสถาบันให้ตัวเลขภาพรวมมา เราเชื่อตัวเลขนั้น แทนที่จะคำนวณใหม่จากรายชื่อนายจ้างที่ไม่ครบ
- **ถ่วงน้ำหนักตามจำนวนผู้ตอบ** นายจ้างที่มีผู้ตอบ 5 คนจึงไม่มีน้ำหนักเท่ากับนายจ้างที่มี 40 คน
- **anchor 0.60 และ 0.95** เป็นค่าสมมติสำหรับบทเรียนนี้ เมื่อใช้จริง ให้ดูการกระจายของข้อมูลสถาบันท่าน แล้ววาง anchor ให้แยกหลักสูตรออกจากกันได้
- **ผู้ตอบอย่างน้อย 10 คน** ตอน import ปฏิเสธแถวที่ต่ำกว่า 5 คนอยู่แล้วเพื่อความเป็นส่วนตัว 10 คนคือเกณฑ์ความเสถียรของคะแนน
- **ระดับคณะใช้ค่าเฉลี่ยของค่าหลักสูตร** แต่ละหลักสูตรสำรวจคนละปี ถ้ารวมแถวดิบจะปนหลายปี ค่าเฉลี่ยของค่าหลักสูตรรักษา calibration ของแต่ละหลักสูตรไว้

ไม่มีการ์ดที่ถูกเพียงใบเดียว แต่ทุกบรรทัดต้องอธิบายต่อสภามหาวิทยาลัยได้

## ขั้นที่ 2: ลงทะเบียน label

ใน `packages/db/src/health-score/drivers.ts` เพิ่ม label ในรายการ Outcomes ของ `DIMENSION_DRIVERS`

```ts
export const DIMENSION_DRIVERS = {
  // …attractiveness, financial, capability…
  outcomes: [
    'tcas_min_score_percentile',
    'employment_rate',
    'job_relevance',
    'average_salary',
    'further_study_rate',
    'student_satisfaction',
    'dq_digital_competency',
    'employer_satisfaction', // new
  ],
```

รายการนี้คือ registry หลัก `summariseDrivers` จะเติม label ที่ scorer ไม่ได้สร้างด้วยค่า null ที่ทำเครื่องหมายว่า "not computed at this scope" และนับเป็นข้อมูลที่ขาดใน completeness ดังนั้นถ้าหยุดหลังขั้นนี้ ระบบไม่พัง มิติ Outcomes แค่รายงานว่าขาดข้อมูลเพิ่มหนึ่งตัว scorer ที่ลืมแก้จึงโผล่เป็น completeness ที่ลดลง แทนที่จะหายไปเงียบ ๆ

ท่านควรเห็น label อยู่ในรายการ จากนี้ให้ copy-paste เพราะขั้นที่ 4, 5 และ 8 ใช้ string เดียวกัน

## ขั้นที่ 3: ใส่ตัวเลขใน tuning.ts

ใน `packages/db/src/health-score/tuning.ts` ภายในบล็อก `outcomes` ให้เพิ่ม

```ts
  outcomes: {
    // …tcasPercentileMinPeers, averageSalary, furtherStudy…
    studentSatisfaction: { zeroAtRating: 3.5, fullAtRating: 5.0 },
    /** `employer_satisfaction` — employer satisfaction (0–1), latest
     *  survey year. zeroAt → 0, fullAt → 100, linear.
     *  Null under minRespondents. */
    employerSatisfaction: { zeroAt: 0.6, fullAt: 0.95, minRespondents: 10 },
  },
```

ตัวเลขทุกตัวที่แปลงค่าดิบเป็นคะแนนอยู่ใน `tuning.ts` จัดกลุ่มตามมิติและตั้งชื่อตาม driver ห้ามฝังค่า threshold ไว้ใน scorer: สถาบันผู้นำไปใช้ปรับตัวเลขที่นี่ได้โดยไม่ต้องอ่านโค้ด scorer และ tuning-pin test ทำ fingerprint ของ object นี้ การเปลี่ยนแปลงใด ๆ จึงถูกตรวจพบ บล็อกนี้ประกาศเป็น `as const` key ใหม่จึงได้ type อัตโนมัติ

การเลือก anchor: `student_satisfaction` ใช้ช่วง 3.5 ถึง 5.0 แทน 1 ถึง 5 เพราะคะแนน 95% อยู่ในช่วงนั้น ถ้าใช้ 1 ถึง 5 ทุกหลักสูตรจะได้ 75 ถึง 100 หมด ให้ถามข้อมูลของท่านแบบเดียวกัน: query `satisfaction_score` รายหลักสูตร แล้ววาง anchor ให้แยกหลักสูตรออกจากกัน

## ขั้นที่ 4: คำนวณ driver สำหรับหนึ่งหลักสูตร

เปิด `packages/db/src/health-score/outcomes.ts` ไฟล์นี้ import `prisma`, `realDataWhere`, `HealthScore`, `clamp` และ `T` (`HEALTH_SCORE_TUNING.outcomes`) ไว้แล้ว

1. เพิ่ม import ด้านบนของไฟล์ รวมกับ import อื่น

   ```ts
   import { ALL_EMPLOYERS } from '../import/datasets/employer-feedback';
   ```

2. เพิ่มฟังก์ชันใกล้ `studentSatisfactionDriver` เริ่มจากอ่านแถวและเลือกผลสำรวจล่าสุด

   ```ts
   async function employerSatisfactionDriver(
     programId: string,
   ): Promise<HealthScore['drivers'][number]> {
     const label = 'employer_satisfaction';
     const rows = await prisma.employerFeedback.findMany({
       where: { programId, ...realDataWhere() },
       orderBy: { year: 'desc' },
     });
     const year = rows[0]?.year ?? null;
     const latest = rows.filter((r) => r.year === year);
     const all = latest.find((r) => r.employerName === ALL_EMPLOYERS);
     const used = all ? [all] : latest;
   ```

   - `realDataWhere()` เก็บเฉพาะแถวที่ ingestion run มาจาก data source ที่ไม่ใช่ mock ถ้าลืม ข้อมูล seed หรือ mock จะหลุดเข้าไปในตัวเลขที่เสนอสภามหาวิทยาลัย การ import Employer Feedback ติด run ให้ทุกแถว แถวที่อัปโหลดจึงผ่าน
   - การเรียง `year` จากมากไปน้อยทำให้ `rows[0]` คือผลสำรวจล่าสุด
   - `ALL_EMPLOYERS` คือค่าคงที่ที่ import เขียนเมื่อช่อง Employer ว่าง ให้ใช้ค่าคงที่นี้แทนการพิมพ์ string เอง

3. จากนั้นเขียนกรณี null ก่อน แล้วจึงคิดคะแนน

   ```ts
     const n = used.reduce((s, r) => s + r.sampleSize, 0);
     if (n < T.employerSatisfaction.minRespondents) {
       const reason = n === 0 ? 'no-survey' : 'too-few-respondents';
       return { label, value: null, raw: { year, respondents: n, reason } };
     }
     const mean = used.reduce((s, r) => s + r.satisfactionScore * r.sampleSize, 0) / n;
     const { zeroAt, fullAt } = T.employerSatisfaction;
     const value = clamp(((mean - zeroAt) / (fullAt - zeroAt)) * 100);
     const basis = all ? 'all-employers' : 'respondent-weighted';
     return { label, value, raw: { year, respondents: n, mean, basis } };
   }
   ```

   string เหตุผลอยู่ใน `raw` ซึ่ง Setup checklist และ drawer ใน Deep-Dive แสดงผล ผู้ดูแลระบบจึงแยกได้ว่า "ยังไม่อัปโหลดผลสำรวจ" หรือ "ผู้ตอบน้อยเกินไป" สิ่งที่ผู้อ่านต้องใช้ตรวจตัวเลขก็เก็บไว้ใน `raw` ด้วย

4. เรียกใช้จาก `scoreOutcomesProgram` ใน array `drivers` ต่อจาก `studentSatisfactionDriver`

   ```ts
       await employerSatisfactionDriver(programId), // new
   ```

   ลำดับใน array ไม่สำคัญ เพราะ `summariseDrivers` เรียงตามลำดับใน `drivers.ts`

ถ้ามีเวลา รัน `pnpm typecheck` เลย จะจับชื่อ field ที่สะกดผิดได้

## ขั้นที่ 5: Roll up ไปยังคณะและมหาวิทยาลัย

หลักสูตรในคณะเดียวกันสำรวจคนละปี คณะจึงรวมแถวดิบไม่ได้ แต่ใช้ค่าเฉลี่ยของค่า driver ของหลักสูตรแทน ใน `scoreOutcomesScope` มี `programIds` และ `index` ประกาศไว้แล้วเหนือ `drivers.push` เดิม ให้เพิ่มหนึ่งบรรทัด

```ts
drivers.push(
  rolledUpDriver(index, programIds, 'outcomes', 'job_relevance'),
  rolledUpDriver(index, programIds, 'outcomes', 'further_study_rate'),
  rolledUpDriver(index, programIds, 'outcomes', 'tcas_min_score_percentile'),
  rolledUpDriver(index, programIds, 'outcomes', 'employer_satisfaction'), // new
);
```

`rolledUpDriver(index, programIds, dimension, label)` อ่านคะแนนหลักสูตรที่ memoise ไว้ แล้วเฉลี่ยค่าที่ไม่เป็น null ถ้าไม่มีเลยได้ null

การรวมแถวดิบ (ratio of sums) ถูกต้องสำหรับ driver ที่สเกลเหมือนกันทุกระดับ เช่นสัดส่วนธรรมดา แต่ไม่ถูกในกรณีนี้ เพราะแต่ละหลักสูตรเลือกปีล่าสุดของตัวเอง การรวมแถวดิบจะปนผลสำรวจปี 2022 กับปี 2025 กฎตั้งแต่ v5.0: driver ที่ calibrate รายหลักสูตร ให้ roll up เป็นค่าเฉลี่ยของค่าหลักสูตร ถ้าข้ามขั้นนี้ parity test จะ fail และ completeness ระดับคณะจะลดลง

## ขั้นที่ 6: ประทับ methodology version ใหม่

สูตรใหม่ต้องมี version ใหม่ ใน `packages/db/src/health-score/tuning.ts`

```ts
// was: = null
export const INSTITUTION_REVISION: string | null = 'workshop.1';
```

ทุกคะแนนที่คำนวณหลังจากนี้จะประทับเป็น `health-score.v5.6+workshop.1` แทน `health-score.v5.6`

การเพิ่ม driver เปลี่ยนค่าเฉลี่ยของ Outcomes และคะแนนรวม เอกสาร Council pack ที่พิมพ์เมื่อวานกับวันนี้จึงต้องระบุได้ว่าใช้สูตรใด ระบบต่อท้าย revision ของท่านเข้ากับ version upstream คะแนนของท่านจึงไม่มีทางถูกเข้าใจผิดว่าเป็นคะแนน upstream ของ มข.

สถาบันผู้นำไปใช้แก้เฉพาะ `INSTITUTION_REVISION` ห้ามแก้ `UPSTREAM_HEALTH_SCORE_VERSION` ใน `version.ts` เมื่อใช้ที่สถาบันของท่าน ให้ใช้ prefix ของตัวเอง เช่น `'kmutt.1'` และเพิ่มเลข (`kmutt.2`) ทุกครั้งที่แก้ tuning หรือตรรกะ ห้ามแก้ version ที่เผยแพร่ไปแล้วทับของเดิม ดู [ปรับ methodology ให้เข้ากับสถาบันของท่าน](../guides/adapt-a-methodology.md)

## ขั้นที่ 7: รัน tests แล้วแก้บรรทัดแดงทีละข้อ

```bash
pnpm --filter @kku/db test health-score
pnpm --filter @kku/db test program-setup-checklist
pnpm --filter @kku/db test deep-dive-data-map-doc
```

filter `health-score` จับทุกไฟล์ `health-score*.test.ts` คาดว่าจะเจอบางข้อในตารางนี้ ให้อ่านข้อความจริงที่ได้ ซึ่งอาจต่างกันตาม branch

| Test ที่ fail | สาเหตุ | วิธีแก้ |
|---|---|---|
| `health-score-tuning-pin` | tuning เปลี่ยน แต่ยังไม่ได้ pin `workshop.1` | คัดลอก fingerprint ที่ test พิมพ์ออกมาใส่ใน `PINNED` ของ `packages/db/test/health-score-tuning-pin.test.ts` โดยเก็บบรรทัดเดิมไว้ |
| `health-score-driver-parity`, `health-score` | Prisma mock ยังไม่มี `employerFeedback` จึง throw `Cannot read properties of undefined (reading 'findMany')` | ดูด้านล่าง |
| `program-setup-checklist` | label ใหม่ยังไม่มี data source | ขั้นที่ 8a |
| `deep-dive-data-map-doc` | data map ใน docs site ยังไม่มี driver ใหม่ | ขั้นที่ 8b |

สำหรับ Prisma mock ให้แก้ในแต่ละไฟล์ test ที่ fail

1. ใน mocks ของ `vi.hoisted` เพิ่ม `employerFeedbackFindMany: vi.fn()`
2. ใน mock ของ `prisma` เพิ่ม `employerFeedback: { findMany: mocks.employerFeedbackFindMany }`
3. ใน `beforeEach` เพิ่ม `mocks.employerFeedbackFindMany.mockResolvedValue([])`

จากนั้นเขียน test ของท่านเองหนึ่งข้อ

- mock สองแถวในปีเดียวกัน: ความพึงพอใจ 0.8 ผู้ตอบ 10 คน และ 0.9 ผู้ตอบ 30 คน แล้ว assert ว่า `raw.mean` เป็น 0.875 และ `value` ประมาณ 78.6 (`(0.875 − 0.60) / 0.35 × 100`)
- mock `[]` แล้ว assert ว่า `value` เป็น null และ `raw.reason` เป็น `'no-survey'`

เทียบจำนวนไฟล์และจำนวน test ก่อนและหลัง ไม่ใช่ดูแค่บรรทัดที่บอกว่าผ่าน เพราะ vitest `include` ที่แคบลงจะตัด test ทิ้งแบบเงียบ ๆ

## ขั้นที่ 8: บอกว่าตัวเลขมาจากไหน

**a. Setup checklist** ใน `packages/db/src/program-setup-checklist.ts` เพิ่มแถวต่อจาก `driver.student_satisfaction`

```ts
'driver.employer_satisfaction': [ds('employer-feedback', 'Employer feedback')],
```

checklist (`/admin/programs/<id>?tab=checklist`) มีหนึ่งแถวต่อ driver และบอกผู้ดูแลระบบว่าต้องอัปโหลดอะไร `'employer-feedback'` คือ slug ของชุดข้อมูล แถวนี้จึงลิงก์ไปยังการอัปโหลดที่ถูกต้อง

**b. Deep-Dive data map** ใน `apps/docs-site/.vitepress/theme/deep-dive-data-map/data.ts` เพิ่มแถวต่อจาก `student_satisfaction`

```ts
{ dimension: 'outcomes', key: 'employer_satisfaction', name: 'Employer satisfaction',
  how: 'Respondent-weighted employer satisfaction: 0.60 gives 0, 0.95 gives 100.',
  in: ['employer'] },
```

`'employer'` คือ id ของชีต Employer feedback ที่ประกาศไว้แล้วในไฟล์นั้น

**c. Methodology** ในสำเนา `docs/methodologies/health-score.md` ของท่าน เพิ่มหัวข้อสั้น ๆ สำหรับ `+workshop.1`: สูตร anchor และเหตุผล เมื่อใดเป็น null และกฎ roll-up หน้านี้คือเอกสารอ้างอิงหลักที่เสนอสภามหาวิทยาลัย กฎของโครงการคือเขียน methodology ก่อนเมื่อเปลี่ยนสูตร บทเรียนนี้เขียนท้ายสุดเพื่อให้เห็นโค้ดก่อน จากนั้นรัน

```bash
pnpm docs:build
```

คำสั่งนี้จะ fail ถ้ามีลิงก์เสีย

รันสามคำสั่ง test จากขั้นที่ 7 อีกครั้ง ทุกข้อควรผ่าน

## ขั้นที่ 9: ตรวจผลในแอป

1. **Restart api** `nest start --watch` ดูแค่ `apps/api/src` และทุกอย่างที่แก้ในบทเรียนนี้อยู่ใต้ `packages/db` api ที่รันค้างอยู่จึงยังใช้โค้ดเก่า ให้หยุดแล้วเริ่ม `pnpm dev` ใหม่ (หรือเฉพาะ api) การ restart ยังล้าง programme score index ที่ memoise ไว้ ซึ่ง `rolledUpDriver` อ่านอยู่ด้วย
2. **Deep-Dive** เปิดหลักสูตรที่มีแถว Employer Feedback (รายการ Top employers ไม่ว่าง) ใน drawer ของ Outcomes ท่านควรเห็น `employer_satisfaction` มีค่า และ `raw` แสดง year, respondents, mean และ basis
3. **หลักสูตรที่ไม่มีข้อมูลนายจ้าง** driver เป็น null พร้อม reason `no-survey` และ completeness ของ Outcomes ลดลงตาม
4. **Setup checklist** ที่ `/admin/programs/<id>?tab=checklist` แถวของ driver เป็นสีเขียว หรือแสดงเหตุผลของ null
5. **ระดับคณะ** เปลี่ยน scope selector เป็นคณะของหลักสูตรนั้น driver ต้องมีค่า ไม่ใช่ "not computed"

## เมื่อ driver ไม่ขึ้น

| สิ่งที่เห็น | สาเหตุ | วิธีแก้ |
|---|---|---|
| แก้โค้ดแล้วไม่มีอะไรเปลี่ยน | api ยังรันโค้ด `packages/` ชุดเก่า | Restart api และดูเวลาเริ่มของ process |
| Driver หายไป และ completeness ของ Outcomes ลด | ลงทะเบียน label แล้ว แต่ยังไม่มี scorer สร้าง driver นี้ | ขั้นที่ 4 ข้อ 4: เพิ่มการเรียกใน array `drivers` |
| เป็น null `no-survey` ทั้งที่อัปโหลดชีตแล้ว | แถวไม่ถูกนับเป็นข้อมูลจริง | รัน `pnpm data-sources:sync --apply` แล้วอัปโหลดใหม่ |
| ระดับคณะขึ้นว่า "not computed" | scope scorer ยังไม่มี roll-up | ขั้นที่ 5: บรรทัด `rolledUpDriver` |
| ทุกหลักสูตรได้คะแนนใกล้เคียงกันหมด | anchor อยู่นอกช่วงการกระจายของข้อมูล | เลือก anchor ใหม่ใน `tuning.ts` แล้วเพิ่ม revision |

แถวที่ 3 คือกับดัก UI ว่างแบบเงียบ: `realDataWhere()` นับเฉพาะแถวที่ ingestion run มาจาก data source ที่ `mocked = false` และทุกชุดข้อมูล XLSX ต้องมีรายการใน catalogue (ในที่นี้คือ `xlsx-employer-feedback`) คำสั่ง `pnpm data-sources:sync --apply` ซ่อม dev database ที่ไม่ตรงกับ catalogue

แถวที่ 5: ถ้าความพึงพอใจของทุกหลักสูตรอยู่ระหว่าง 0.85 ถึง 0.95 anchor 0.60–0.95 จะบีบทุกหลักสูตรไปอยู่ในช่วงบนหนึ่งในสาม ให้ query การกระจาย ย้าย anchor แล้วเพิ่ม `INSTITUTION_REVISION` เพราะสูตรเปลี่ยน

## แบบฝึกหัด: driver ตัวต่อไปของท่าน

Driver คือ query หนึ่งตัว curve หนึ่งเส้น และ null ที่ซื่อตรง การแก้ส่วนที่เหลือ (registry, scope roll-up, version, tests, checklist, docs) ทำให้ driver ปลอดภัยและมองเห็นได้

เลือกชุดข้อมูลที่สถาบันของท่านโหลดอยู่แล้ว จาก 26 ชุดข้อมูลที่นำเข้าได้ (เช่น class offerings, cohorts, compensation, staff salary by funding หรือ external grants) แล้วเขียน driver card: ชุดข้อมูล, label และมิติ, และเป็น null เมื่อใด จากนั้นทำขั้นที่ 2–9 ซ้ำ โดยใช้ prefix ของ revision ของท่านเอง และ anchor จากข้อมูลของท่านเอง

## ขั้นต่อไป

- [ปรับ methodology ให้เข้ากับสถาบันของท่าน](../guides/adapt-a-methodology.md) สำหรับกฎเรื่อง version เอกสาร และกฎ null
- [การนำเข้าจาก spreadsheet](../data-import.md) ว่าแต่ละชุดข้อมูลเก็บอะไร
- methodology ของ health score ที่ `docs/methodologies/health-score.md` และแผนที่โฟลเดอร์ที่ `packages/db/src/health-score/README.md`
