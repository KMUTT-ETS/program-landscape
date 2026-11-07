import json
import unittest
from pathlib import Path
from types import SimpleNamespace as NS

from wsmock.tcas import TcasRow
from wsmock.tcas_match import (
    MatchProgramme,
    build_tcas_match_index,
    extract_specialization,
    find_own_programme_match,
    link_rows,
)

INDEX = build_tcas_match_index([
    MatchProgramme("eng-me", "หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเครื่องกล", [], "คณะวิศวกรรมศาสตร์"),
    MatchProgramme("sci-math", "คณิตศาสตร์", [], "คณะวิทยาศาสตร์"),
    MatchProgramme("sport-x", "วิทยาศาสตร์การกีฬา", [], "คณะวิทยาศาสตร์การกีฬา"),
])


def mid(f, p, m=""):
    r = find_own_programme_match(INDEX, f, p, m)
    return r.id if r else None


class TcasMatchTests(unittest.TestCase):
    def test_exact(self):
        self.assertEqual(mid("คณะวิทยาศาสตร์", "คณิตศาสตร์"), "sci-math")

    def test_abbreviated_via_sakha(self):
        self.assertEqual(mid("คณะวิศวกรรมศาสตร์", "วศ.บ.สาขาวิศวกรรมเครื่องกล-วศ.บ.4ปี"), "eng-me")

    def test_faculty_prefix_not_crossed(self):
        self.assertIsNone(mid("คณะวิทยาศาสตร์", "วิทยาศาสตร์การกีฬา"))

    def test_none(self):
        self.assertIsNone(mid("คณะวิศวกรรมศาสตร์", "นิติศาสตร์"))

    def test_extract(self):
        self.assertEqual(extract_specialization("คณิตศาสตร์ - วท.บ. 4 ปี"), "คณิตศาสตร์")

    def test_real_shaped_old_spelling_links(self):
        p = NS(code="P1", name_th="วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์ ปริญญาตรี 4 ปี",
               faculty_name_th="คณะวิศวกรรมศาสตร์", level="BACHELOR")
        row = TcasRow("c", "u", "คณะวิศวกรรมศาสตร์", "วศ.บ.สาขาวิศวกรรมคอมพิวเตอร์-วศ.บ.4ปี", None,
                      2562, "3", 10, 20, 5, None, None)
        other = TcasRow("d", "u", "คณะอื่น", "วศ.บ.สาขาวิศวกรรมคอมพิวเตอร์-วศ.บ.4ปี", None,
                        2562, "3", 10, 20, 5, None, None)
        got = link_rows([p], [row, other])
        self.assertEqual(got["P1"], [row])

    def test_strategy4_major_contains_programme_name(self):
        self.assertEqual(mid("คณะวิทยาศาสตร์", "ไม่เกี่ยวข้อง", "คณิตศาสตร์ประยุกต์"), "sci-math")

    def test_5b_extractable_major_links(self):
        self.assertEqual(
            mid("คณะวิศวกรรมศาสตร์", "ไม่เกี่ยวข้อง", "วศ.บ.สาขาวิศวกรรมเครื่องกล-วศ.บ.4ปี"), "eng-me")

    def test_5b_unextractable_major_is_skipped_like_ts(self):
        # TS: extractSpecialization('') is '' (not null), so `??` keeps '' and 5b is skipped.
        self.assertIsNone(mid("คณะวิศวกรรมศาสตร์", "ไม่เกี่ยวข้อง", "วิศวกรรมเครื่องกล"))

    def test_postgraduate_not_indexed(self):
        p = NS(code="M1", name_th="x", faculty_name_th="f", level="MASTER")
        self.assertEqual(link_rows([p], []), {})


CASES = Path(__file__).resolve().parent.parent / "fixtures" / "tcas-match-cases.json"


class DifferentialTests(unittest.TestCase):
    """Expected ids were produced by the real TS findOwnProgrammeMatch."""

    def test_reproduces_typescript(self):
        sets = json.loads(CASES.read_text(encoding="utf-8"))
        n = 0
        for s in sets:
            idx = build_tcas_match_index(
                [MatchProgramme(p["id"], p["nameTh"], p["majors"], p["facultyNameTh"]) for p in s["index"]]
            )
            for c in s["cases"]:
                got = find_own_programme_match(idx, c["faculty"], c["programme"], c["major"])
                self.assertEqual(got.id if got else None, c["expected"], (s["name"], c))
                n += 1
        self.assertGreaterEqual(n, 40)


if __name__ == "__main__":
    unittest.main()
