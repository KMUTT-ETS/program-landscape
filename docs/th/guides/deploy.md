# การ deploy และการกำหนดขนาดโครงสร้างพื้นฐาน

> **English:** [English version](../../guides/deploy.md)

**ผลลัพธ์** ท่านสร้าง release ส่งไปยังเซิร์ฟเวอร์ของสถาบัน และกำหนดขนาดเซิร์ฟเวอร์ได้

## รูปแบบ: pack-and-ship

เครื่อง production **ไม่เคยดึงอิมเมจจาก registry** วิธีคือ build อิมเมจบนเครื่องพัฒนา มัดรวมเป็น tarball ไฟล์เดียว โอนไปที่เครื่องปลายทาง แล้ว `docker load` บนเครื่องนั้น

```bash
# On the dev machine (inside WSL2 if on Windows)
pnpm build:release <version>
# → dist/program-landscape-<version>.tar.zst  (~2.2 GB, zstd-compressed)
# → dist/program-landscape-<version>.tar.zst.sha256
```

ในไฟล์มัดรวมนี้มี `images.tar` (4 อิมเมจ ทั้งหมดเป็น `linux/amd64`) ไฟล์ compose ไฟล์ตั้งค่า nginx สคริปต์ deploy ไฟล์ systemd unit และเทมเพลต env ไม่ต้องส่งอะไรไปเพิ่มอีก

**อิมเมจ production ทุกตัวเป็น `linux/amd64`** ถ้าเครื่องพัฒนาเป็น Mac สถาปัตยกรรม ARM การ build ต้องใส่ `--platform linux/amd64`

**จุดที่ต้องระวังของกระบวนการ build:** `docker buildx` รัน `COPY` ของแต่ละอิมเมจตอนที่ stage นั้นทำงาน commit ที่ลงมากลางคันจึงเข้าไปอยู่ในบางอิมเมจแต่ไม่เข้าอีกบางอิมเมจ ถ้ามี fix ที่ต้องอยู่ในชุดนี้แน่ ๆ ให้ฆ่า build ทิ้ง เคลียร์ แล้วเริ่มใหม่

บนเครื่องปลายทาง `scripts/deploy.sh` รันซ้ำได้โดยผลลัพธ์ไม่เปลี่ยน และใช้การสลับ symlink แบบอะตอมมิก (`/opt/program-landscape/current → releases/<ver>`) เป็นจุดที่ย้อนกลับไม่ได้ ทุกอย่างก่อนหน้านั้นจะถูกย้อนคืนอัตโนมัติเมื่อล้มเหลว migration รันใน **คอนเทนเนอร์ที่ใช้แล้วทิ้ง** (`docker compose run --rm --entrypoint "" api node node_modules/.bin/prisma migrate deploy`) ไม่ใช่รันจากคอนเทนเนอร์ API ตัวยืนพื้น ซึ่งจะไปแย่งกับ ingestion ตอนเริ่มระบบ

สคริปต์ที่ใช้คู่กัน: `rollback.sh`, `backup.sh`, `restore.sh`, `smoke-test.sh`, `pre-deploy-snapshot.mjs`, `generate-self-signed-cert.sh`

การย้อนกลับ **ค่าตั้งต้นคือย้อนเฉพาะโค้ด** `rollback.sh` จะถามว่าจะกู้ snapshot ฐานข้อมูลก่อน deploy ด้วยหรือไม่ ซึ่งคำตอบตามปกติคือไม่ เพราะ migration เดินหน้าอย่างเดียว และโค้ดที่ย้อนกลับไปก็ยังเข้ากับ schema ได้

## โครงสร้าง TLS

รูปแบบที่ มข. ใช้ ซึ่งมหาวิทยาลัยไทยส่วนใหญ่ทำตามได้:

```
public → university reverse proxy (terminates public cert)
       → re-encrypts, forwards to our host on :8443 (self-signed)
       → our internal nginx (TLS + path routing)
       → web / api over plain HTTP inside the docker network
```

proxy ต้นทางตั้งค่าไว้ที่ `proxy_ssl_verify off` (หรือปักหมุดใบรับรองด้วย SHA-256) มีรายละเอียดของ nginx อยู่ข้อหนึ่งที่จะเล่นงานคนที่รื้อไฟล์ตั้งค่าใหม่: `next-auth` อยู่ที่ `/api/auth/*` บนแอปเว็บ ขณะที่ prefix ของ NestJS คือ `/api/v1` จึงต้องมีกฎ `location /api/auth/` → web แยกไว้ชัดเจน ไม่งั้น auth จะ 404 เพราะไปชนกับ router ของ Nest

security header ตั้งที่ **ชั้นแอปพลิเคชัน** ไม่ใช่ที่ nginx ค่าจึงถูกต้องเสมอไม่ว่าคำขอจะเดินผ่าน proxy เส้นทางไหน

คู่มือปฏิบัติการทีละขั้นของ มข. คือ [`DEPLOYMENT.md`](../../../DEPLOYMENT.md) ใน repository เอกสารนี้อธิบายเซิร์ฟเวอร์ path และเครือข่ายของ มข. จึงควรอ่านเป็นตัวอย่าง แล้วปรับชื่อต่าง ๆ ให้ตรงกับของสถาบันท่าน

## การกำหนดขนาด

ตัวเลขต่อไปนี้มาจาก `docs/production-infrastructure.md` เป็นตัวเลขจริงจากระบบของ มข. ไม่ใช่ตัวเลขที่คิดขึ้นเอง:

| ทรัพยากร | ขั้นต่ำ | ที่แนะนำ | เพราะอะไร |
|---|---|---|---|
| CPU | 4 คอร์ | **8 คอร์** | Gotenberg เปิด Chromium แบบ headless หนึ่งตัวต่อการเรนเดอร์หนึ่งครั้ง ขณะที่ worker ของ ingestion และการเรียก AI ทำงานพร้อมกัน |
| RAM | 16 GB | **32 GB** | shared buffer ของ Postgres (4 GB) + แคชของ MinIO + จุดพีคของ Chromium (เรนเดอร์เอกสารประชุมสภาพร้อมกัน 4–8 งาน) + heap ของ Node อีก 3 บริการ |
| ดิสก์ | SSD 500 GB | **NVMe SSD 1 TB** | Postgres + MinIO + snapshot ก่อน deploy 90 วัน + backup รายคืน 30 วัน + เลเยอร์ของ Docker + คลัง PDF หลักสูตร (ราว 5 GB ที่ 297 หลักสูตร) |
| ระบบปฏิบัติการ | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS | x86_64 เท่านั้น |
| GPU | ไม่ต้องมี | ไม่ต้องมี | การอนุมานทั้งหมดเรียกผ่าน API ของผู้ให้บริการ |

อ่านส่วนที่เหลือของเอกสารนั้นเพื่อดูตารางข้อกำหนดเครือข่ายขาเข้าและขาออก ซึ่งไล่ปลายทางทุกแห่งที่เครื่องต้องติดต่อได้ และเป็นสิ่งที่ทีมเครือข่ายจะถามหาพอดี

**เรื่องพื้นที่ดิสก์เป็นปัญหาปฏิบัติการจริง ไม่ใช่รายละเอียดปลีกย่อย** เครื่องพัฒนาของ มข. เคยแตะ 92% ระหว่างรอบ build หลายรอบติดกัน (tarball รอบละราว 2.5 GB บวกไดเรกทอรี staging อีกราว 6 GB บวกแคช build ที่เรียกคืนได้อีก 14 GB) และเครื่อง production เคยแตะ 100% ระหว่าง deploy เพราะ backup เก่าสะสม กฎคร่าว ๆ คือ เก็บ tarball สามรุ่นล่าสุดไว้บนเครื่องพัฒนา และรัน `docker builder prune -af` หลังจบรอบการปล่อยเวอร์ชันทุกครั้ง เก็บไดเรกทอรีรุ่น backup และอิมเมจสามชุดล่าสุดไว้บน production และเช็ก `df -h /` **ก่อน** รัน `deploy.sh` เสมอ เพราะ snapshot ก่อน deploy ต้องการที่ว่างราว 3 GB

การสำรองข้อมูลตั้งเวลาด้วย systemd (ทุกคืนเวลา 02:00 ตามเวลาไทย) ไม่ใช่ cron ไฟล์ unit มาพร้อมในชุดติดตั้งใต้ `infra/systemd/` การเก็บรักษาคือ รายวัน 30 วัน ก่อน deploy 90 วัน รายเดือน 365 วัน

## ขั้นต่อไป

อ่านต่อที่ [Backup and disaster recovery](../../backup-dr.md)
