import unittest
from pathlib import Path

from wsmock.tcas import TcasRow, load_rows, own_rows, closest_institutions, round3_totals

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "tcas-sample.xlsx"
KMUTT = "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี"


def row(code, year=2567, quota=10, applicants=20, admitted=5):
    return TcasRow(code, KMUTT, "f", "p", None, year, "3", quota, applicants, admitted, None, None)


class TcasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = load_rows(Path("/nonexistent"), offline=True, files=[FIXTURE])

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


if __name__ == "__main__":
    unittest.main()
