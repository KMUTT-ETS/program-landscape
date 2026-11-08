// ─────────────────────────────────────────────────────────────────────────────
// Writes the workshop programme's invented curriculum document as a PDF:
// workshop/sample-data/curriculum/workshop-demo-curriculum.pdf
//
// Maintainer-only. Participants use the committed PDF; this exists so the
// course list in the PDF can never disagree with 13-programme-courses.xlsx
// (both come from WORKSHOP_COURSES).
//
// Needs Gotenberg running (pnpm db:up). Usage: pnpm workshop:sample-pdf
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { UNIVERSITY, WORKSHOP_COURSES } from './sample-data';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const outDir = path.join(repoRoot, 'workshop', 'sample-data', 'curriculum');
const fontDir = path.join(repoRoot, 'apps', 'web', 'public', 'fonts', 'sarabun');
const gotenberg = process.env.GOTENBERG_URL ?? 'http://localhost:3001';

type Course = (typeof WORKSHOP_COURSES)[number];

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function courseRows(courses: readonly Course[]): string {
  return courses
    .map(([code, th, en, credits]) => `<tr><td>${esc(code)}</td><td>${esc(th)}<br><span class="en">${esc(en)}</span></td><td class="num">${credits}</td></tr>`)
    .join('\n');
}

function group(category: string): readonly Course[] {
  return WORKSHOP_COURSES.filter((c) => c[4] === category);
}

function sumCredits(courses: readonly Course[]): number {
  return courses.reduce((t, c) => t + c[3], 0);
}

/** A one-sentence invented description per course, from its English name. */
function description([code, th, en]: Course): string {
  return `<p><b>${esc(code)} ${esc(th)}</b> (${esc(en)})<br>ศึกษาหลักการและแนวคิดพื้นฐานของ${esc(th)} การประยุกต์ใช้ในงานวิศวกรรมคอมพิวเตอร์ และฝึกปฏิบัติผ่านกรณีศึกษาและโครงงานขนาดเล็ก</p>`;
}

function html(): string {
  const ge = group('General education');
  const core = group('Core');
  const req = group('Major required');
  const elec = group('Major elective');
  const proj = group('Thesis / project');
  const MIN_ELECTIVE = 18;
  const major = sumCredits(core) + sumCredits(req) + MIN_ELECTIVE + sumCredits(proj);
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>Curriculum</title>
<style>
  @font-face { font-family: 'WorkshopSarabun'; src: url('Sarabun-Regular.ttf'); font-weight: 400; }
  @font-face { font-family: 'WorkshopSarabun'; src: url('Sarabun-Bold.ttf'); font-weight: 700; }
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: 'WorkshopSarabun', sans-serif; font-size: 15pt; line-height: 1.45; }
  h1 { font-size: 22pt; text-align: center; margin: 0 0 4mm; }
  h2 { font-size: 18pt; margin: 8mm 0 2mm; page-break-after: avoid; }
  h3 { font-size: 16pt; margin: 5mm 0 2mm; page-break-after: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 2mm 0 4mm; }
  td, th { border: 1px solid gray; padding: 1.5mm 2.5mm; vertical-align: top; }
  .num { text-align: right; width: 18mm; }
  .en { font-size: 12pt; }
  .cover { text-align: center; margin-top: 60mm; page-break-after: always; }
  .note { font-size: 12pt; border: 1px solid gray; padding: 3mm; margin-top: 20mm; }
</style></head><body>

<div class="cover">
  <h1>หลักสูตรวิศวกรรมศาสตรบัณฑิต<br>สาขาวิชาวิศวกรรมคอมพิวเตอร์</h1>
  <p>หลักสูตรปรับปรุง พ.ศ. 2566</p>
  <p>${esc(UNIVERSITY.nameTh)}<br>${esc(UNIVERSITY.nameEn)}</p>
  <div class="note">เอกสารสมมติสำหรับการอบรม (workshop) เท่านั้น ไม่ใช่หลักสูตรจริงของสถาบันใด<br>
  A fictitious document for workshop use only. It is not the curriculum of any real institution.</div>
</div>

<h2>หมวดที่ 1 ข้อมูลทั่วไป</h2>
<p>1. ชื่อหลักสูตร: หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์ (Bachelor of Engineering Program in Computer Engineering)</p>
<p>2. ชื่อปริญญา: วิศวกรรมศาสตรบัณฑิต (วิศวกรรมคอมพิวเตอร์) / Bachelor of Engineering (Computer Engineering), วศ.บ. (วิศวกรรมคอมพิวเตอร์) / B.Eng. (Computer Engineering)</p>
<p>3. จำนวนหน่วยกิตที่เรียนตลอดหลักสูตร: ไม่น้อยกว่า 121 หน่วยกิต</p>
<p>4. รูปแบบของหลักสูตร: หลักสูตรระดับปริญญาตรี 4 ปี ใช้ภาษาไทยเป็นหลักในการจัดการเรียนการสอน</p>
<p>5. ส่วนงานที่รับผิดชอบ: ภาควิชาวิศวกรรมคอมพิวเตอร์ คณะวิศวกรรมศาสตร์</p>

<h2>หมวดที่ 2 ปรัชญา วัตถุประสงค์ และผลลัพธ์การเรียนรู้</h2>
<p>ปรัชญา: ผลิตวิศวกรคอมพิวเตอร์ที่มีความรู้ทั้งด้านฮาร์ดแวร์และซอฟต์แวร์ สามารถออกแบบและพัฒนาระบบคอมพิวเตอร์ที่ปลอดภัยและยั่งยืน เพื่อตอบสนองความต้องการของภาคอุตสาหกรรมและชุมชน</p>
<h3>ผลลัพธ์การเรียนรู้ที่คาดหวังของหลักสูตร (PLOs)</h3>
<p>PLO 1 ประยุกต์ความรู้ด้านคณิตศาสตร์ วิทยาศาสตร์ และวิศวกรรมพื้นฐานในการแก้ปัญหาทางวิศวกรรมคอมพิวเตอร์</p>
<p>PLO 2 ออกแบบและพัฒนาซอฟต์แวร์ที่มีคุณภาพ โดยใช้หลักวิศวกรรมซอฟต์แวร์และโครงสร้างข้อมูลที่เหมาะสม</p>
<p>PLO 3 ออกแบบระบบฮาร์ดแวร์และระบบสมองกลฝังตัวที่ทำงานร่วมกับซอฟต์แวร์ได้อย่างมีประสิทธิภาพ</p>
<p>PLO 4 วิเคราะห์ข้อมูลและประยุกต์ใช้ปัญญาประดิษฐ์และการเรียนรู้ของเครื่องอย่างมีจริยธรรม</p>
<p>PLO 5 ออกแบบและดูแลระบบเครือข่ายและความมั่นคงปลอดภัยของระบบคอมพิวเตอร์</p>
<p>PLO 6 ทำงานเป็นทีม สื่อสารได้ทั้งภาษาไทยและภาษาอังกฤษ และเรียนรู้ตลอดชีวิต</p>

<h2>หมวดที่ 3 ระบบการจัดการศึกษาและโครงสร้างของหลักสูตร</h2>
<h3>3.1 หลักสูตร</h3>
<p>3.1.1 จำนวนหน่วยกิตรวมตลอดหลักสูตร ไม่น้อยกว่า 121 หน่วยกิต</p>
<p>3.1.2 โครงสร้างหลักสูตร</p>
<table>
<tr><th>หมวดวิชา</th><th class="num">หน่วยกิต</th></tr>
<tr><td>1. หมวดวิชาศึกษาทั่วไป</td><td class="num">${sumCredits(ge)}</td></tr>
<tr><td>2. หมวดวิชาเฉพาะ</td><td class="num">${major}</td></tr>
<tr><td>&nbsp;&nbsp;2.1 กลุ่มวิชาแกน</td><td class="num">${sumCredits(core)}</td></tr>
<tr><td>&nbsp;&nbsp;2.2 กลุ่มวิชาเฉพาะบังคับ</td><td class="num">${sumCredits(req)}</td></tr>
<tr><td>&nbsp;&nbsp;2.3 กลุ่มวิชาเฉพาะเลือก ไม่น้อยกว่า</td><td class="num">${MIN_ELECTIVE}</td></tr>
<tr><td>&nbsp;&nbsp;2.4 โครงงาน</td><td class="num">${sumCredits(proj)}</td></tr>
<tr><td>3. หมวดวิชาเลือกเสรี ไม่น้อยกว่า</td><td class="num">6</td></tr>
</table>

<h3>3.1.3 รายวิชา</h3>
<p>1) หมวดวิชาศึกษาทั่วไป ${sumCredits(ge)} หน่วยกิต</p>
<table><tr><th>รหัสวิชา</th><th>ชื่อรายวิชา</th><th class="num">หน่วยกิต</th></tr>
${courseRows(ge)}</table>
<p>2) หมวดวิชาเฉพาะ ไม่น้อยกว่า ${major} หน่วยกิต</p>
<p>2.1) กลุ่มวิชาแกน ${sumCredits(core)} หน่วยกิต</p>
<table><tr><th>รหัสวิชา</th><th>ชื่อรายวิชา</th><th class="num">หน่วยกิต</th></tr>
${courseRows(core)}</table>
<p>2.2) กลุ่มวิชาเฉพาะบังคับ ${sumCredits(req)} หน่วยกิต</p>
<table><tr><th>รหัสวิชา</th><th>ชื่อรายวิชา</th><th class="num">หน่วยกิต</th></tr>
${courseRows(req)}</table>
<p>2.3) กลุ่มวิชาเฉพาะเลือก ไม่น้อยกว่า ${MIN_ELECTIVE} หน่วยกิต ให้เลือกเรียนจากรายวิชาต่อไปนี้</p>
<table><tr><th>รหัสวิชา</th><th>ชื่อรายวิชา</th><th class="num">หน่วยกิต</th></tr>
${courseRows(elec)}</table>
<p>2.4) โครงงาน ${sumCredits(proj)} หน่วยกิต</p>
<table><tr><th>รหัสวิชา</th><th>ชื่อรายวิชา</th><th class="num">หน่วยกิต</th></tr>
${courseRows(proj)}</table>
<p>3) หมวดวิชาเลือกเสรี ไม่น้อยกว่า 6 หน่วยกิต ให้เลือกเรียนรายวิชาใดก็ได้ที่เปิดสอนในมหาวิทยาลัย</p>

<h3>3.1.4 คำอธิบายรายวิชา</h3>
${WORKSHOP_COURSES.map(description).join('\n')}

<h2>หมวดที่ 4 การวัดและประเมินผล</h2>
<p>ประเมินผลตามระเบียบของมหาวิทยาลัยว่าด้วยการศึกษาระดับปริญญาตรี ใช้ระบบค่าระดับคะแนน A ถึง F
ทวนสอบผลสัมฤทธิ์ของนักศึกษาตามผลลัพธ์การเรียนรู้ทุกภาคการศึกษา และสำรวจความพึงพอใจของผู้ใช้บัณฑิตทุกปี</p>
</body></html>`;
}

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  const form = new FormData();
  form.append('files', new Blob([html()], { type: 'text/html' }), 'index.html');
  // Embed the repo's own Thai font. Chromium still emits Thai vowel and tone
  // marks as separate text runs, so text extracted from this PDF has spaces
  // inside words ("ราย วิ ชา"): the AI pipeline reads it, but the regex that
  // slices the course-list section does not. The sample track takes the course
  // list from 13-programme-courses.xlsx, which wins over the PDF by design.
  // LibreOffice was tried with every Thai font in the container and produced
  // garbled characters instead, which is worse.
  for (const face of ['Sarabun-Regular.ttf', 'Sarabun-Bold.ttf']) {
    form.append('files', new Blob([fs.readFileSync(path.join(fontDir, face))], { type: 'font/ttf' }), face);
  }
  const res = await fetch(`${gotenberg}/forms/chromium/convert/html`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Gotenberg answered ${res.status}: ${await res.text()}`);
  const file = path.join(outDir, 'workshop-demo-curriculum.pdf');
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`wrote ${path.relative(repoRoot, file)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
