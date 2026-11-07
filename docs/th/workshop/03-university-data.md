# Session 3: การเชื่อมโยงข้อมูลมหาวิทยาลัย

> **English:** [`03-university-data.md`](../../workshop/03-university-data.md)

**เวลา** หนึ่งช่วงบ่าย ประมาณ 3 ชั่วโมง

**ผลลัพธ์** ท่านนำเข้าข้อมูลของมหาวิทยาลัยหนึ่งแห่งเข้าสู่ระบบ รัน pipeline กับหนึ่งหลักสูตรด้วย AI key ของท่านเอง
และเห็น Deep-Dive ของหลักสูตรนั้นแสดงเนื้อหา ทุกคนทำเส้นทางข้อมูลตัวอย่าง
หากนำแฟ้มของตนเองมา ให้ทำซ้ำด้วยแฟ้มเหล่านั้นต่อ

ขั้นตอนเป็นขั้นตอนเดียวกับ [Get Program Deep-Dive working](../tutorials/program-deep-dive.md)
หน้านี้บอกว่าใช้ค่าและแฟ้มใด และทำตามลำดับใด เพื่อให้ขั้นตอนที่ช้าทำงานไปพร้อมกับงานอื่น

## เริ่มขั้นตอนที่ใช้เวลานานก่อน

pipeline ใช้เวลาประมาณ 20 ถึง 25 นาทีต่อหนึ่งหลักสูตร และใช้เครดิต AI ประมาณ USD 0.40 ถึง 0.80
ข้อมูลประชากรของ UN มีขนาดประมาณ 68 MB ให้ทำขั้นตอนสั้น ๆ ก่อน เริ่มขั้นตอนยาวทั้งสอง
แล้วทำงานกับ Setup checklist ระหว่างรอ:

1. Organisation profile (5 นาที)
2. อัปโหลดแฟ้มตัวอย่าง 13 แฟ้ม (ประมาณ 20 นาที)
3. แนบ PDF หลักสูตร แล้ว **เริ่ม pipeline**
4. **เริ่ม connector `un-wpp`**
5. ระหว่างที่ทั้งสองทำงาน: อ่าน Setup checklist และส่วน mock API ด้านล่าง

## เส้นทางข้อมูลตัวอย่าง

### Organisation profile

เปิด `/admin/organization` แล้วกรอกแท็บ "Identity" ตามที่
[ขั้นตอนที่ 1](../tutorials/program-deep-dive.md#ขั้นตอนที่-1-ตั้งค่า-organisation-profile)
อธิบาย โดยใช้ค่าต่อไปนี้:

| ช่อง | ค่า |
|---|---|
| Thai name | มหาวิทยาลัยสาธิตเวิร์กช็อป |
| English name | Workshop Demo University |
| Thai short name | มสว. |
| English short name | WDU |
| Region (Thai) | ภาคตะวันออกเฉียงเหนือ |
| Region (English) | Northeast |
| OpenAlex institution ID | เว้นว่าง เพราะเป็นมหาวิทยาลัยสมมติ |

คลิก "Create organisation" ท่านควรเห็นชื่อปรากฏที่ส่วนหัว

### อัปโหลดแฟ้มตัวอย่าง

แฟ้มอยู่ใน `workshop/sample-data/` ใน repository ทุกบุคคลและทุกตัวเลขในแฟ้มเป็นข้อมูลสมมติ
อัปโหลดตามลำดับหมายเลข แต่ละแฟ้มที่หน้าชุดข้อมูลของตนใต้ `/admin/data-setup`
ด้วยปุ่ม "Upload filled template" ตามที่อธิบายใน
[ขั้นตอนที่ 2](../tutorials/program-deep-dive.md#ขั้นตอนที่-2-อัปโหลดโครงสร้างองค์กรและหลักสูตร)

| แฟ้ม | หน้าชุดข้อมูล |
|---|---|
| `01-faculties.xlsx` | Faculties |
| `02-departments.xlsx` | Departments |
| `03-programmes.xlsx` | Programmes |
| `04-faculty-members.xlsx` | Staff |
| `05-program-faculty.xlsx` | Programme Teaching Staff |
| `06-enrollment-metrics.xlsx` | Enrolment |
| `07-financial-metrics.xlsx` | Finance |
| `08-graduate-outcomes.xlsx` | Graduate Outcomes |
| `09-student-cohorts.xlsx` | Student Cohorts |
| `10-alumni-cohorts.xlsx` | Alumni Cohorts |
| `11-admission-campaigns.xlsx` | Admission Campaigns |
| `12-research-outputs.xlsx` | Publications |
| `13-programme-courses.xlsx` | Programme course lists |

จากนั้นอัปโหลด **University Rankings** ตามที่มีมา: เปิดหน้าของชุดข้อมูลนี้ ดาวน์โหลดแม่แบบ
แล้วอัปโหลดกลับโดยไม่แก้ไข

ท่านควรเห็นแต่ละการอัปโหลดในประวัติ "Uploads" พร้อมจำนวนแถว เปิดแฟ้มหนึ่งด้วยโปรแกรม spreadsheet
เพื่อดูว่าแม่แบบที่กรอกแล้วหน้าตาเป็นอย่างไร เพราะภายหลังท่านจะกรอกแม่แบบเดียวกันด้วยข้อมูลของท่าน

การอัปโหลดนับเป็นข้อมูลจริง เช่นเดียวกับการรัน connector กฎของ Setup checklist ที่ว่า
"แถวตัวอย่างไม่ทำให้รายการเป็นสีเขียว" หมายถึง connector จำลองที่มากับระบบ ไม่ใช่แฟ้มเหล่านี้

### Connector สาธารณะ

เปิด `/admin/data-sources` คลิก `un-wpp` แล้วคลิก "Run now" connector นี้ไม่ต้องใช้ key
และโหลดประมาณการประชากรของ UN ที่ใช้ในส่วน Demographic outlook

ข้าม connector อื่นในเส้นทางข้อมูลตัวอย่าง:

- `tcas` จับคู่หลักสูตรด้วยชื่อภาษาไทยของมหาวิทยาลัย และมหาวิทยาลัยสมมติไม่มีในตาราง TCAS ใด
- `openalex-works` ต้องใช้ OpenAlex institution ID จริง
- `kmitl-skill-mapping` ต้องใช้ข้อมูลรับรองของ KMITL หากผู้จัดให้มา ให้รัน connector นี้
  แล้วรันคำสั่งใน [ทักษะตลาดแรงงาน](../tutorials/program-deep-dive.md#labour-market-skills)
  ซึ่งใช้เวลาประมาณหนึ่งชั่วโมง จึงควรเริ่มก่อน pipeline

### PDF หลักสูตรและ pipeline

1. เปิด `/admin/programs` แล้วคลิกหลักสูตร `WDU-CPE-BE` วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์
2. ในแท็บ "Files" (แสดงเป็น "Files (0)" จนกว่าจะแนบแฟ้ม) เลือกบทบาท `CURRENT_CURRICULUM` แล้วอัปโหลด
   `workshop/sample-data/curriculum/workshop-demo-curriculum.pdf`
3. ในแท็บ "Pipeline history" คลิก "Run full pipeline" หรือรันจาก terminal:

```bash
pnpm programs:pipeline WDU-CPE-BE
```

ท่านควรเห็นแต่ละ phase เสร็จทีละขั้น phase รายวิชาจะรายงานว่ารายการรายวิชาของหลักสูตรมาจากการอัปโหลด
ซึ่งเป็นเรื่องปกติ เพราะรายการที่อัปโหลดมีลำดับเหนือกว่า PDF เสมอ ส่วนอื่นของ pipeline อ่าน PDF
เพื่อดึงคำอธิบายหลักสูตร ผลลัพธ์การเรียนรู้ และคำอธิบายรายวิชา

### Setup checklist

เปิดแท็บ "Setup checklist" ของหลักสูตร ตาม
[ขั้นตอนที่ 6](../tutorials/program-deep-dive.md#ขั้นตอนที่-6-ทำให้-setup-checklist-เป็นสีเขียว)
รายการสีแดงแต่ละรายการระบุสิ่งที่ขาด

บางรายการยังคงเป็นสีแดงหรือ "not applicable" ในเส้นทางข้อมูลตัวอย่าง ซึ่งถูกต้องแล้ว:

- รายการที่ต้องใช้ตัวเลข **TCAS** เพราะมหาวิทยาลัยสมมติไม่มีข้อมูลนี้
- รายการด้าน **ตลาดแรงงาน** (demand match, labour-market alignment) เว้นแต่ท่านรัน
  `kmitl-skill-mapping` และคำสั่งด้านทักษะแล้ว
- **JobThai** แสดง "not applicable" เพราะเป็นข้อมูลเชิงพาณิชย์
- **งานวิจัยจาก OpenAlex** เพราะข้อมูลผลงานตีพิมพ์มาจากการอัปโหลดแทน

รายการอื่นทั้งหมดควรเป็นสีเขียวเมื่อ pipeline ทำงานเสร็จ

## เส้นทางข้อมูลจริง

หากนำแฟ้มของตนเองมา ให้ทำขั้นตอนเดียวกันด้วยแฟ้มเหล่านั้น:

1. แก้ Organisation profile เป็นชื่อมหาวิทยาลัยของท่าน ชื่อภาษาไทยต้องตรงกับตาราง TCAS ทุกตัวอักษร
2. อัปโหลดแฟ้มตามลำดับเดียวกัน เมื่อแฟ้มถูกปฏิเสธ ข้อความจะระบุแถวและคอลัมน์
   กฎอยู่ใน [การนำเข้าข้อมูลจาก spreadsheet](../data-import.md)
3. รัน `tcas` และรัน `openalex-works` หากมี key แบบฟรี
4. แนบ PDF หลักสูตรของท่าน ตรวจสอบก่อนด้วย `pnpm curriculum:check "<file.pdf>"`
   แล้วรัน pipeline

ข้อมูลของท่านและมหาวิทยาลัยตัวอย่างอยู่ร่วมกันในฐานข้อมูลเดียว หากต้องการลบข้อมูลตัวอย่างภายหลัง
ให้ใช้ "Start over" ที่หน้าของชุดข้อมูลตัวอย่างแต่ละชุด โดยไล่จากชุดที่อัปโหลดหลังสุดกลับไป

## Mock API server

พรุ่งนี้ session 4 และ 5 จะเชื่อมระบบเข้ากับ mock API server ที่ทำหน้าที่แทนระบบหนึ่งของมหาวิทยาลัย
และท่านจะเขียนโค้ดที่อ่านข้อมูลจากระบบนั้นด้วยความช่วยเหลือของ AI assistant คำแนะนำจะมาพร้อมกับ session เหล่านั้น

## เสร็จเมื่อ

- แฟ้มตัวอย่างทั้ง 13 แฟ้มปรากฏในประวัติ "Uploads" ของแต่ละชุด
- pipeline ของ `WDU-CPE-BE` ทำงานเสร็จแล้ว
- Setup checklist เป็นสีเขียว ยกเว้นรายการที่ระบุไว้ข้างต้น
- `/programs/<id>` ของ `WDU-CPE-BE` แสดงเนื้อหาในส่วน Executive snapshot, Admissions,
  Students, Outcomes, Curriculum & Faculty และ Financials

## ขั้นต่อไป

Session 4 และ 5 ยังอยู่ระหว่างจัดทำ ต่อด้วย [Session 6: การทดสอบและความปลอดภัย](./06-testing-and-security.md)
