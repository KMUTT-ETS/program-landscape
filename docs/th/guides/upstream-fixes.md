# การ fork และการรับ fix จาก upstream

> **English:** [English version](../../guides/upstream-fixes.md)

**ผลลัพธ์** ท่าน fork repository ได้โดยที่ยังรับ fix จาก upstream ได้ง่าย และรู้ว่าการ merge จะยากตรงไหน

## การขอสิทธิ์เข้าถึง

repository ต้นทางคือ `https://github.com/khon-kaen-university/program-landscape` ขอสิทธิ์เข้าถึงได้ที่ฝ่ายการศึกษาและดิจิทัล มหาวิทยาลัยขอนแก่น สิ่งที่จะได้รับคือ repository เท่านั้น ไม่มีข้อมูลรับรอง ไม่มีข้อมูล ไม่มีฟอนต์ (ดู [ขอบเขตและภาระงาน](../adopters/scope-and-effort.md#สิ่งที่จะไม่ได้รับ))

## fork ไว้ อย่าตัดขาดจากต้นทาง

ให้รับโค้ดไปในรูป **git fork ที่ตั้ง remote `upstream` ไว้ด้วย** ไม่ใช่คัดลอกครั้งเดียวจบ เพราะยังไงก็ต้องดึง bug fix ของ มข. มาใช้ codebase ยังพัฒนาต่อเนื่อง และหลายระบบย่อย — มาตรฐาน prompt ระเบียบวิธีคะแนนสุขภาพ ห่วงโซ่ provenance ของคุณภาพข้อมูล — ขยับไปมากในช่วงไม่กี่เดือนที่ผ่านมา

```bash
git clone git@github.com:<your-university>/program-landscape.git
cd program-landscape
git remote add upstream https://github.com/khon-kaen-university/program-landscape.git
git fetch upstream
```

## จัดโครงสร้างการแก้ไข เพื่อให้ merge ในอนาคตยังทำได้

ตัวแปรเดียวที่ชี้ขาดว่าอีกหนึ่งปีจะยัง merge upstream ได้อยู่หรือไม่ คือ **ตำแหน่งที่วางโค้ดเฉพาะของสถาบัน** ข้อแนะนำ เรียงจากคุ้มค่าที่สุดลงมา:

| ประเภทการแก้ไข | ทำแบบนี้ | ไม่ใช่แบบนี้ |
|---|---|---|
| connector ของคุณ | สร้างไดเรกทอรีใหม่ใต้ `apps/ingestion/src/connectors/sources/<your-slug>/` แล้วเพิ่มเป็นรายการใหม่ใน `SOURCE_CATALOG` และแถวใหม่ใน registry | แก้ไฟล์ connector ของ มข. ทับลงไป |
| ข้อมูลคณะ/ภาควิชา/หลักสูตรของคุณ | อัปโหลด spreadsheet ที่ `/admin/data-setup` — ข้อมูลอยู่ในฐานข้อมูลของคุณ ไม่ได้อยู่ใน fork ดู [Importing from spreadsheets](../../data-import.md) | แก้อาร์เรย์คณะของ มข. ใน `packages/db/prisma/seed.ts` |
| แบรนด์ | เปลี่ยนไฟล์สินทรัพย์และ *ค่า* ของ token แต่คง *ชื่อ* token ไว้ | เปลี่ยนชื่อ token หรือรื้อโครงสร้าง `tailwind-preset.ts` |
| น้ำหนักในระเบียบวิธี | เพิ่มเลขเวอร์ชันแล้ววางเวอร์ชันของคุณคู่ไว้ ดู [การปรับระเบียบวิธีให้เข้ากับสถาบันของคุณ](./adapt-a-methodology.md) | แก้สูตรของ มข. ทับลงไป |
| `CLAUDE.md` ของคุณ | เขียนใหม่ได้เต็มที่ ไฟล์นี้ *ตั้งใจ* ให้แยกทาง | — |

ไฟล์ต่อไปนี้ต้องเผื่อใจไว้ว่าจะชนทุกครั้งที่ merge ให้รวมการแก้ไขของคุณไว้ในจุดน้อยที่สุดเท่าที่จะทำได้:

- `packages/shared/src/ingestion/catalog.ts` (ต่อรายการของคุณไว้ท้ายอาร์เรย์)
- `apps/ingestion/src/connectors/registry.ts` (เช่นเดียวกัน)
- `packages/db/prisma/seed.ts`
- `packages/design/src/tokens/*.ts`
- `.env.example`

## migration จะชนกัน และนี่คือจุดที่เจ็บที่สุด

migration ของ Prisma คือไดเรกทอรีที่ตั้งชื่อด้วย timestamp ใต้ `packages/db/prisma/migrations/` ถ้าคุณเพิ่ม migration และ มข. ก็เพิ่ม migration ทั้งคู่จะถูก apply ได้ตามปกติ — แต่ถ้าแก้ *ตารางเดียวกัน* ต้องมานั่งประสานด้วยมือ บรรเทาได้สองทาง:

- ตั้งชื่อ migration ให้แยกแยะออกชัด (`20260901120000_yourthuni_registrar_bridge`) ประวัติจะอ่านรู้เรื่อง
- เลือกการเปลี่ยน schema แบบ **เพิ่มเข้าไป** (คอลัมน์ nullable ใหม่ ตารางใหม่) แทนการไปแก้ของ มข. repository นี้ใช้นโยบายนี้กับตัวเองอยู่แล้ว ดู `docs/migration-policy.md` และสังเกต `scripts/migration-linter.ts` ที่ CI รันเพื่อจับ DDL ที่ทำลายข้อมูล

## จังหวะ merge ที่ใช้ได้จริง

merge upstream **ไตรมาสละครั้ง ไม่ใช่ต่อเนื่อง** การ merge ต่อเนื่องแปลว่าต้องมานั่งแก้ conflict ชุดเดิมทุกสัปดาห์ ไตรมาสละครั้งแปลว่าได้อ่านสิ่งที่เปลี่ยนใน `docs/` และหน้า `/changelog` (`apps/web/app/changelog/page.tsx` คือประวัติการปล่อยเวอร์ชันที่เป็นทางการ ส่วนบันทึกใน CLAUDE.md ระบุตัวเองไว้ชัดว่าเป็นแบบ best-effort และมีช่วงที่ขาดหาย) แล้วจัดการรวดเดียวอย่างตั้งใจ

## ขั้นต่อไป

อ่านต่อที่ [การทดสอบและ CI](./testing-and-ci.md)
