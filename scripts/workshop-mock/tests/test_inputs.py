import tempfile
import unittest
from pathlib import Path

from wsmock.inputs import (
    InputError, Inputs, ProgrammeInput, load_inputs, resolve_anchors,
)
from wsmock.tcas import TcasRow, load_rows, own_rows

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "fixtures" / "tcas-sample.xlsx"
KMUTT = "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี"
ENG = "คณะวิศวกรรมศาสตร์"


def inputs_of(*progs):
    return Inputs(KMUTT, "Central", list(progs))


def tr(code, prog, year, fac="f"):
    return TcasRow(code, KMUTT, fac, prog, None, year, "3", 10, 20, 5, None, None)


class InputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rows = load_rows(Path("/nonexistent"), offline=True, files=[(FIXTURE, 2567, "3")])
        cls.own = own_rows(rows, KMUTT)

    def test_name_with_spelling_difference(self):
        a = resolve_anchors(inputs_of(ProgrammeInput("หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชา วิศวกรรมวัสดุ", None)), self.own)[0]
        self.assertEqual(a.faculty_th, ENG)
        self.assertEqual(a.programme_th, "วศ.บ.สาขาวิศวกรรมวัสดุ-วศ.บ.4ปี")
        self.assertEqual(a.course_codes, ["10140107302511A"])
        self.assertEqual(len(a.rows), 1)

    def test_ambiguous_across_faculties_needs_faculty(self):
        name = "วิศวกรรมโยธา"
        with self.assertRaises(InputError):
            resolve_anchors(inputs_of(ProgrammeInput(name, None)), self.own)
        a = resolve_anchors(inputs_of(ProgrammeInput(name, None, faculty=ENG)), self.own)[0]
        self.assertEqual(a.course_codes, ["10140107302104A"])

    def test_nonsense_lists_five_candidates(self):
        with self.assertRaises(InputError) as cm:
            resolve_anchors(inputs_of(ProgrammeInput("zzzz qqqq", None)), self.own)
        lines = [l for l in str(cm.exception).splitlines() if "(0." in l or "(1." in l]
        self.assertEqual(len(lines), 5)
        self.assertIn(" | ", lines[0])

    def test_tcas_code_wins(self):
        a = resolve_anchors(inputs_of(ProgrammeInput("zzzz", None, tcas_code="10140107302104A")), self.own)[0]
        self.assertEqual(a.course_codes, ["10140107302104A"])

    def test_unknown_tcas_code(self):
        with self.assertRaises(InputError):
            resolve_anchors(inputs_of(ProgrammeInput("x", None, tcas_code="nope")), self.own)

    def test_track_pair_has_two_codes(self):
        a = resolve_anchors(inputs_of(ProgrammeInput("x", None, tcas_code="10140107300507A")), self.own)[0]
        self.assertEqual(a.course_codes, ["10140107300507A", "10140107399991Z"])
        self.assertEqual(len(a.rows), 2)

    def test_master_needs_faculty(self):
        with self.assertRaises(InputError):
            resolve_anchors(inputs_of(ProgrammeInput("x", None, level="MASTER")), self.own)

    def test_postgraduate_faculty_spelling(self):
        a = resolve_anchors(inputs_of(ProgrammeInput("วศ.ม. X", None, level="MASTER", faculty="คณะ วิศวกรรมศาสตร์")), self.own)[0]
        self.assertEqual((a.faculty_th, a.programme_th, a.rows), (ENG, "วศ.ม. X", []))
        b = resolve_anchors(inputs_of(ProgrammeInput("Y", None, level="MASTER", faculty="คณะอื่น")), self.own)[0]
        self.assertEqual(b.faculty_th, "คณะอื่น")

    def test_old_spelling_ignored_latest_year_only(self):
        own = [
            tr("OLD1", "วิศวกรรมสมมุติ - วศ.บ. 4 ปี", 2566),
            tr("C1", "วศ.บ.สาขาวิศวกรรมสมมุติใหม่-วศ.บ.4ปี", 2567),
            tr("C2", "วศ.บ.สาขาวิศวกรรมสมมุติใหม่-วศ.บ.4ปี", 2567),
            tr("C3", "วศ.บ.สาขาวิศวกรรมอื่นโดยสิ้นเชิง-วศ.บ.4ปี", 2567),
        ]
        a = resolve_anchors(inputs_of(ProgrammeInput("วิศวกรรมสมมุติ", None)), own)[0]
        self.assertEqual(a.programme_th, "วศ.บ.สาขาวิศวกรรมสมมุติใหม่-วศ.บ.4ปี")
        self.assertEqual(a.course_codes, ["C1", "C2"])
        self.assertEqual({r.entry_year_be for r in a.rows}, {2567})

    def test_older_year_tcas_code_rejected(self):
        own = [tr("OLD1", "วศ.บ.สาขาวิศวกรรมสมมุติ-วศ.บ.4ปี", 2566), tr("C1", "วศ.บ.สาขาวิศวกรรมสมมุติ-วศ.บ.4ปี", 2567)]
        with self.assertRaises(InputError) as cm:
            resolve_anchors(inputs_of(ProgrammeInput("x", None, tcas_code="OLD1")), own)
        self.assertIn("latest TCAS year (2567)", str(cm.exception))
        self.assertIn("C1", str(cm.exception))

    def test_invalid_level_in_resolve(self):
        with self.assertRaises(InputError):
            resolve_anchors(inputs_of(ProgrammeInput("x", None, level="NOPE")), self.own)

    def test_example_toml_round_trip(self):
        i = load_inputs(ROOT / "example-input.toml")
        self.assertEqual(i.university, KMUTT)
        self.assertEqual(len(i.programmes), 2)
        p = i.programmes[0]
        self.assertEqual(p.level, "BACHELOR")
        self.assertEqual(p.pdf, ROOT / "pdfs" / "computer-engineering.pdf")
        self.assertIsNone(p.tcas_code)

    def test_bad_level(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "i.toml"
            f.write_text('university="u"\nregion="r"\n[[programme]]\nname="n"\nlevel="x"\n', encoding="utf-8")
            with self.assertRaises(InputError):
                load_inputs(f)


if __name__ == "__main__":
    unittest.main()


def _r(code, fac, prog, uni="U"):
    return TcasRow(code, uni, fac, prog, None, 2569, "3", 10, 20, 5, None, None)


ENG = "คณะวิศวกรรมศาสตร์"
KKU_ROWS = [  # names copied from the real TCAS69 file (Khon Kaen University)
    _r("10030104300501A", ENG, "วิศวกรรมศาสตรบัณฑิต (วิศวกรรมคอมพิวเตอร์) วิศวกรรมคอมพิวเตอร์"),
    _r("10030104301001E", ENG, "วิศวกรรมศาสตรบัณฑิต (วิศวกรรมสื่อดิจิทัล) หลักสูตรนานาชาติ วิศวกรรมสื่อดิจิทัล หลักสูตรนานาชาติ"),
    _r("10030104303402A", ENG, "วิศวกรรมศาสตรบัณฑิต (วิศวกรรมเซมิคอนดักเตอร์) วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเซมิคอนดักเตอร์"),
    _r("10030104300601A", ENG, "วิศวกรรมศาสตรบัณฑิต (วิศวกรรมเครื่องกล) วิศวกรรมเครื่องกล"),
    _r("10030105703501A", "คณะศึกษาศาสตร์", "ศึกษาศาสตรบัณฑิต (คอมพิวเตอร์ศึกษา) ศึกษาศาสตรบัณฑิต วิชาเอกคอมพิวเตอร์ศึกษา"),
    _r("10030138220202A", "วิทยาลัยการคอมพิวเตอร์", "วิทยาศาสตรบัณฑิต (วิทยาการคอมพิวเตอร์) วิทยาการคอมพิวเตอร์"),
]
KMUTT_ROWS = [
    _r("10140107300507A", ENG, "วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์ ปริญญาตรี 4 ปี", KMUTT),
    _r("10140107300502E", ENG, "วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์ ปริญญาตรี 4 ปี  (หลักสูตรนานาชาติ)", KMUTT),
]


def _resolve(rows, name, faculty=None):
    a = resolve_anchors(Inputs("U", "x", [ProgrammeInput(name=name, pdf=None, faculty=faculty)]), rows)
    return a[0].course_codes


class NameViewTests(unittest.TestCase):
    def test_computer_engineering_not_semiconductor(self):
        self.assertEqual(_resolve(KKU_ROWS, "วิศวกรรมคอมพิวเตอร์", ENG), ["10030104300501A"])
        self.assertEqual(_resolve(KKU_ROWS, "วิศวกรรมคอมพิวเตอร์"), ["10030104300501A"])

    def test_semiconductor(self):
        self.assertEqual(_resolve(KKU_ROWS, "วิศวกรรมเซมิคอนดักเตอร์"), ["10030104303402A"])

    def test_digital_media(self):
        self.assertEqual(_resolve(KKU_ROWS, "วิศวกรรมสื่อดิจิทัล"), ["10030104301001E"])

    def test_kmutt_computer_engineering_picks_plain_over_international(self):
        self.assertEqual(_resolve(KMUTT_ROWS, "วิศวกรรมคอมพิวเตอร์"), ["10140107300507A"])
        self.assertEqual(_resolve(KMUTT_ROWS, "วิศวกรรมคอมพิวเตอร์ (หลักสูตรนานาชาติ)"), ["10140107300502E"])
