// One-shot — resolve staff_master_record.department_raw_id → faculty_id
// using REF_FAC (MHESI faculty taxonomy) joined against our Faculty.nameTh.
// Same logic should land in the unicon-ds2001 connector for fresh loads.

import 'dotenv/config';
import * as XLSX from 'xlsx';
import { prisma } from '@kku/db';

const REF_XLSX = '/home/denpong/employment/unicon/Reference_V2.01.xlsx';

interface RefFacRow {
  FAC_ID: string;
  FAC_NAME: string;
}

async function main() {
  const apply = process.argv.includes('--apply');

  // 1. Load REF_FAC + build (Thai-name → 5-digit code) map
  const wb = XLSX.readFile(REF_XLSX);
  const refFac = XLSX.utils.sheet_to_json<RefFacRow>(wb.Sheets['REF_FAC']!, { defval: '' });
  const nameToCode = new Map<string, string>();
  for (const r of refFac) {
    const name = String(r.FAC_NAME).trim();
    const id = String(r.FAC_ID).trim();
    if (!name || !id) continue;
    // First match wins (REF_FAC has duplicates across institutions when the
    // same Thai faculty name is reused).
    if (!nameToCode.has(name)) nameToCode.set(name, id);
  }
  console.log(`REF_FAC: ${refFac.length} rows, ${nameToCode.size} unique Thai names`);

  // 2. Match each KKU Faculty.nameTh against REF_FAC. Build code → faculty_id.
  const faculties = await prisma.faculty.findMany({
    select: { id: true, nameTh: true, code: true, kind: true },
  });
  const codeToFacultyId = new Map<string, string>();
  const matched: Array<{ code: string; nameTh: string; faculty: typeof faculties[number] }> = [];
  const unmatched: typeof faculties = [];
  for (const f of faculties) {
    const code = nameToCode.get(f.nameTh);
    if (code) {
      codeToFacultyId.set(code, f.id);
      matched.push({ code, nameTh: f.nameTh, faculty: f });
    } else {
      unmatched.push(f);
    }
  }
  console.log(`Faculty matched: ${matched.length} / ${faculties.length}`);
  for (const m of matched) console.log(`  ✓ ${m.code} → ${m.nameTh} (${m.faculty.code})`);
  if (unmatched.length > 0) {
    console.log(`Faculty unmatched: ${unmatched.length}`);
    for (const u of unmatched) console.log(`  ✗ ${u.nameTh} (${u.code})`);
  }

  // 3. Diagnostic — top department_raw_id values that *don't* match
  const distinct = await prisma.$queryRaw<Array<{ department_raw_id: string; n: number }>>`
    SELECT department_raw_id, COUNT(*)::int AS n
      FROM staff_master_record
     WHERE department_raw_id IS NOT NULL
     GROUP BY department_raw_id
     ORDER BY n DESC
  `;
  let willResolve = 0;
  let willStayNull = 0;
  const unresolvedSamples: Array<{ code: string; n: number }> = [];
  for (const d of distinct) {
    if (codeToFacultyId.has(d.department_raw_id)) {
      willResolve += d.n;
    } else {
      willStayNull += d.n;
      if (unresolvedSamples.length < 12) unresolvedSamples.push({ code: d.department_raw_id, n: d.n });
    }
  }
  console.log(`\nProjected coverage:`);
  console.log(`  resolved: ${willResolve.toLocaleString()} / ${(willResolve + willStayNull).toLocaleString()}  (${((willResolve / (willResolve + willStayNull)) * 100).toFixed(1)}%)`);
  console.log(`  unresolved: ${willStayNull.toLocaleString()}`);
  console.log(`  sample unresolved codes (top 12 by headcount):`);
  for (const s of unresolvedSamples) {
    // Look up the REF_FAC name for context
    const refRow = refFac.find((r) => String(r.FAC_ID).trim() === s.code);
    const name = refRow ? refRow.FAC_NAME.trim() : '?';
    console.log(`    ${s.code}  n=${s.n.toLocaleString()}  REF_FAC name: ${name}`);
  }

  if (!apply) {
    console.log('\n[dry-run] no changes. Re-run with --apply to write.');
    await prisma.$disconnect();
    return;
  }

  // 4. Apply: UPDATE staff_master_record SET faculty_id = ... per code
  let total = 0;
  for (const [code, facultyId] of codeToFacultyId) {
    const r = await prisma.$executeRaw`
      UPDATE staff_master_record
         SET faculty_id = ${facultyId}
       WHERE department_raw_id = ${code}
    `;
    total += r;
  }
  console.log(`\n[apply] updated ${total.toLocaleString()} rows`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
