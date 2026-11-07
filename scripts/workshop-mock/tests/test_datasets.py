import random
import re
import unittest
from pathlib import Path

from wsmock.courses import courses_from_csv, invented_courses, share_with_sibling
from wsmock.datasets import SHEETS, UPLOAD_ORDER, World, build_rows
from wsmock.inputs import Inputs, ProgrammeInput, resolve_anchors
from wsmock.people import make_publications, make_staff
from wsmock.slice import choose_slice
from wsmock.tcas import TcasTotals, load_rows, own_rows

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "tcas-sample.xlsx"
KMUTT = "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี"
GROUP_FLOORS = {"Sample Size", "Respondents", "Students Tested", "Students Taking"}


def make_world(seed=7, run_seed=0) -> World:
    rows = load_rows(Path("/nonexistent"), offline=True, files=[(FIXTURE, 2567, "3")])
    own = own_rows(rows, KMUTT)
    pairs = sorted({(r.faculty, r.programme) for r in own})
    fac, name = pairs[0]
    inputs = [
        ProgrammeInput(name=name, pdf=None, faculty=fac),
        ProgrammeInput(name=pairs[1][1], pdf=None, faculty=pairs[1][0]),
        ProgrammeInput(name="วิศวกรรมเครื่องกล", pdf=None, level="MASTER", faculty=fac),
    ]

    anchors = resolve_anchors(Inputs(KMUTT, "Central", inputs), own)
    s = choose_slice(anchors, own, "medium", random.Random(seed))
    # the registry rows that link to a programme usually state some pass counts;
    # force one programme to the "none stated" case that round3_totals reports as None
    victim = next(p for p in s.programmes if p.level == "BACHELOR" and not p.is_anchor)
    y0 = next(iter(victim.tcas))
    victim.tcas[y0] = TcasTotals(victim.tcas[y0].quota, victim.tcas[y0].applicants, None)
    staff, links = make_staff(s, random.Random(seed))
    pubs = make_publications(s, staff, links, random.Random(seed))
    dept = {d.code: d.name_en for d in s.departments}
    courses = {p.code: invented_courses(p, random.Random(p.code), dept[p.department_code]) for p in s.programmes}
    return World(s, staff, links, pubs, courses, "Central", run_seed)


class DatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = make_world()
        cls.rows = {slug: build_rows(slug, cls.w, random.Random(1)) for slug in UPLOAD_ORDER}

    def test_twenty_sheets(self):
        self.assertEqual(len(UPLOAD_ORDER), 20)
        self.assertEqual(set(UPLOAD_ORDER), set(SHEETS))

    def test_keys_equal_headers(self):
        for slug in UPLOAD_ORDER:
            headers = SHEETS[slug][1]
            self.assertTrue(self.rows[slug], slug)
            for r in self.rows[slug]:
                self.assertEqual(list(r.keys()), headers, slug)

    def test_deterministic(self):
        for slug in UPLOAD_ORDER:
            self.assertEqual(build_rows(slug, self.w, random.Random(5)), build_rows(slug, self.w, random.Random(9)), slug)

    def test_round3_equals_tcas(self):
        checked = 0
        for p in self.w.slice.programmes:
            if p.level != "BACHELOR" or not p.tcas:
                continue
            for y, t in p.tcas.items():
                if y not in self.w.slice.years_ce:
                    continue
                (r,) = [c for c in self.rows["admission-campaigns"] if c["Programme Code"] == p.code
                        and c["Round"] == "Round 3 — Admission" and c["Academic Year"] == y]
                self.assertEqual((r["Planned Seats"], r["Total Applicants"], r["Total Passed"]),
                                 (t.quota, t.applicants, t.admitted), (p.code, y))
                checked += 1
        self.assertGreater(checked, 3)

    def test_uncovered_years_scale_from_nearest(self):
        years = self.w.slice.years_ce
        p = next(p for p in self.w.slice.programmes if p.level == "BACHELOR" and p.tcas and p.tcas.get(2024) and p.tcas[2024].quota >= 10)
        covered = [y for y in p.tcas if y in years]
        self.assertLess(len(covered), len(years))
        for y in years:
            (r,) = [c for c in self.rows["admission-campaigns"] if c["Programme Code"] == p.code
                    and c["Round"] == "Round 3 — Admission" and c["Academic Year"] == y]
            if y in p.tcas:
                continue
            ny = min(p.tcas, key=lambda k: (abs(k - y), -k))
            n = p.tcas[ny]
            self.assertEqual(r["Planned Seats"], n.quota)
            want = n.quota * n.applicants / n.quota
            self.assertLessEqual(abs(r["Total Applicants"] - want), 0.1 * want + 1, (y, ny))

    def test_older_alumni_not_before_establishment(self):
        by = {p.code: p for p in self.w.slice.programmes}
        for r in self.rows["alumni-cohorts"]:
            self.assertGreaterEqual(r["Entry Year"], by[r["Programme Code"]].year_established)
        late = make_world()
        for p in late.slice.programmes:
            p.year_established = min(late.slice.years_ce) - 1  # only one older cohort allowed
        rows = build_rows("alumni-cohorts", late, random.Random(1))
        first = min(late.slice.years_ce)
        self.assertTrue(all(r["Entry Year"] >= first - 1 for r in rows))
        self.assertTrue(any(r["Entry Year"] == first - 1 for r in rows))

    def test_run_seed_changes_figures_but_is_stable(self):
        a = build_rows("enrollment-metrics", make_world(run_seed=1), random.Random(0))
        b = build_rows("enrollment-metrics", make_world(run_seed=1), random.Random(0))
        c = build_rows("enrollment-metrics", make_world(run_seed=2), random.Random(0))
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)

    def test_blank_pass_year_stays_blank(self):
        found = False
        for p in self.w.slice.programmes:
            for y, t in p.tcas.items():
                if t.admitted is None and y in self.w.slice.years_ce:
                    found = True
                    (r,) = [c for c in self.rows["admission-campaigns"] if c["Programme Code"] == p.code
                            and c["Round"] == "Round 3 — Admission" and c["Academic Year"] == y]
                    self.assertIsNone(r["Total Passed"])
                    self.assertIsNotNone(r["Reported"])
        self.assertTrue(found, "fixture should hold a programme with a blank pass count")

    def test_campaign_funnel_and_share(self):
        by = {}
        for r in self.rows["admission-campaigns"]:
            self.assertTrue(r["Campaign Name"].endswith(", mock"))
            self.assertLessEqual(r["Reported"], r["Confirmed"])
            if r["Total Passed"] is not None:
                self.assertLessEqual(r["Confirmed"], r["Total Passed"])
            by.setdefault((r["Programme Code"], r["Academic Year"]), []).append(r)
        lvl = {p.code: p.level for p in self.w.slice.programmes}
        for (code, y), rs in by.items():
            if lvl[code] == "BACHELOR":
                r3 = next(r for r in rs if r["Round"] == "Round 3 — Admission")
                total = sum(r["Planned Seats"] for r in rs)
                if total:
                    self.assertTrue(0.29 <= r3["Planned Seats"] / total <= 0.46, (code, y))
                self.assertEqual(len(rs), 4)
            else:
                self.assertEqual([r["Round"] for r in rs], ["Direct Admission"])

    def test_enrolment_follows_campaigns(self):
        camp = {}
        for r in self.rows["admission-campaigns"]:
            camp.setdefault((r["Programme Code"], r["Academic Year"]), []).append(r)
        for r in self.rows["enrollment-metrics"]:
            rs = camp[(r["Programme Code"], r["Academic Year"])]
            self.assertEqual(r["Enrolled"], sum(c["Reported"] for c in rs))
            self.assertLessEqual(r["Enrolled"], r["Admitted"])
            self.assertLessEqual(r["Admitted"], r["Applications"])

    def test_alumni_sum_to_enrolment(self):
        enrol = {(r["Programme Code"], r["Academic Year"]): r["Enrolled"] for r in self.rows["enrollment-metrics"]}
        sums = {}
        for r in self.rows["alumni-cohorts"]:
            k = (r["Programme Code"], r["Entry Year"])
            sums[k] = sums.get(k, 0) + r["Count"]
        hit = 0
        for k, v in sums.items():
            if k in enrol:
                hit += 1
                self.assertEqual(v, enrol[k], k)
        self.assertGreater(hit, 0)

    def test_cohort_never_exceeds_enrolment(self):
        enrol = {(r["Programme Code"], r["Academic Year"]): r for r in self.rows["enrollment-metrics"]}
        for r in self.rows["student-cohorts"]:
            self.assertLessEqual(r["Students Still Enrolled"], enrol[(r["Programme Code"], r["Entry Year"])]["Enrolled"])
        for r in enrol.values():
            parts = [r[h] or 0 for h in ("Graduated on Time", "Graduated Late", "Dropouts")]
            self.assertLessEqual(sum(parts), r["Enrolled"])
            self.assertLessEqual(r["Retained to Year 2"] or 0, r["Enrolled"])

    def test_years_are_common_era(self):
        for slug in UPLOAD_ORDER:
            for r in self.rows[slug]:
                for h, v in r.items():
                    if "Year" in h and isinstance(v, int) and h not in ("Year Established", "Curriculum Year"):
                        self.assertLess(v, 2200, (slug, h))

    def test_group_floors(self):
        for slug in UPLOAD_ORDER:
            for r in self.rows[slug]:
                for h in GROUP_FLOORS & set(r):
                    self.assertGreaterEqual(r[h], 5, (slug, h))
        for r in self.rows["employer-feedback"]:
            self.assertGreaterEqual(r["Respondents"], 8)
            self.assertRegex(r["Employer"], r"^Mock employer \d+$")
        for r in self.rows["graduate-outcomes"]:
            self.assertTrue(8 <= r["Sample Size"] <= 60)
            self.assertEqual(r["Survey Year"], r["Graduation Year"] + 1)
            for h in ("Employment Rate", "Job Relevance Score", "Further Study Rate"):
                self.assertTrue(0 <= r[h] <= 1)
        years = self.w.slice.years_ce
        self.assertNotIn(years[-1], {r["Graduation Year"] for r in self.rows["graduate-outcomes"]})

    def test_digital_competency_rules(self):
        lvl = {p.code: p.level for p in self.w.slice.programmes}
        for r in self.rows["digital-competency-cohorts"]:
            self.assertEqual(lvl[r["Programme Code"]], "BACHELOR")
            self.assertLessEqual(r["Students With Scores"], r["Students Tested"])
            self.assertLessEqual(r["Students Passing All Modules"], r["Students With Scores"])
        for r in self.rows["digital-competency-modules"]:
            self.assertEqual(lvl[r["Programme Code"]], "BACHELOR")
            self.assertLessEqual(r["Students Taking"], r["Students In Scope"])
            self.assertTrue(1 <= r["Module"] <= 13 and 0 <= r["Mean Score (0–100)"] <= 100)

    def test_course_evaluations_use_course_lists(self):
        anchor = next(p for p in self.w.slice.programmes if p.is_anchor)
        codes = {c.code for c in self.w.courses[anchor.code]}
        got = {r["Course Code"] for r in self.rows["course-evaluations"]}
        self.assertTrue(got & codes)
        every = {c.code for cs in self.w.courses.values() for c in cs}
        self.assertLessEqual(got, every)
        keys = [(r["Academic Year"], r["Semester"], re.sub(r"\s+", "", r["Course Code"]).upper(), r["Section"])
                for r in self.rows["course-evaluations"]]
        self.assertEqual(len(keys), len(set(keys)))
        for r in self.rows["course-evaluations"]:
            self.assertGreaterEqual(r["Respondents"], 8)
            self.assertTrue(3.2 <= r["Average Rating"] <= 4.7)

    def test_population_and_skills(self):
        pop = self.rows["population-projections"]
        self.assertEqual({r["Region"] for r in pop}, {"Central", "TH"})
        self.assertEqual({r["Year"] for r in pop}, set(range(self.w.slice.latest_year_ce, self.w.slice.latest_year_ce + 16)))
        self.assertEqual({r["Age Group"] for r in pop}, {"15-17", "18-22", "23-29"})
        self.assertTrue(all("Workshop mock data" in r["Source Name"] for r in pop))
        sk = self.rows["career-skill-demand"]
        groups = {r["Career Group"] for r in sk}
        self.assertEqual(len(groups), 3)
        for g in groups:
            self.assertEqual(len([r for r in sk if r["Career Group"] == g]), 8)
        self.assertEqual({(r["Scope"], r["Data Source"]) for r in sk}, {("Thailand", "Job postings")})

    def test_labels_and_ids(self):
        for r in self.rows["faculty-budgets"]:
            self.assertTrue(r["Division Name"].endswith(" (mock)"))
        for slug in UPLOAD_ORDER:
            for r in self.rows[slug]:
                for h, v in r.items():
                    if isinstance(v, int) and not isinstance(v, bool) and 10**12 <= v < 10**13:
                        self.fail(f"13-digit integer in {slug}/{h}")

    def test_programme_courses_and_staff(self):
        self.assertEqual({r["Programme Code"] for r in self.rows["programme-courses"]}, set(self.w.courses))
        self.assertEqual(len(self.rows["faculty-members"]), len(self.w.staff))
        self.assertEqual(len(self.rows["program-faculty"]), len(self.w.links))
        self.assertEqual(len(self.rows["research-outputs"]), len(self.w.publications))


if __name__ == "__main__":
    unittest.main()
