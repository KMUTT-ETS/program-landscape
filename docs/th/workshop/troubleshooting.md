# การแก้ปัญหา

> **English:** [`troubleshooting.md`](../../workshop/troubleshooting.md)

รวมทุกข้อผิดพลาดที่หน้าต่าง ๆ ของ workshop กล่าวถึงไว้ในที่เดียว ค้นหาสิ่งที่ท่านเห็นในคอลัมน์ซ้าย
หากไม่มีในหน้านี้ ให้แสดงข้อความทั้งหมดแก่ผู้จัด

## การติดตั้ง

| สิ่งที่เห็น | สาเหตุ | วิธีแก้ |
|---|---|---|
| "Cannot connect to the Docker daemon" | Docker ไม่ทำงาน | เริ่ม Docker แล้วรันคำสั่งอีกครั้ง บน WSL2: `sudo systemctl start docker` |
| "permission denied while trying to connect to the Docker daemon socket" | เพิ่มผู้ใช้เข้ากลุ่ม `docker` แล้ว แต่ terminal ยังเป็นหน้าต่างเก่า | ปิดหน้าต่าง Ubuntu ทุกหน้าต่าง รัน `wsl --shutdown` ใน PowerShell แล้วเปิด Ubuntu อีกครั้ง |
| "port is already allocated" | โปรแกรมอื่นใช้พอร์ตใดพอร์ตหนึ่งใน 3000, 4000, 5432, 6379, 9000, 9001, 3001 | หยุดโปรแกรมนั้น แล้วเริ่มใหม่ |
| "Environment variable not found: DATABASE_URL" | ไม่มีลิงก์ `.env` ของแต่ละแอป | รัน `pnpm link-env` แล้วรันคำสั่งที่ล้มเหลวอีกครั้ง |
| การลงชื่อเข้าใช้วนกลับมาที่เดิม | สาเหตุเดียวกัน | รัน `pnpm link-env` แล้วเริ่ม `pnpm dev` ใหม่ |
| ข้อผิดพลาดของ Node หรือการติดตั้ง | ใช้ Node.js ผิดเวอร์ชัน | รัน `nvm use` แล้ว `pnpm setup` อีกครั้ง |
| การติดตั้งและ `pnpm dev` ช้ามากบน Windows | โครงการอยู่ใต้ `/mnt/c/` | clone ใหม่ไว้ใต้โฟลเดอร์ home ของ Linux ดู [การติดตั้งบน Windows ด้วย WSL2](../guides/windows-wsl2.md) |
| ทุกแฟ้มขึ้นว่าถูกแก้ไขหลัง clone | การขึ้นบรรทัดใหม่ถูกแปลง | รัน `git config --global core.autocrlf input` แล้ว clone ใหม่ |
| แล็ปท็อปค้างระหว่างที่แอปทำงาน | หน่วยความจำไม่พอสำหรับ WSL2 หรือ Windows | ปิดโปรแกรมอื่น หรือปรับค่า `memory=` ใน `.wslconfig` |

## การอัปโหลดข้อมูล

| สิ่งที่เห็น | สาเหตุ | วิธีแก้ |
|---|---|---|
| "... is not a known programmes code. Upload that dataset first, or correct the value." | แฟ้มอ้างถึงหลักสูตร คณะ ภาควิชา หรือพนักงานที่ไม่มีในการอัปโหลดก่อนหน้า | อัปโหลดแฟ้มตามลำดับหมายเลข หรือเพิ่มแถวที่ขาดลงในแฟ้มก่อนหน้า |
| "This file has 12000 rows; the limit is 10000. Split it into smaller files." | การอัปโหลดหนึ่งครั้งรับได้ไม่เกิน 10000 แถว | แบ่งแฟ้มแล้วอัปโหลดทีละส่วน |
| "This file has N rows but M are already stored..." | มีเฉพาะ class offerings และรายการรายวิชาของหลักสูตรที่ถามเช่นนี้ เมื่อแฟ้มเล็กกว่าข้อมูลที่เก็บไว้มาก | หากแฟ้มเล็กนั้นถูกต้อง ให้ยืนยันการอัปโหลด |
| ไม่มีคอลัมน์ที่จำเป็น | คอลัมน์ที่จำเป็นละไว้ไม่ได้ | เพิ่มคอลัมน์นั้น |
| "Unexpected column(s): ..." | รับได้เฉพาะคอลัมน์ของแม่แบบ | ลบคอลัมน์นั้น |
| "This cell looks like a personal identifier (national ID)." | ช่องหนึ่งมีรูปแบบเหมือนเลขประจำตัวประชาชน | ลบออก ข้อมูลส่วนบุคคลไม่ควรอยู่ในแฟ้มเหล่านี้ |
| อัปโหลดสำเร็จแต่ไม่มีอะไรแสดง | ไม่มีแถวของแหล่งข้อมูล | รัน `pnpm data-sources:sync --apply` แล้วอัปโหลดอีกครั้ง |
| ส่วนหนึ่งของ Deep-Dive ว่างทั้งที่มีแถวข้อมูล | ระบบสืบย้อนแถวไปยังการอัปโหลดหรือการรัน connector จริงไม่ได้ จึงซ่อนไว้ | เช่นเดียวกัน: รัน `pnpm data-sources:sync --apply` แล้วอัปโหลดอีกครั้ง |

## Connector และ pipeline

| สิ่งที่เห็น | สาเหตุ | วิธีแก้ |
|---|---|---|
| "OPENALEX_API_KEY is not set..." และการรันถูกข้าม | ไม่มี OpenAlex key แบบฟรีใน `.env` | เพิ่ม key เริ่ม `pnpm dev` ใหม่ แล้วรัน `openalex-works` อีกครั้ง ไม่จำเป็นสำหรับชุดข้อมูลจำลอง เพราะบุคลากรเป็นโทเค็น |
| การรัน TCAS ไม่พบหลักสูตรที่ตรงกัน | ชื่อภาษาไทยใน `/admin/organization` ไม่ตรงกับ TCAS หรือยังไม่ได้อัปโหลดหลักสูตร | แก้ชื่อ อัปโหลดหลักสูตร แล้วรัน `tcas` อีกครั้ง |
| pipeline ล้มเหลวที่ขั้น AI แรก | ไม่มี AI key หรือ `AI_PROVIDER` เป็น `stub` | ตั้งค่า key และ `AI_PROVIDER` ใน `.env` แล้วเริ่ม `pnpm dev` ใหม่ |
| pipeline หยุดพร้อมรหัส "402" | เครดิต OpenRouter หมด | เติมเครดิต หรือเปลี่ยนไปใช้ Google key แล้วรัน pipeline อีกครั้ง phase ที่เสร็จแล้วรันซ้ำได้โดยใช้ค่าใช้จ่ายน้อย |
| pipeline หยุดกลางทาง | worker รีสตาร์ตระหว่างทำงาน เช่นหลังแก้โค้ด | รันอีกครั้ง |
| phase รายวิชาแจ้งว่ารายการมาจากการอัปโหลด | หลักสูตรมีรายการรายวิชาที่อัปโหลดไว้ ซึ่งมีลำดับเหนือกว่า PDF เสมอ | ไม่ต้องทำอะไร เป็นเรื่องปกติเมื่ออัปโหลดรายการรายวิชาไว้ เช่นในชุดข้อมูลจำลอง |
| pipeline อ่านรายการรายวิชาจาก PDF ของท่านไม่ได้ | ระบบไม่รู้จักรูปแบบของ PDF | ตรวจสอบด้วย `pnpm curriculum:check "<file.pdf>"` หรืออัปโหลดรายการรายวิชาแทน |
| ทักษะไม่ปรากฏหลังรัน pipeline | ชื่อทักษะยังจับคู่ไม่ได้ หรือเรียกผู้ให้บริการ AI ไม่ได้ระหว่าง phase 2 | รันสองคำสั่งด้านล่าง แล้วรัน pipeline อีกครั้ง |
| ส่วน overlap แสดงเฉพาะรหัสวิชาที่ใช้ร่วมกัน หรือ log แสดง "429" ระหว่าง embedding | Google key แบบฟรีถึงขีดจำกัด embedding รายวัน | ใช้ key แบบชำระเงิน หรือรัน pipeline อีกครั้งในวันถัดไป |
| demand match ถูกข้าม และ labour-market alignment ว่าง | ชื่อทักษะของตลาดยังไม่อยู่ใน taxonomy ของท่าน | หลังรัน `kmitl-skill-mapping` ให้รัน `pnpm skills:normalise --source=linkedin --auto-promote` หนึ่งครั้ง แล้วรัน pipeline อีกครั้ง |
| JobThai driver แสดง "not applicable" | JobThai เป็นข้อมูลเชิงพาณิชย์ | ไม่ต้องทำอะไร ไม่ใช่ข้อผิดพลาด |

สองคำสั่งสำหรับกรณีทักษะไม่ปรากฏ โดยใช้ id ของหลักสูตรจากหน้าผู้ดูแลระบบ:

```bash
pnpm skills:normalise --source=program_digest --auto-promote
pnpm programs:approve-pending --rematerialise --program-id=<id>
```

## AI key และ assistant

| สิ่งที่เห็น | สาเหตุ | วิธีแก้ |
|---|---|---|
| api หรือ ingestion หยุดตอนเริ่มพร้อมข้อความว่าไม่มี key | `AI_PROVIDER` ระบุผู้ให้บริการที่ยังไม่ได้ตั้งค่า key | เพิ่ม key หรือตั้ง `AI_PROVIDER=stub` ไว้ก่อน แล้วเริ่ม `pnpm dev` ใหม่ |
| การตรวจ key ตอบว่า `API_KEY_INVALID` | Gemini key ไม่ถูกต้อง หรือคัดลอกมาพร้อมช่องว่าง | คัดลอกใหม่จาก Google AI Studio |
| assistant ตอบจากความรู้ทั่วไป ไม่ใช่จาก repository | ไม่ได้ทำงานในโฟลเดอร์โครงการ หรือไม่ได้รับสิทธิ์อ่านแฟ้ม | เริ่มจากโฟลเดอร์โครงการ และอนุญาตให้อ่านแฟ้ม |
| opencode ไม่มี model ฟรีใน `/models` | ยังไม่ได้ลงชื่อเข้าใช้ หรือรายการ model ฟรีเปลี่ยนไป | รัน `opencode auth login` หรือเชื่อม Gemini key หรือ OpenRouter key ของท่าน |
