import tempfile
import unittest
from pathlib import Path

import openpyxl

from wsmock.tcas import TcasRow, load_rows, own_rows, closest_institutions, round3_totals

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "tcas-sample.xlsx"
KMUTT = "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี"


def row(code, year=2567, quota=10, applicants=20, admitted=5):
    return TcasRow(code, KMUTT, "f", "p", None, year, "3", quota, applicants, admitted, None, None)


class TcasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = load_rows(Path("/nonexistent"), offline=True, files=[(FIXTURE, 2567, "3")])

    def test_load_rows(self):
        self.assertGreater(len(self.rows), 0)
        self.assertTrue(all(r.entry_year_be == 2567 for r in self.rows))

    def test_blank_pass_row_has_no_admitted(self):
        r = next(r for r in self.rows if r.course_code == "10140107399992Z")
        self.assertIsNone(r.admitted)
        self.assertIsNotNone(r.quota)

    def test_own_rows_exact(self):
        own = own_rows(self.rows, KMUTT)
        self.assertGreater(len(own), 0)
        self.assertTrue(all(r.institution == KMUTT for r in own))
        self.assertEqual(own_rows(self.rows, KMUTT + " "), [])

    def test_closest_institutions(self):
        names = closest_institutions(self.rows, "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้า")
        self.assertEqual(names[0], KMUTT)

    def test_round3_counts_code_once(self):
        t = round3_totals([row("A"), row("A"), row("B")])
        self.assertEqual(t[2567].quota, 20)
        self.assertEqual(t[2567].applicants, 40)
        self.assertEqual(t[2567].admitted, 10)

    def test_round3_admitted_none_when_unstated(self):
        t = round3_totals([row("A", admitted=None)])
        self.assertIsNone(t[2567].admitted)

D = "มหาวิทยาลัยทดสอบ"
HEADERS = {
    "2562": ["รหัส", "สถาบัน", "รหัสหลักสูตร", "คณะ", "หลักสูตร", "รับร่วม", "กลุ่มองค์ประกอบ", "PAT7", "รับ", "สมัคร", "ผ่าน", "อัตราการแข่งขัน", "ผ่านสัมภาษณ์", "ไม่ประสงค์เข้าศึกษา/ตกสัมภาษณ์", "สละสิทธิ์", "มีสิทธิ์เข้าศึกษา", "คะแนนสูงสุด", "คะแนนต่ำสุด", "คะแนนต่ำสุด\n(มีสิทธิ์เข้าศึกษา)", "ความต่างของคะแนน", "คะแนนเฉลี่ย", "SD"],
    "2563": ["ลำดับ", "รหัสหลักสูตร", "สถาบัน", "วิทยาเขต", "คณะ", "หลักสูตร", "แขนง/วิชาเอก", "รหัส\nโครงการ", "โครงการ/รูปแบบ", "PAT", "รหัสรับร่วม", "รับ", "สมัคร", "ผ่าน", "อัตราการแข่งขัน", "คะแนนสูงสุด", "คะแนนต่ำสุด", "ความต่างของคะแนน"],
    "2565": ["university_id", "university_name", "program_id", "major_id", "project_id", "campus_name_th", "program_lookup_programs.faculty_name_th", "program_name_th", "project_name_th", "major_name_th", "join_id", "รับ", "สมัคร", "ผ่าน", "คะแนนต่ำสุด", "คะแนนสูงสุด", "คะแนนต่ำสุด หลังประมวลผลรอบ 2", "คะแนนสูงสุด หลังประมวลผลรอบ 2"],
    "2566": ["สถาบัน", "วิทยาเขต", "รหัสหลักสูตร", "คณะ/สำนักวิชา", "ชื่อหลักสูตร", "รายละเอียด", "สาขาวิชา/วิชาเอก", "รหัสรับร่วม", "รับ", "สมัคร", "ผ่าน", "คะแนนต่ำสุด", "คะแนนสูงสุด"],
    "2568-3.1": ["สถาบัน", "วิทยาเขต", "รหัสหลักสูตร", "คณะ", "หลักสูตร", "รายละเอียด", "สาขา/วิชาเอก", "รหัสรับร่วม", "รับ", "สมัคร", "ผ่าน", "คะแนนสูงสุด", "คะแนนต่ำสุด"],
    "2568-3.2": ["สถาบัน", "วิทยาเขต", "รหัสหลักสูตร", "คณะ", "หลักสูตร", "รายละเอียด", "สาขา/วิชาเอก", "รหัสรับร่วม", "รับ", "สมัคร", "ผ่าน ประมวลผลครั้งที่ 1", "ผ่าน ประมวลผลครั้งที่ 2", "คะแนนสูงสุด ประมวลผลครั้งที่ 1", "คะแนนต่ำสุด ประมวลผลครั้งที่ 1", "คะแนนสูงสุด ประมวลผลครั้งที่ 2", "คะแนนต่ำสุด ประมวลผลครั้งที่ 2"],
    "2569": ["สถาบัน", "วิทยาเขต", "รหัสหลักสูตร", "รหัสสาขา", "รหัสโครงการ", "คณะ", "หลักสูตร", "รายละเอียด", "สาขา/วิชาเอก", "รหัสรับร่วม", "รับ", "สมัคร", "ผ่าน", "คะแนนสูงสุด", "คะแนนต่ำสุด", "ผ่าน DS", "คะแนนสูงสุด DS", "คะแนนต่ำสุด DS"],
}
VALUES = {  # header -> cell value for the two synthetic rows
    "สถาบัน": D, "university_name": D,
    "รหัสหลักสูตร": "{code}", "program_id": "{code}",
    "คณะ": "คณะวิทย์", "คณะ/สำนักวิชา": "คณะวิทย์", "program_lookup_programs.faculty_name_th": "คณะวิทย์",
    "หลักสูตร": "วท.บ.เคมี", "ชื่อหลักสูตร": "วท.บ.เคมี", "program_name_th": "วท.บ.เคมี",
    "รับ": 30, "สมัคร": 90, "ผ่าน": 25, "ผ่าน ประมวลผลครั้งที่ 1": 20, "ผ่าน ประมวลผลครั้งที่ 2": 5,
    "คะแนนต่ำสุด": 50.5, "คะแนนสูงสุด": 80.5,
    "คะแนนต่ำสุด ประมวลผลครั้งที่ 1": 50.5, "คะแนนสูงสุด ประมวลผลครั้งที่ 1": 80.5,
}


class LayoutTests(unittest.TestCase):
    def _load(self, name: str, year: int, rnd: str):
        headers = HEADERS[name]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "x.xlsx"
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.append(headers)
            for code in ("C1", "C2"):
                ws.append([
                    (VALUES[h].format(code=code) if isinstance(VALUES[h], str) else VALUES[h])
                    if h in VALUES else None
                    for h in headers
                ])
            wb.save(path)
            return load_rows(Path(tmp), offline=True, files=[(path, year, rnd)])

    def test_layouts(self):
        for name in HEADERS:
            year = int(name[:4])
            rnd = name[5:] or "3"
            with self.subTest(layout=name):
                rows = self._load(name, year, rnd)
                self.assertEqual(len(rows), 2)
                for r in rows:
                    self.assertEqual(r.institution, D)
                    self.assertTrue(r.course_code.startswith("C"))
                    self.assertEqual(r.faculty, "คณะวิทย์")
                    self.assertEqual(r.programme, "วท.บ.เคมี")
                    self.assertEqual((r.quota, r.applicants), (30, 90))
                    self.assertEqual(r.admitted, 25)
                    self.assertEqual((r.min_score, r.max_score), (50.5, 80.5))

    def test_31_blank_then_32_counts(self):
        a = TcasRow("A", D, "f", "p", None, 2568, "3.1", 10, 20, None, None, None)
        b = TcasRow("A", D, "f", "p", None, 2568, "3.2", 10, 20, 7, None, None)
        self.assertEqual(round3_totals([a, b])[2568].admitted, 7)
        self.assertEqual(round3_totals([b, a])[2568].admitted, 7)


if __name__ == "__main__":
    unittest.main()
