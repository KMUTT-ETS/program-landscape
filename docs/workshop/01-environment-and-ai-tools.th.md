# Session 1: ความพร้อมของ Local Environment และ AI Tools

> **English:** [`01-environment-and-ai-tools.md`](./01-environment-and-ai-tools.md)

**เวลา** ประมาณ 45 นาที

## เป้าหมาย

ยืนยันว่าเครื่องมือทุกตัวบนแล็ปท็อปตอบสนอง AI key ใช้งานได้ และ AI coding assistant
อ่าน repository ได้ ยังไม่มีการสร้างอะไรใน session นี้ หากท่านทำงานเตรียมการใน
[ก่อนวันอบรม](./00-before-the-day.th.md) แล้ว session นี้จะเป็นการตรวจสอบเป็นส่วนใหญ่

## ตรวจสอบเครื่องมือแต่ละตัว

เปิด terminal ในโฟลเดอร์โครงการ (บน Windows คือ terminal ของ Ubuntu) แล้วรัน:

```bash
git --version
docker compose version
node --version
pnpm --version
docker compose ps
```

ท่านควรเห็น:

| คำสั่ง | ผลที่ควรได้ |
|---|---|
| `git --version` | เวอร์ชันใดก็ได้ที่ค่อนข้างใหม่ |
| `docker compose version` | เวอร์ชัน 2 ขึ้นไป |
| `node --version` | `v24.22.1` ขึ้นไป |
| `pnpm --version` | ขึ้นต้นด้วย `10` |
| `docker compose ps` | `postgres`, `redis`, `minio` และ `gotenberg` ทำงานและอยู่ในสถานะ healthy |

หาก container ไม่ทำงาน ให้เริ่มด้วย `pnpm db:up` แล้วรอจน `docker compose ps` แสดงว่า healthy

## ตรวจสอบ AI key

เปิด `.env` แล้วตรวจสอบว่า `AI_PROVIDER` ระบุผู้ให้บริการของท่าน (`google` หรือ `openrouter`)
และตั้งค่า key ที่ตรงกันแล้ว ค่า `stub` ทำให้แอปทำงานโดยไม่เรียก AI จริง ซึ่งใช้ได้สำหรับ session 1 และ 2
แต่ใช้กับ pipeline ใน session 3 ไม่ได้ หากยังไม่ได้ทดสอบ key ให้ทำตามขั้นตอนใน
[ก่อนวันอบรม](./00-before-the-day.th.md#ขอ-ai-key-และตรวจสอบว่าใช้งานได้)

## ตรวจสอบว่า AI assistant อ่าน repo ได้

เริ่ม AI coding assistant ในโฟลเดอร์โครงการ แล้วให้ prompt นี้:

```text
You are in the Program Landscape repository. Without changing any file:
1. List the apps under apps/ and the packages under packages/, with one line on what each does.
2. Name the file that defines the API endpoints of the Program Deep-Dive page.
```

คำตอบที่ดีจะระบุ `web`, `api` และ `ingestion` (รวมถึง docs site) แพ็กเกจ `db`, `shared`, `ui`,
`design` และ `pdf-templates` และระบุ `apps/api/src/programs/deep-dive.controller.ts`
หาก assistant อ่านแฟ้มไม่ได้ แปลว่าไม่ได้ทำงานในโฟลเดอร์โครงการ หรือยังไม่ได้รับสิทธิ์อ่านแฟ้ม
ให้แก้ก่อน session 2

## เสร็จเมื่อ

- ทุกคำสั่งในตารางให้ผลตามที่ควรได้
- AI key ผ่านการตรวจสอบ
- assistant ระบุ `deep-dive.controller.ts` ได้

## หากมีข้อผิดพลาด

| สิ่งที่เห็น | สิ่งที่ต้องทำ |
|---|---|
| `command not found: pnpm` | รัน `corepack enable` แล้วเปิด terminal ใหม่ |
| `node --version` แสดงเวอร์ชันอื่น | รัน `nvm use` ในโฟลเดอร์โครงการ |
| container อยู่ในสถานะ `unhealthy` หรือรีสตาร์ตซ้ำ | รัน `docker compose logs <name>` แล้วแสดงให้ผู้จัดดู |
| สร้าง image ของ Gotenberg ไม่สำเร็จ | ไม่มีแฟ้มฟอนต์ TH Sarabun New ทั้งสี่แฟ้มใน `infra/gotenberg/fonts/` ดู [Getting started ขั้นที่ 4](../tutorials/getting-started.th.md#4-รันการตั้งค่าครั้งเดียว) |
| assistant ตอบจากความรู้ทั่วไป ไม่ใช่จาก repository | เริ่ม assistant จากโฟลเดอร์โครงการ และอนุญาตให้อ่านแฟ้ม |
