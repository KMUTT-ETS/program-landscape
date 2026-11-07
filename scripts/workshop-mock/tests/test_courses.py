import csv
import random
import tempfile
import unittest
from pathlib import Path

from wsmock.courses import (
    CATEGORIES, COURSE_CODE_RE, Course, courses_from_csv, courses_from_pdf,
    invented_courses, share_with_sibling, _clean_thai_name,
)
from wsmock.slice import Programme

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "curriculum-sample.pdf"


def prog(credits=128, level="BACHELOR"):
    return Programme(code="MOCK-P001", name_th="x", name_en="x", faculty_code="MOCK-F01",
                     department_code="MOCK-F01-D01", level=level, duration=4, credits=credits,
                     year_established=2000)


class RegexTests(unittest.TestCase):
    def test_accepts(self):
        for s in ("MEE 221", "EN241100", "EN 241 100"):
            self.assertTrue(COURSE_CODE_RE.fullmatch(s), s)

    def test_rejects(self):
        for s in ("PHY 2565", "mee 221", "ISO 9001"):
            self.assertFalse(COURSE_CODE_RE.fullmatch(s), s)


class AsciiTests(unittest.TestCase):
    def test_ascii_semantics(self):
        find = lambda x: [m.group(0) for m in COURSE_CODE_RE.finditer(x)]
        self.assertEqual(find("CPE 101\u0e04\u0e2d\u0e21\u0e1e\u0e34\u0e27\u0e40\u0e15\u0e2d\u0e23\u0e4c"), ["CPE 101"])
        self.assertEqual(find("\u0e01MEE 221"), ["MEE 221"])
        self.assertEqual(find("CPE \u0e51\u0e50\u0e51"), [])


class PdfTests(unittest.TestCase):
    def test_fixture_codes(self):
        courses, note = courses_from_pdf(FIXTURE)
        by = {c.code: c for c in courses}
        for code in ("GEN 101", "MTH 101", "CPE 101", "CPE 411", "CPE 491"):
            self.assertIn(code, by)
        self.assertEqual(len(by), len(courses))
        self.assertEqual(by["GEN 101"].category, "General education")
        self.assertEqual(by["MTH 101"].category, "Core")
        self.assertEqual(by["CPE 101"].category, "Major required")
        self.assertEqual(by["CPE 411"].category, "Major elective")
        self.assertEqual(by["CPE 491"].category, "Thesis / project")
        self.assertEqual(by["CPE 401"].credits, 6)
        self.assertEqual(by["CPE 101"].name_en, "Computer Programming")
        self.assertIn("course codes read from", note)
        for c in courses:
            self.assertIn(c.category, CATEGORIES)

    def test_bad_pdf_does_not_raise(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "fake.pdf"
            p.write_text("this is not a pdf", encoding="utf-8")
            courses, note = courses_from_pdf(p)
        self.assertEqual(courses, [])
        self.assertIn("no course codes", note)

    def test_missing_pdf_does_not_raise(self):
        courses, note = courses_from_pdf(Path("/nonexistent/x.pdf"))
        self.assertEqual(courses, [])
        self.assertIn("no course codes", note)


class NameTests(unittest.TestCase):
    def test_combining_start_dropped(self):
        self.assertIsNone(_clean_thai_name("ัสิกส์ทั่วไป"))
        self.assertIsNone(_clean_thai_name("ab"))
        self.assertIsNone(_clean_thai_name("ก" * 81))
        self.assertEqual(_clean_thai_name("แคลคูลัส 1"), "แคลคูลัส 1")
        self.assertIsNone(_clean_thai_name("ภาษาไทยเพื\x00อการสื\x00อสาร"))


class CsvTests(unittest.TestCase):
    def test_csv(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.csv"
            with p.open("w", encoding="utf-8", newline="") as f:
                w = csv.writer(f)
                w.writerow(["code", "name_th", "name_en", "credits", "category"])
                w.writerow(["MEE 221", "", "Thermo", "3", "core"])
                w.writerow(["MEE 222", "กลศาสตร์", "", "", "Bogus"])
            cs = courses_from_csv(p)
        self.assertEqual([c.code for c in cs], ["MEE 221", "MEE 222"])
        self.assertEqual(cs[0].category, "Core")
        self.assertIsNone(cs[0].name_th)
        self.assertEqual(cs[1].credits, 3)
        self.assertEqual(cs[1].category, "Major required")


class InventedTests(unittest.TestCase):
    def test_shape(self):
        for seed in range(5):
            cs = invented_courses(prog(), random.Random(seed), "Department of Mechanical Engineering")
            codes = [c.code for c in cs]
            self.assertEqual(len(codes), len(set(codes)))
            for c in codes:
                self.assertTrue(COURSE_CODE_RE.fullmatch(c), c)
            self.assertEqual(sum(c.code.startswith("GEN") for c in cs), 4)
            self.assertTrue(all(c.category in CATEGORIES for c in cs))
            self.assertTrue(35 <= len(cs) <= 48)
            self.assertLessEqual(abs(sum(c.credits for c in cs) - 128), 4)
            self.assertTrue(any(c.code.startswith("MEC") for c in cs))

    def test_no_general_education_lookalike_prefix(self):
        for name in ("Department of Geology", "Department of Genetics", "Department of Linguistics",
                     "Department of Library Science"):
            cs = invented_courses(prog(), random.Random(1), name)
            major = [c.code for c in cs if not c.code.startswith("GEN")]
            self.assertTrue(major)
            for code in major:
                self.assertFalse(code.startswith(("GE", "LI")), (name, code))
                self.assertTrue(COURSE_CODE_RE.fullmatch(code), code)

    def test_placeholder_department(self):
        cs = invented_courses(prog(), random.Random(1), "Department F03-D02")
        for c in cs:
            self.assertTrue(COURSE_CODE_RE.fullmatch(c.code), c.code)
        pre = {c.code[:3] for c in cs if not c.code.startswith("GEN")}
        self.assertEqual(len(pre), 1)
        self.assertTrue(next(iter(pre)).isalpha() and next(iter(pre)).isupper())

    def test_postgraduate_smaller(self):
        cs = invented_courses(prog(36, "MASTER"), random.Random(1), "Department of Physics")
        self.assertLessEqual(abs(sum(c.credits for c in cs) - 36), 4)

    def test_deterministic(self):
        a = invented_courses(prog(), random.Random(3), "Department of Physics")
        b = invented_courses(prog(), random.Random(3), "Department of Physics")
        self.assertEqual(a, b)


class ShareTests(unittest.TestCase):
    def test_share(self):
        for seed in range(10):
            rng = random.Random(seed)
            anchor = invented_courses(prog(), rng, "Department of Mechanical Engineering")
            sib = invented_courses(prog(), rng, "Department of Mechanical Engineering")
            out = share_with_sibling(anchor, sib, rng)
            major = {c.code for c in anchor if c.category not in ("General education", "Free elective")}
            shared_major = {c.code for c in out} & major
            self.assertTrue(6 <= len(shared_major) <= 10, len(shared_major))
            codes = [c.code for c in out]
            self.assertEqual(len(codes), len(set(codes)))
            by_anchor = {c.code: c for c in anchor}
            for c in out:
                if c.code in shared_major:
                    self.assertEqual(c.name_en, by_anchor[c.code].name_en)
            # GEN courses are not shared as "major" but may coincide; nothing else collides
            others = {c.code for c in out} & {c.code for c in anchor}
            self.assertEqual(others - shared_major, {c.code for c in anchor if c.category == "General education"})


if __name__ == "__main__":
    unittest.main()
