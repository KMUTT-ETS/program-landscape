import random
import unittest
from pathlib import Path

from wsmock.inputs import Inputs, ProgrammeInput, resolve_anchors
from wsmock.slice import SIZES, choose_slice
from wsmock.tcas import load_rows, own_rows

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
        # Linked figures follow the app's matcher, which may also pull in a row of a
        # programme outside the slice (here the international twin, by specialization),
        # so the pair's own quota is a lower bound; both tracks must be counted.
        self.assertGreaterEqual(a.tcas[2567 - 543].quota, want)
        self.assertEqual(a.tcas[2567 - 543].quota, want + 10)

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


if __name__ == "__main__":
    unittest.main()
