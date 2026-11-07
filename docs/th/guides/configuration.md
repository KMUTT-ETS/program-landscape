# การตั้งค่าและ environment

> **English:** [English version](../../guides/configuration.md)

**ผลลัพธ์** ท่านตั้งค่าคีย์ environment ที่สำคัญในวันแรกได้ และเก็บ secret ไว้นอก repository ใน production

`.env.example` มีคีย์ที่ไม่ถูกคอมเมนต์อยู่ **104 คีย์** (บวกคีย์ทางเลือกที่คอมเมนต์ไว้อีกราว 20 คีย์) ส่วน `.env.prod.example` มีมากกว่านั้น พร้อมคำแนะนำเฉพาะ production ในคอมเมนต์ อ่านทั้งสองไฟล์ ทั้งคู่ไม่ใช่รายการที่ต้องกรอกให้ครบ — คีย์ส่วนใหญ่เป็นข้อมูลรับรองรายตัวของ connector ที่ยังไม่ต้องใช้จนกว่าจะต่อ connector ตัวนั้น

## คีย์ environment ที่สำคัญจริงในวันแรก

| คีย์ | หมายเหตุ |
|---|---|
| `DATABASE_URL` | ต้องสอดคล้องกับ `POSTGRES_*` เพราะระบบไม่ได้ประกอบค่านี้ขึ้นมาให้อัตโนมัติ |
| `NEXTAUTH_SECRET` | จำเป็น ถ้าขาดจะเกิดความล้มเหลวเงียบของ auth ดูกับดักที่ 4 |
| `NEXTAUTH_URL`, `AUTH_TRUST_HOST` | ตั้งเป็น URL สาธารณะของคุณเมื่อขึ้น production |
| `ENABLE_LOCAL_AUTH`, `DEV_AUTH_PASSWORD` | การล็อกอินสำหรับ dev จะ fail ทันทีถ้าเปิดใน production |
| `AI_PROVIDER` | `google` (ค่าตั้งต้น) / `anthropic` / `stub` การใช้ tool-use (AI Analyst) ต้องเป็น `anthropic` |
| `GOOGLE_AI_API_KEY` / `ANTHROPIC_API_KEY` | ต้องมีอย่างน้อยหนึ่งตัว ส่วน provider `stub` ทำงานได้โดยไม่ต้องมีคีย์เลย |
| `CONNECTOR_MODE` | โหมดตั้งต้นของ connector ทุกตัว ช่วงแรกปล่อยไว้ที่ `mocked` |
| *(ย้ายแล้ว)* | ตั้งค่าข้อมูลสถาบันในแอปที่ **/admin/organization** (ชื่อ ชื่อย่อ ภูมิภาค อีเมลติดต่อ URL สาธารณะ) ชื่อภาษาไทยต้องตรงกับคอลัมน์ สถาบัน ของ TCAS ทุกตัวอักษร ฟอร์มจะตรวจให้ |
| `MINIO_*`, `REDIS_*`, `GOTENBERG_URL` | ค่าตั้งต้นสำหรับเครื่อง local ใน `.env.example` ใช้ได้เลยกับ `pnpm db:up` |

สีและโลโก้ของแบรนด์ตั้งได้ที่แท็บ **Brand** ของหน้าเดียวกัน (`/admin/organization?tab=brand`) แอปจะสร้างเฉดสีสำหรับโหมดสว่างและมืดจากสีทั้งสองให้ และตรวจว่ายังอ่านได้ชัด

**ช่องว่างใน `.env.example` ที่จะเจอแน่ ๆ** คีย์ `AI_PROVIDER`, `GOOGLE_AI_API_KEY`, `UNICON_DS2001_DB_*` และ `UNICON_DS1001_DB_*` มีบันทึกไว้ใน `.env.prod.example` แต่ **ไม่มีใน `.env.example`** ไฟล์ตัวอย่างฝั่ง dev ตามฝั่ง prod ไม่ทัน เวลา connector รายงานว่าค่าตั้งค่าขาด ให้ไปดู `.env.prod.example` และ `configFromEnv('<PREFIX>')` ในตัว connector ก่อน อย่าเพิ่งสรุปว่าคีย์นั้นไม่มีอยู่จริง

## แต่ละแอปต้องมี `.env` ของตัวเอง — ข้อนี้ไม่ใช่ทางเลือก

`@next/env` ของ Next.js โหลด `.env` จาก **ไดเรกทอรีของโปรเจกต์ Next** (`apps/web/`) ไม่เคยโหลดจากรากของ monorepo กับดักเดียวกันนี้เล่นงาน `apps/api` และ `apps/ingestion` ด้วย

`scripts/link-env.mjs` (`pnpm link-env` และเป็นส่วนหนึ่งของ `pnpm setup`) จะ symlink `.env` ที่รากไปยังไดเรกทอรีแอปทั้งสาม และไปยัง `packages/db` ด้วย (Prisma CLI อ่าน `DATABASE_URL` จาก `packages/db/.env`) บน Windows ที่ไม่ได้เปิด Developer Mode สคริปต์จะถอยไปใช้การคัดลอกแทน — และสำเนา **จะไม่ตามการแก้ไข** `.env` ที่ราก ดังนั้นบน Windows ให้รัน `pnpm link-env` ซ้ำทุกครั้งหลังแก้ค่า env

อาการเมื่อขาดไฟล์นี้เงียบและชวนเข้าใจผิด ดู [กับดักที่ 4](../adopters/traps.md#กับดักที่-4-ไฟล์-env-ประจำแต่ละแอป-และความล้มเหลวเงียบของ-edge-middleware)

## การจัดการ secret ใน production

production ใช้ secret แบบไฟล์ของ Docker Compose ใต้ `/opt/program-landscape/secrets/` (หนึ่งค่าต่อหนึ่งไฟล์ สิทธิ์ 0600) สำหรับข้อมูลรับรองของ Postgres และ MinIO ควบคู่กับ `.env.prod` ที่เป็นของ root สิทธิ์ 0600 เอกสารอ้างอิงคือ `DEPLOYMENT.md` หัวข้อ *One-time server setup* มีข้อสังเกตที่บันทึกไว้แล้วอยู่หนึ่งข้อ: `DATABASE_URL` ใน `.env.prod` ยังฝังรหัสผ่านไว้ในตัวมันเอง จึงต้องคอยไล่ให้ตรงกับไฟล์ secret ด้วยมือ

## ขั้นต่อไป

อ่านต่อที่ [การเขียน connector](./write-a-connector.md)
