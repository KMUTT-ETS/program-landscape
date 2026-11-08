# การติดตั้งบน Windows ด้วย WSL2

> **English:** [`windows-wsl2.md`](../../guides/windows-wsl2.md)

**ผลลัพธ์** Ubuntu, Docker, Node.js 24 และ pnpm 10 ทำงานภายใน WSL2 และสำเนาโค้ดของท่านอยู่ภายใน Linux

ให้รัน Program Landscape บน Windows ภายใน **WSL2** (Windows Subsystem for Linux)
ไม่ใช่บน Windows โดยตรง เมื่อทำเช่นนี้ทุกขั้นตอนในบทเรียนจะใช้ได้ตามที่เขียนไว้ทุกประการ
เพราะภายใน WSL2 ท่านทำงานบน Linux โครงการนี้ไม่รองรับการรันบน Windows โดยตรง
เนื่องจาก symlink การขึ้นบรรทัดใหม่ ความยาวของ path และการแชร์แฟ้มของ Docker ล้วนทำให้เกิดข้อผิดพลาด

ทำหน้านี้ครั้งเดียว แล้วต่อด้วย [Getting started](../tutorials/getting-started.md)

## ติดตั้ง WSL2 และ Ubuntu

1. เปิด **PowerShell แบบ Administrator** แล้วรัน:

```powershell
wsl --install -d Ubuntu-24.04
```

2. รีสตาร์ต Windows เมื่อระบบแจ้ง Ubuntu จะเปิดขึ้นและขอชื่อผู้ใช้กับรหัสผ่านของ Linux
   ตั้งอย่างไรก็ได้ บัญชีนี้อยู่บนแล็ปท็อปของท่านเท่านั้น
3. กำหนดหน่วยความจำให้ WSL2 เพียงพอ ในโฟลเดอร์ผู้ใช้ของ Windows
   (`C:\Users\<you>\`) สร้างแฟ้มชื่อ `.wslconfig` ที่มีเนื้อหาดังนี้:

```ini
[wsl2]
memory=8GB
swap=4GB
```

4. ใน PowerShell รัน `wsl --shutdown` แล้วเปิด Ubuntu อีกครั้ง

ตอนนี้ท่านควรมีหน้าต่าง terminal ของ Ubuntu คำสั่งทั้งหมดต่อจากนี้รันในหน้าต่างนี้

## ติดตั้ง Docker Engine ภายใน WSL2

ติดตั้ง Docker ภายใน Ubuntu โดยตรง ไม่ต้องใช้ใบอนุญาตและไม่ต้องติดตั้งอะไรฝั่ง Windows

```bash
sudo apt update && sudo apt install -y ca-certificates curl git build-essential
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
```

ปิดหน้าต่าง Ubuntu เปิดใหม่ แล้วตรวจสอบ:

```bash
docker run --rm hello-world
docker compose version
```

ท่านควรเห็นข้อความ "Hello from Docker!" และ Compose เวอร์ชัน 2 ขึ้นไป

## ใช้ Docker Desktop แทน

หากแล็ปท็อปของท่านใช้ Docker Desktop อยู่แล้ว จะใช้ต่อแทนขั้นตอนข้างต้นก็ได้
ในการตั้งค่าของ Docker Desktop ให้เปิด "Use the WSL 2 based engine" และใน "Resources",
"WSL integration" ให้เปิดใช้กับ Ubuntu ของท่าน ตรวจสอบเงื่อนไขใบอนุญาตขององค์กรก่อน
เพราะ Docker Desktop ใช้ได้ฟรีเฉพาะการใช้งานบางประเภท อย่าติดตั้งทั้งสองแบบพร้อมกัน

## ติดตั้ง Node.js 24 และ pnpm 10

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 24
nvm alias default 24
corepack enable
node --version
```

ท่านควรเห็นเวอร์ชัน `v24.22.1` ขึ้นไป (เวอร์ชันก่อนหน้ามีช่องโหว่ Node2Shell) คำสั่ง `corepack enable` ทำให้โครงการใช้ pnpm
เวอร์ชันที่กำหนดไว้ ท่านจึงไม่ต้องติดตั้ง pnpm เอง

## เก็บโค้ดไว้ภายใน Linux

Clone repository ไว้ในโฟลเดอร์ home ของ Linux เช่น `~/projects/program-landscape`
ห้ามวางไว้ใต้ `/mnt/c/` เพราะแฟ้มในนั้นอยู่บนดิสก์ของ Windows ซึ่งทำให้การติดตั้งและ
dev server ช้าลงหลายเท่า และทำให้การตรวจจับการแก้ไขแฟ้มใช้ไม่ได้

หากต้องการเปิดแฟ้มของ Linux จาก Windows Explorer ให้พิมพ์ `\\wsl$` ในช่องที่อยู่

## การขึ้นบรรทัดใหม่

repository บังคับให้ใช้การขึ้นบรรทัดใหม่แบบ Linux ผ่าน `.gitattributes`
ตรวจสอบให้แน่ใจว่า Git ภายใน WSL2 ไม่แปลงค่าเหล่านี้:

```bash
git config --global core.autocrlf input
```

## โปรแกรมแก้ไขโค้ด

ใช้ VS Code บน Windows พร้อมส่วนขยาย **WSL** ใน terminal ของ Ubuntu ให้เข้าไปที่โฟลเดอร์โครงการ
แล้วรัน `code .` โปรแกรมจะเปิดบน Windows แต่ทุกคำสั่งและ terminal ทำงานใน Linux
AI coding assistant ที่ทำงานใน terminal เช่น opencode ก็ติดตั้งและรันภายใน Ubuntu เช่นกัน

## ปัญหาที่พบบ่อย

| สิ่งที่เห็น | วิธีแก้ |
|---|---|
| `permission denied while trying to connect to the Docker daemon socket` | ท่านยังไม่ได้เปิด Ubuntu ใหม่หลังรัน `usermod` ปิดหน้าต่าง Ubuntu ทุกหน้าต่าง รัน `wsl --shutdown` ใน PowerShell แล้วเปิด Ubuntu อีกครั้ง |
| `System has not been booted with systemd` | WSL ของท่านเป็นรุ่นเก่า ใน PowerShell รัน `wsl --update` แล้ว `wsl --shutdown` |
| การติดตั้งและ `pnpm dev` ช้ามาก | โครงการอยู่ใต้ `/mnt/c/` ให้ clone ใหม่ไว้ใต้โฟลเดอร์ home ของ Linux |
| ทุกแฟ้มขึ้นว่าถูกแก้ไขหลัง clone | การขึ้นบรรทัดใหม่ถูกแปลง รันคำสั่ง `git config` ข้างต้นแล้ว clone ใหม่ |
| แล็ปท็อปค้างระหว่างที่แอปทำงาน | WSL2 มีหน่วยความจำน้อยเกินไป หรือ Windows เหลือหน่วยความจำไม่พอ ปิดโปรแกรมอื่น หรือปรับค่า `memory=` ใน `.wslconfig` |
| ตัวอักษรไทยแสดงเป็นกล่องใน terminal | ใช้ Windows Terminal ไม่ใช่ command prompt แบบเก่า |

## ขั้นต่อไป

ต่อด้วย [Getting started](../tutorials/getting-started.md)
