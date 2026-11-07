# Session 3: การเชื่อมโยงข้อมูลมหาวิทยาลัย

> **English:** [`03-university-data.md`](./03-university-data.md)

**เวลา** หนึ่งช่วงบ่าย ประมาณ 3 ชั่วโมง

## เป้าหมาย

นำเข้าข้อมูลของมหาวิทยาลัยหนึ่งแห่งเข้าสู่ระบบ รัน pipeline กับหนึ่งหลักสูตรด้วย AI key ของท่านเอง
และเห็น Deep-Dive ของหลักสูตรนั้นแสดงเนื้อหา ทุกคนทำเส้นทางข้อมูลตัวอย่าง
หากนำแฟ้มของตนเองมา ให้ทำซ้ำด้วยแฟ้มเหล่านั้นต่อ

ขั้นตอนเป็นขั้นตอนเดียวกับ [Get Program Deep-Dive working](../tutorials/program-deep-dive.th.md)
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
[ขั้นตอนที่ 1](../tutorials/program-deep-dive.th.md#ขั้นตอนที่-1-ตั้งค่า-organisation-profile)
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
[ขั้นตอนที่ 2](../tutorials/program-deep-dive.th.md#ขั้นตอนที่-2-อัปโหลดโครงสร้างองค์กรและหลักสูตร)

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
  แล้วรันคำสั่งใน [ทักษะตลาดแรงงาน](../tutorials/program-deep-dive.th.md#labour-market-skills)
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
[ขั้นตอนที่ 6](../tutorials/program-deep-dive.th.md#ขั้นตอนที่-6-ทำให้-setup-checklist-เป็นสีเขียว)
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
   กฎอยู่ใน [การนำเข้าข้อมูลจาก spreadsheet](../data-import.th.md)
3. รัน `tcas` และรัน `openalex-works` หากมี key แบบฟรี
4. แนบ PDF หลักสูตรของท่าน ตรวจสอบก่อนด้วย `pnpm curriculum:check "<file.pdf>"`
   แล้วรัน pipeline

ข้อมูลของท่านและมหาวิทยาลัยตัวอย่างอยู่ร่วมกันในฐานข้อมูลเดียว หากต้องการลบข้อมูลตัวอย่างภายหลัง
ให้ใช้ "Start over" ที่หน้าของชุดข้อมูลตัวอย่างแต่ละชุด โดยไล่จากชุดที่อัปโหลดหลังสุดกลับไป

### ไม่มีแฟ้มส่งออก? สร้างชุดข้อมูลจำลองสำหรับมหาวิทยาลัยของท่าน

หากไม่มีแฟ้มส่งออกในมือ มีตัวสร้างที่เขียน spreadsheet ข้อมูลจำลองพร้อมอัปโหลดให้
สำหรับส่วนย่อยที่หลากหลายของมหาวิทยาลัยของท่านเอง ชื่อคณะ ชื่อหลักสูตร และตัวเลขการรับสมัครรอบ 3
มาจากแฟ้ม TCAS สาธารณะ (ดาวน์โหลดจาก mytcas.com เมื่อรันครั้งแรกและเก็บไว้ในแคช)
บุคลากรเป็นโทเค็นที่มีเลขกำกับ เช่น "อาจารย์ 001" ตัวเลขอื่นทั้งหมดเป็นข้อมูลสมมติและระบุว่าเป็น mock
หลักสูตรที่ท่านนำ PDF มาจะรวมอยู่เสมอ และรหัสวิชาอ่านจาก PDF
ใช้เพื่อฝึกเท่านั้น: ห้ามนำตัวเลขเหล่านี้ไปแสดงเป็นผลจริง ไม่ต้องติดตั้งอะไรเพิ่มนอกจาก Node และ pnpm

**ก่อนวันงาน** เขียนแฟ้มข้อมูลนำเข้า เช่น `my-university.json`:

```json
{
  "university": "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี",
  "region": "Central",
  "programmes": [
    {
      "name": "วิศวกรรมเครื่องกล",
      "pdf": "pdfs/mechanical-engineering.pdf",
      "level": "BACHELOR"
    },
    {
      "name": "วิศวกรรมเครื่องกล",
      "pdf": "pdfs/mechanical-engineering-master.pdf",
      "level": "MASTER",
      "faculty": "คณะวิศวกรรมศาสตร์",
      "tcas_code": "10140107300507A",
      "name_en": "Master of Engineering Programme in Mechanical Engineering",
      "courses": "courses/mechanical-master.csv"
    }
  ]
}
```

| คีย์ | ความหมาย |
|---|---|
| `university` | ชื่อภาษาไทยของมหาวิทยาลัยท่าน ตรงกับตาราง TCAS ทุกตัวอักษร |
| `region` | ภาคเป็นภาษาอังกฤษ ตรงกับที่ท่านจะพิมพ์ใน organisation profile (เช่น `Central`, `Northeast`) |
| `programmes[].name` | ชื่อหลักสูตรตามที่เขียนใน PDF สะกดต่างเล็กน้อยได้ |
| `programmes[].pdf` | พาธไปยัง PDF หลักสูตร พาธแบบสัมพัทธ์อิงโฟลเดอร์ของแฟ้ม JSON ไม่บังคับ |
| `programmes[].level` | `BACHELOR` (ค่าเริ่มต้น), `MASTER`, `DOCTORAL` หรือ `HIGHER_GRAD_DIPLOMA` |
| `programmes[].faculty` | ชื่อภาษาไทยของคณะ จำเป็นเมื่อระดับไม่ใช่ `BACHELOR` |
| `programmes[].tcas_code` | ไม่บังคับ รหัสหลักสูตร TCAS ใช้เมื่อจับคู่ด้วยชื่ออัตโนมัติไม่ได้ และมีลำดับเหนือกว่าเสมอ |
| `programmes[].courses` | ไม่บังคับ แฟ้ม CSV (ไม่ใช่ spreadsheet) ที่ใช้แทนรายวิชาจาก PDF แถวหัวตารางคือ `code,name_th,name_en,credits,category` ค่า `category` เป็นหนึ่งใน General education, Core, Major required, Major elective, Free elective, Thesis / project เว้นว่างหากไม่ทราบ |
| `programmes[].name_en` | ไม่บังคับ ชื่อภาษาอังกฤษที่ใช้ตามนั้นในแฟ้มจำลอง |

รันตัวสร้างหนึ่งครั้งขณะต่ออินเทอร์เน็ต เพื่อให้แฟ้ม TCAS ถูกเก็บในแคช

**สร้าง**

```bash
pnpm workshop:mock my-university.json
```

ตัวเลือก: `--size small|medium` (ค่าเริ่มต้น `small`), `--seed N` (ข้อมูลนำเข้าและ seed เดียวกันให้แฟ้มเหมือนกัน),
`--out DIR` (ค่าเริ่มต้น `./workshop-mock-out`) และ `--offline` (ใช้เฉพาะแฟ้ม TCAS ในแคช), `--cache DIR` (ที่เก็บแคช TCAS) และ `--tcas-file PATH:YEAR:ROUND` (ใช้แฟ้ม TCAS ที่ท่านมีอยู่แล้ว)
แฟ้ม TCAS ถูกเก็บแคชใน `<out>/.cache` หากวันงานไม่มีอินเทอร์เน็ต ให้รันหนึ่งครั้งล่วงหน้า แล้วใช้ `--offline`

ท่านควรเห็นบรรทัดที่บอกว่าแต่ละหลักสูตรของท่านถูกจับคู่กับหลักสูตร TCAS ใด ตรวจว่าแต่ละบรรทัดตรงกับหลักสูตรที่ตั้งใจ
หากจับคู่ผิด หรือสคริปต์หยุดพร้อมรายการตัวเลือก ให้ตั้งค่า `tcas_code` ของหลักสูตรนั้นแล้วรันใหม่

**ตรวจสอบ**

```bash
pnpm workshop:check-mock workshop-mock-out my-university.json
```

ท่านควรเห็นหลักสูตรระดับปริญญาตรีทุกหลักสูตรถูกจับคู่ และไม่มีข้อผิดพลาด การตรวจนี้พิสูจน์ว่าแฟ้มผ่านตัวนำเข้าของระบบ
และ connector `tcas` จะจับคู่หลักสูตรได้

**นำเข้า**

1. เปิด `/admin/organization` แท็บ "Identity" พิมพ์ชื่อภาษาไทยและ Region (English)
   ให้ตรงกับที่ `README.txt` ในโฟลเดอร์ผลลัพธ์ระบุไว้
2. อัปโหลดแฟ้มที่มีหมายเลขตามลำดับที่ `/admin/data-setup` แต่ละแฟ้มที่หน้าชุดข้อมูลของตนด้วย "Upload filled template"
3. จากนั้นอัปโหลด **University Rankings**: ดาวน์โหลดแม่แบบที่กรอกไว้ล่วงหน้าแล้วอัปโหลดกลับโดยไม่แก้ไข
4. เมื่ออัปโหลดครบ เปิด `/admin/data-sources` แล้วรัน `tcas` และ `un-wpp`
   `openalex-works` จะไม่พบคู่ เพราะบุคลากรจำลองเป็นโทเค็น ไม่ใช่บุคคลจริง
   `kmitl-skill-mapping` เป็นทางเลือก
5. แนบ PDF แต่ละแฟ้มที่แท็บ "Files" ของหลักสูตรด้วยบทบาท `CURRENT_CURRICULUM` แล้วรัน pipeline
6. เปิดแท็บ "Setup checklist" ของหลักสูตร ท่านควรเห็นรายการสีเขียว ยกเว้น JobThai ("not applicable")
   และรายการด้านตลาดแรงงาน เว้นแต่ท่านรัน `kmitl-skill-mapping` และคำสั่งด้านทักษะแล้ว

**ลบออก** ใช้ "Start over" ที่หน้าชุดข้อมูลแต่ละชุด โดยไล่จากชุดที่อัปโหลดหลังสุดกลับไป แล้วลบโฟลเดอร์ผลลัพธ์

## Mock API server

พรุ่งนี้ session 4 และ 5 จะเชื่อมระบบเข้ากับ mock API server ที่ทำหน้าที่แทนระบบหนึ่งของมหาวิทยาลัย
และท่านจะเขียนโค้ดที่อ่านข้อมูลจากระบบนั้นด้วยความช่วยเหลือของ AI assistant คำแนะนำจะมาพร้อมกับ session เหล่านั้น

## เสร็จเมื่อ

- แฟ้มตัวอย่างทั้ง 13 แฟ้มปรากฏในประวัติ "Uploads" ของแต่ละชุด
- pipeline ของ `WDU-CPE-BE` ทำงานเสร็จแล้ว
- Setup checklist เป็นสีเขียว ยกเว้นรายการที่ระบุไว้ข้างต้น
- `/programs/<id>` ของ `WDU-CPE-BE` แสดงเนื้อหาในส่วน Executive snapshot, Admissions,
  Students, Outcomes, Curriculum & Faculty และ Financials
