import random
import re
import unittest
from pathlib import Path
from types import SimpleNamespace

from wsmock.inputs import Inputs, ProgrammeInput, resolve_anchors
from wsmock.slice import SIZES, _spec, choose_slice
from wsmock.tcas import round3_totals
from wsmock.tcas_match import link_rows
from wsmock.tcas import TcasRow, load_rows, own_rows

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "tcas-sample.xlsx"
KMUTT = "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี"


class SliceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rows = load_rows(Path("/nonexistent"), offline=True, files=[(FIXTURE, 2567, "3")])
        cls.own = own_rows(rows, KMUTT)
        pairs = sorted({(r.faculty, r.programme) for r in cls.own})
        cls.pair = pairs[0]
        cls.name = cls.pair[1]

    def anchors(self, extra=()):
        progs = [ProgrammeInput(name=self.name, pdf=None, faculty=self.pair[0])] + list(extra)
        return resolve_anchors(Inputs(KMUTT, "x", progs), self.own)

    def slice(self, seed=7, size="small", extra=()):
        return choose_slice(self.anchors(extra), self.own, size, random.Random(seed))

    def test_bounds_and_anchor(self):
        s = self.slice()
        self.assertLessEqual(len(s.faculties), SIZES["small"][0])
        self.assertLessEqual(len(s.programmes), SIZES["small"][1])
        anchors = [p for p in s.programmes if p.is_anchor]
        self.assertEqual(len(anchors), 1)
        self.assertEqual(anchors[0].name_th, self.name)

    def test_sibling_same_level(self):
        s = self.slice()
        a = next(p for p in s.programmes if p.is_anchor)
        sibs = [p for p in s.programmes if p.sibling_of == a.code]
        self.assertEqual(len(sibs), 1)
        self.assertEqual(sibs[0].level, a.level)
        self.assertNotEqual(sibs[0].name_th, a.name_th)

    def test_references_exist(self):
        s = self.slice(size="medium")
        fac = {f.code for f in s.faculties}
        dep = {d.code: d for d in s.departments}
        for d in s.departments:
            self.assertIn(d.faculty_code, fac)
        for p in s.programmes:
            self.assertIn(p.faculty_code, fac)
            self.assertEqual(dep[p.department_code].faculty_code, p.faculty_code)

    def test_codes_sorted(self):
        s = self.slice(size="medium")
        self.assertEqual([f.code for f in s.faculties],
                         [f"MOCK-F{i:02d}" for i in range(1, len(s.faculties) + 1)])
        self.assertEqual([p.code for p in s.programmes],
                         [f"MOCK-P{i:03d}" for i in range(1, len(s.programmes) + 1)])

    def test_track_pair_is_one_programme(self):
        s = self.slice(size="medium")
        names = [(p.faculty_code, p.name_th) for p in s.programmes]
        self.assertEqual(len(names), len(set(names)))
        # the synthetic track-pair programme sums both tracks' quota
        rows = [r for r in self.own if r.course_code in ("10140107399991Z",)]
        self.assertTrue(rows)
        src = rows[0]
        pairs_rows = [r for r in self.own if (r.faculty, r.programme) == (src.faculty, src.programme)]
        self.assertGreater(len(pairs_rows), 1)
        anchor_inp = ProgrammeInput(name=src.programme, pdf=None, faculty=src.faculty)
        s2 = choose_slice(
            resolve_anchors(Inputs(KMUTT, "x", [anchor_inp]), self.own), self.own, "small", random.Random(1)
        )
        a = next(p for p in s2.programmes if p.is_anchor)
        want = sum(r.quota or 0 for r in pairs_rows if r.entry_year_be == 2567)
        # Both tracks are summed, plus whatever else the app's matcher links to it.
        fac = {f.code: f.name_th for f in s2.faculties}
        view = [SimpleNamespace(code=p.code, name_th=p.name_th, level=p.level,
                                faculty_name_th=fac[p.faculty_code]) for p in s2.programmes]
        linked = link_rows(view, self.own)[a.code]
        self.assertTrue(all(r in linked for r in pairs_rows))
        self.assertEqual(a.tcas[2567 - 543], round3_totals(linked)[2567])
        self.assertGreaterEqual(a.tcas[2567 - 543].quota, want)

    def test_years(self):
        s = self.slice()
        self.assertEqual(s.latest_year_ce, 2567 - 543)
        self.assertEqual(s.years_ce, list(range(2024 - 4, 2025)))

    def test_deterministic(self):
        self.assertEqual(self.slice(7), self.slice(7))

    def test_postgrad_anchor_gets_plan_b_and_empty_tcas(self):
        extra = ProgrammeInput(name="วิศวกรรมเครื่องกล", pdf=None, level="MASTER", faculty=self.pair[0])
        s = self.slice(extra=[extra])
        m = next(p for p in s.programmes if p.level == "MASTER" and p.is_anchor)
        self.assertEqual(m.tcas, {})
        sib = next(p for p in s.programmes if p.sibling_of == m.code)
        self.assertEqual(sib.name_th, "วิศวกรรมเครื่องกล (แผน ข)")
        self.assertEqual(sib.faculty_code, m.faculty_code)
        self.assertEqual(sib.tcas, {})

    def test_anchors_may_exceed_sizes(self):
        names = sorted({(r.faculty, r.programme) for r in self.own})[:7]
        extra = [ProgrammeInput(name=n, pdf=None, faculty=f) for f, n in names[1:]]
        s = self.slice(extra=extra)
        self.assertGreater(len(s.programmes), SIZES["small"][1])
        self.assertEqual(sum(p.is_anchor for p in s.programmes), len(extra) + 1)

    def test_name_en_input_is_used(self):
        a = self.anchors()
        a[0].input.name_en = "Custom English Name"
        s = choose_slice(a, self.own, "small", random.Random(7))
        self.assertEqual(next(p for p in s.programmes if p.is_anchor).name_en, "Custom English Name")


THAI = re.compile("[\u0e00-\u0e7f]")


def _synthetic():
    def r(code, fac, prog):
        return TcasRow(code, "U", fac, prog, None, 2567, "3", 10, 20, 5, None, None)
    return [
        r("1", "คณะวิศวกรรมศาสตร์", "วิศวกรรมศาสตรบัณฑิต (วิศวกรรมคอมพิวเตอร์) วิศวกรรมคอมพิวเตอร์"),
        r("2", "คณะวิศวกรรมศาสตร์", "วิศวกรรมศาสตรบัณฑิต (วิศวกรรมโยธา) วิศวกรรมโยธา"),
        r("3", "คณะพยาบาลศาสตร์", "พยาบาลศาสตรบัณฑิต พยาบาลศาสตรบัณฑิต"),
        r("4", "คณะลึกลับ", "ลึกลับศาสตรบัณฑิต ลึกลับศาสตรบัณฑิต"),
        r("5", "คณะลึกลับ", "ลึกลับศาสตรบัณฑิต (วิชาประหลาด) วิชาประหลาด"),
        r("6", "วิทยาลัยนานาชาติ", "หลักสูตรศิลปศาสตรบัณฑิต สาขาวิชาภาษาอังกฤษ"),
    ]


class EnglishNameTests(unittest.TestCase):
    def assert_no_thai(self, s):
        for x in [*s.faculties, *s.departments, *s.programmes]:
            self.assertIsNone(THAI.search(x.name_en), x)

    def test_fixture_has_no_thai_english(self):
        rows = load_rows(Path("/nonexistent"), offline=True, files=[(FIXTURE, 2567, "3")])
        own = own_rows(rows, KMUTT)
        for seed in range(5):
            a = resolve_anchors(Inputs(KMUTT, "x", [ProgrammeInput(name="วิศวกรรมคอมพิวเตอร์", pdf=None)]), own)
            self.assert_no_thai(choose_slice(a, own, "medium", random.Random(seed)))

    def test_kku_style_rows_no_thai_and_placeholders_noted(self):
        own = _synthetic()
        a = resolve_anchors(Inputs("U", "x", [ProgrammeInput(name="x", pdf=None, tcas_code="4")]), own)
        s = choose_slice(a, own, "medium", random.Random(1))
        self.assert_no_thai(s)
        self.assertTrue(any("คณะลึกลับ" in n for n in s.notes), s.notes)
        fac = next(f for f in s.faculties if f.name_th == "คณะลึกลับ")
        self.assertRegex(fac.name_en, r"^Faculty F\d+$")
        prog = next(p for p in s.programmes if p.is_anchor)
        self.assertRegex(prog.name_en, r"^Bachelor's programme P\d+$")
        self.assertTrue(all("name_en" in n or "sheet" in n for n in s.notes))

    def test_prefers_translatable_programmes(self):
        own = _synthetic()
        a = resolve_anchors(Inputs("U", "x", [ProgrammeInput(name="x", pdf=None, tcas_code="1")]), own)
        s = choose_slice(a, own, "small", random.Random(1))
        eng = [f for f in s.faculties if f.name_en == "Faculty of Engineering"]
        self.assertEqual(len(eng), 1)
        self.assertFalse([f for f in s.faculties if re.match(r"Faculty F\d", f.name_en)])

    def test_college_name(self):
        own = _synthetic()
        a = resolve_anchors(Inputs("U", "x", [ProgrammeInput(name="ภาษาอังกฤษ", pdf=None, faculty="วิทยาลัยนานาชาติ")]), own)
        s = choose_slice(a, own, "small", random.Random(1))
        self.assertIn("International College", [f.name_en for f in s.faculties])


class DepartmentNameTests(unittest.TestCase):
    def test_kku_style_names_give_fields_not_degrees(self):
        self.assertEqual(_spec("วิศวกรรมศาสตรบัณฑิต (วิศวกรรมคอมพิวเตอร์) วิศวกรรมคอมพิวเตอร์"), "วิศวกรรมคอมพิวเตอร์")
        self.assertEqual(_spec("พยาบาลศาสตรบัณฑิต พยาบาลศาสตรบัณฑิต"), "พยาบาลศาสตร์")

    def test_other_shapes(self):
        self.assertEqual(_spec("หลักสูตรวิทยาศาสตรบัณฑิต สาขาวิชาฟิสิกส์ ปริญญาตรี 4 ปี"), "ฟิสิกส์")
        self.assertEqual(_spec("เทคโนโลยีบัณฑิต เทคโนโลยีอาหาร"), "เทคโนโลยีอาหาร")


if __name__ == "__main__":
    unittest.main()
