import random
import re
import unittest
from datetime import date

from wsmock.people import make_publications, make_staff
from wsmock.slice import Department, Faculty, Programme, Slice


def make_slice():
    progs = []
    for i, anchor in enumerate([True, False, False], start=1):
        progs.append(Programme(
            code=f"MOCK-P{i:03d}", name_th="x", name_en=f"Computer Engineering {i}",
            faculty_code="MOCK-F01", department_code="MOCK-F01-D01", level="BACHELOR",
            duration=4, credits=128, year_established=2000, is_anchor=anchor))
    return Slice(
        faculties=[Faculty("MOCK-F01", "x", "Faculty of Engineering")],
        departments=[Department("MOCK-F01-D01", "x", "Computer Engineering", "MOCK-F01")],
        programmes=progs, latest_year_ce=2025, years_ce=[2021, 2022, 2023, 2024, 2025])


class PeopleTests(unittest.TestCase):
    def setUp(self):
        self.s = make_slice()
        self.staff, self.links = make_staff(self.s, random.Random(1))
        self.pubs = make_publications(self.s, self.staff, self.links, random.Random(2))

    def test_tokens_only(self):
        for st in self.staff:
            self.assertTrue(st.code.startswith("MOCK-"))
            self.assertRegex(st.name_en, r"^Lecturer \d{3}$")
            self.assertRegex(st.name_th, r"^อาจารย์ \d{3}$")
            self.assertTrue(st.active)
        self.assertEqual(len({s.code for s in self.staff}), len(self.staff))

    def test_dates_and_ranks(self):
        for st in self.staff:
            self.assertGreater(st.retirement_date, date(2027, 12, 31))
            self.assertLess(st.hire_date, date(self.s.years_ce[0], 1, 1))
            self.assertIn(st.rank, {"LECTURER", "ASST_PROF", "ASSOC_PROF", "PROF"})

    def test_roster_shape(self):
        for p in self.s.programmes:
            ls = [l for l in self.links if l.programme_code == p.code]
            self.assertEqual(len(ls), 7)
            self.assertEqual(sum(l.role == "COORDINATOR" for l in ls), 1)
            self.assertEqual(sum(l.role == "CORE" for l in ls), 4)
            self.assertEqual(sum(l.role == "SUPPORT" for l in ls), 2)

    def test_anchor_papers(self):
        anchor = self.s.programmes[0]
        members = {l.employee_code for l in self.links if l.programme_code == anchor.code}
        titles = {p.title.lower().strip() for p in self.pubs
                  if p.employee_code in members and p.year > self.s.latest_year_ce - 10}
        self.assertGreaterEqual(len(titles), 15)

    def test_other_papers_and_fields(self):
        for p in self.s.programmes[1:]:
            members = {l.employee_code for l in self.links if l.programme_code == p.code}
            n = len({x.title for x in self.pubs if x.employee_code in members})
            self.assertTrue(3 <= n <= 8, n)
        for pub in self.pubs:
            self.assertLessEqual(pub.year, 2025)
            self.assertGreaterEqual(pub.year, date.today().year - 10)
            self.assertIn(pub.type, {"JOURNAL", "CONFERENCE", "PATENT", "BOOK"})
            self.assertIn("Mock", pub.venue)
            self.assertNotIn("doi", pub.title.lower())
            self.assertGreaterEqual(pub.citations, 0)


if __name__ == "__main__":
    unittest.main()
