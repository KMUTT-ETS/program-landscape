"""Rows for the 20 import sheets, consistent with the public TCAS figures.

Every figure of a programme-year comes from one plan (`_plan`) that is derived from
the world alone, with string-seeded generators, so two sheets can never disagree
and the result does not depend on the `rng` handed to `build_rows`.
"""
from __future__ import annotations

import math
import random
import re
from dataclasses import dataclass

from .courses import Course, GE, FREE
from .people import Publication, RosterLink, Staff
from .slice import Programme, Slice

UPLOAD_ORDER: list[str] = [
    "faculties", "departments", "programmes", "faculty-members", "program-faculty",
    "programme-courses", "research-outputs", "admission-campaigns", "enrollment-metrics",
    "student-cohorts", "alumni-cohorts", "financial-metrics", "faculty-budgets",
    "graduate-outcomes", "employer-feedback", "digital-competency-cohorts",
    "digital-competency-modules", "course-evaluations", "population-projections",
    "career-skill-demand",
]

# Copied from the declarations in packages/db/src/import/datasets/*.ts
# (the Task 9 check is what proves them right).
SHEETS: dict[str, tuple[str, list[str]]] = {
    'faculties': (
        'Faculties',
        [
            'Faculty Code',
            'Name (Thai)',
            'Name (English)',
            'Kind',
            'Teaching Mode',
        ],
    ),
    'departments': (
        'Departments',
        [
            'Department Code',
            'Name (Thai)',
            'Name (English)',
            'Faculty Code',
        ],
    ),
    'programmes': (
        'Programmes',
        [
            'Programme Code',
            'Name (Thai)',
            'Name (English)',
            'Faculty Code',
            'Department Code',
            'Level',
            'Status',
            'Year Established',
            'Duration (years)',
            'Total Credits',
            'Official Code',
        ],
    ),
    'faculty-members': (
        'Staff',
        [
            'Employee Code',
            'Name (Thai)',
            'Name (English)',
            'Faculty Code',
            'Department Code',
            'Rank',
            'Academic Qualification',
            'Specialization',
            'Hire Date',
            'Retirement Date',
            'Active',
        ],
    ),
    'program-faculty': (
        'Programme Staff',
        [
            'Programme Code',
            'Employee Code',
            'Role',
            'Curriculum Year',
        ],
    ),
    'programme-courses': (
        'Programme Courses',
        [
            'Programme Code',
            'Course Code',
            'Course Name (Thai)',
            'Course Name (English)',
            'Credits',
            'Category',
        ],
    ),
    'research-outputs': (
        'Publications',
        [
            'Employee Code',
            'Year',
            'Type',
            'Title',
            'Venue',
            'Citations',
            'DOI',
        ],
    ),
    'admission-campaigns': (
        'Admission Campaigns',
        [
            'Programme Code',
            'Academic Year',
            'Round',
            'Campaign Name',
            'Planned Seats',
            'Total Applicants',
            'Total Passed',
            'Confirmed',
            'Reported',
        ],
    ),
    'enrollment-metrics': (
        'Enrolment',
        [
            'Programme Code',
            'Academic Year',
            'Applications',
            'Admitted',
            'Enrolled',
            'Retained to Year 2',
            'Graduated on Time',
            'Graduated Late',
            'Dropouts',
        ],
    ),
    'student-cohorts': (
        'Student Cohorts',
        [
            'Programme Code',
            'Entry Year',
            'Students Still Enrolled',
        ],
    ),
    'alumni-cohorts': (
        'Alumni Cohorts',
        [
            'Programme Code',
            'Entry Year',
            'Status',
            'Count',
        ],
    ),
    'financial-metrics': (
        'Finance',
        [
            'Programme Code',
            'Academic Year',
            'Tuition Revenue (THB)',
            'Other Revenue (THB)',
        ],
    ),
    'faculty-budgets': (
        'Budgets',
        [
            'Division Name',
            'Faculty Code',
            'Fund Category',
            'Fiscal Year',
            'Total Budget (THB)',
            'Total Commitment (THB)',
            'Total Obligation (THB)',
            'Total Expenditure (THB)',
            'Funds Available (THB)',
        ],
    ),
    'graduate-outcomes': (
        'Graduate Outcomes',
        [
            'Programme Code',
            'Graduation Year',
            'Survey Year',
            'Employment Rate',
            'Average Salary (THB/month)',
            'Job Relevance Score',
            'Further Study Rate',
            'Sample Size',
        ],
    ),
    'employer-feedback': (
        'Employer Feedback',
        [
            'Programme Code',
            'Survey Year',
            'Employer',
            'Satisfaction (0–1)',
            'Respondents',
        ],
    ),
    'digital-competency-cohorts': (
        'Digital Competency Cohorts',
        [
            'Programme Code',
            'Entry Year',
            'Students Tested',
            'Students With Scores',
            'Students Passing All Modules',
        ],
    ),
    'digital-competency-modules': (
        'Digital Competency Modules',
        [
            'Programme Code',
            'Entry Year',
            'Module',
            'Students Taking',
            'Mean Score (0–100)',
            'Students In Scope',
        ],
    ),
    'course-evaluations': (
        'Course Evaluations',
        [
            'Course Code',
            'Academic Year',
            'Semester',
            'Section',
            'Average Rating',
            'Respondents',
            'Faculty Code',
            'Course Name (Thai)',
            'Course Name (English)',
        ],
    ),
    'population-projections': (
        'Population Projections',
        [
            'Region',
            'Year',
            'Age Group',
            'Population',
            'Source Name',
        ],
    ),
    'career-skill-demand': (
        'Career Skill Demand',
        [
            'Career Group',
            'Career Sub-group',
            'Career',
            'Skill',
            'Scope',
            'Data Source',
            'Share of Postings (%)',
        ],
    ),
}


@dataclass
class World:
    slice: Slice
    staff: list[Staff]
    links: list[RosterLink]
    publications: list[Publication]
    courses: dict[str, list[Course]]
    region: str


def build_world(slice: Slice, staff: list[Staff], links: list[RosterLink],
                publications: list[Publication], courses: dict[str, list[Course]],
                region: str) -> World:
    return World(slice, staff, links, publications, courses, region)


Row = dict[str, object]
SOURCE_NAME = "Workshop mock data — not an official projection"
ROUND3 = "Round 3 — Admission"
FEE = {"BACHELOR": (40000, 60000), "MASTER": (60000, 90000),
       "DOCTORAL": (80000, 120000), "HIGHER_GRAD_DIPLOMA": (50000, 70000)}
SKILLS = [
    "Python", "Data analysis", "Project management", "Communication", "Teamwork",
    "Problem solving", "Critical thinking", "SQL", "Microsoft Excel", "Research",
    "Technical writing", "Leadership", "Time management", "Presentation skills",
    "Quality control", "Customer service", "English", "Statistics", "Machine learning",
    "Cloud computing", "Software testing", "Risk management", "Budgeting", "Negotiation",
]


def _r(*parts: object) -> random.Random:
    return random.Random("|".join(str(p) for p in parts))


def _rows(slug: str, items: list[list[object]]) -> list[Row]:
    headers = SHEETS[slug][1]
    out: list[Row] = []
    for it in items:
        assert len(it) == len(headers), (slug, len(it), len(headers))
        out.append(dict(zip(headers, it)))
    return out


# ------------------------------------------------------------------ plan

@dataclass
class _Camp:
    round: str
    seats: int
    applicants: int
    passed: int | None  # as published; None = blank cell
    notional: int       # passed, or an estimate when blank
    confirmed: int
    reported: int


def _funnel(rng: random.Random, seats: int, applicants: int, passed: int | None) -> _Camp:
    notional = passed if passed is not None else min(applicants, round(seats * rng.uniform(1.0, 1.15)))
    confirmed = round(notional * rng.uniform(0.75, 0.95))
    reported = round(confirmed * rng.uniform(0.85, 0.97))
    return _Camp("", seats, applicants, passed, notional, confirmed, reported)


def _campaigns(p: Programme, year: int, years: list[int]) -> list[_Camp]:
    rng = _r("camp", p.code, year)
    if p.level != "BACHELOR":
        seats = rng.randint(12, 30)
        c = _funnel(rng, seats, round(seats * rng.uniform(1.4, 2.5)), None)
        passed = min(c.applicants, round(seats * rng.uniform(0.85, 1.0)))
        c = _funnel(rng, seats, c.applicants, passed)
        c.round = "Direct Admission"
        return [c]
    t = p.tcas.get(year)
    if t is None:
        known = [x for y, x in sorted(p.tcas.items()) if y in years] or list(p.tcas.values())
        base = known[-1].quota if known else rng.randint(40, 90)
        q = max(10, round(base * rng.uniform(0.9, 1.1)))
        r3 = _funnel(rng, q, round(q * rng.uniform(1.5, 4.0)), min(q, round(q * rng.uniform(0.9, 1.1))))
    else:
        q = t.quota
        r3 = _funnel(rng, t.quota, t.applicants, t.admitted)
    r3.round = ROUND3
    # total seats such that round 3 is 30-45 % of them (q = 0: nothing to scale from)
    lo, hi = math.ceil(q / 0.45), math.floor(q / 0.30)
    total = rng.randint(lo, hi) if q > 0 else 0
    others = max(0, total - q)
    r1 = round(others * 0.45)
    r2 = round(others * 0.35)
    sizes = {"Round 1 — Portfolio": r1, "Round 2 — Quota": r2, "Round 4 — Direct Admission": others - r1 - r2}
    out = []
    for name, s in sizes.items():
        c = _funnel(rng, s, round(s * rng.uniform(1.5, 3.5)), min(s, round(s * rng.uniform(0.95, 1.15))))
        c.round = name
        out.append(c)
    return [out[0], out[1], r3, out[2]]


@dataclass
class _Year:
    applications: int
    admitted: int
    enrolled: int
    retained: int | None
    on_time: int | None
    late: int | None
    dropouts: int | None
    still: int


def _cohort_tail(rng: random.Random, p: Programme, y: int, last: int, enrolled: int) -> tuple:
    f = rng.uniform(0.06, 0.15)
    first = round(enrolled * f * 0.7)
    retained = enrolled - first if y + 1 <= last else None
    graduated = y + p.duration <= last
    drop = None
    if y + 1 <= last:
        span = min(1.0, (last - y) / p.duration)
        drop = max(first, round(enrolled * f * (0.7 + 0.3 * span)))
    on_time = late = None
    still = enrolled - (drop or 0)
    if graduated:
        left = enrolled - (drop or 0)
        on_time = round(left * rng.uniform(0.70, 0.85))
        late = round(left * rng.uniform(0.08, 0.15))
        still = left - on_time - late
    return retained, on_time, late, drop, still


def _plan(world: World) -> dict[tuple[str, int], _Year]:
    s = world.slice
    last = s.latest_year_ce
    out: dict[tuple[str, int], _Year] = {}
    for p in s.programmes:
        for y in s.years_ce:
            cs = _campaigns(p, y, s.years_ce)
            passed = sum(c.notional for c in cs)
            applications = max(sum(c.applicants for c in cs), passed)
            enrolled = sum(c.reported for c in cs)
            retained, on_time, late, drop, still = _cohort_tail(_r("tail", p.code, y), p, y, last, enrolled)
            out[(p.code, y)] = _Year(applications, passed, enrolled, retained, on_time, late, drop, still)
    return out


def _older_cohorts(world: World, plan: dict[tuple[str, int], _Year]) -> dict[tuple[str, int], _Year]:
    """Cohorts that entered before the slice's window; alumni and tuition read them."""
    s = world.slice
    first = min(s.years_ce)
    last = s.latest_year_ce
    out: dict[tuple[str, int], _Year] = {}
    for p in s.programmes:
        base = plan[(p.code, first)].enrolled
        for y in range(first - 4, first):
            rng = _r("old", p.code, y)
            enrolled = max(5, round(base * rng.uniform(0.9, 1.1)))
            retained, on_time, late, drop, still = _cohort_tail(_r("tail", p.code, y), p, y, last, enrolled)
            out[(p.code, y)] = _Year(enrolled, enrolled, enrolled, retained, on_time, late, drop, still)
    return out


# ------------------------------------------------------------------ builders

def _faculties(w: World) -> list[Row]:
    return _rows("faculties", [[f.code, f.name_th, f.name_en, "ACADEMIC", None] for f in w.slice.faculties])


def _departments(w: World) -> list[Row]:
    return _rows("departments", [[d.code, d.name_th, d.name_en, d.faculty_code] for d in w.slice.departments])


def _programmes(w: World) -> list[Row]:
    return _rows("programmes", [
        [p.code, p.name_th, p.name_en, p.faculty_code, p.department_code, p.level, "ACTIVE",
         p.year_established, p.duration, p.credits, None] for p in w.slice.programmes])


def _staff(w: World) -> list[Row]:
    return _rows("faculty-members", [
        [s.code, s.name_th, s.name_en, s.faculty_code, s.department_code, s.rank, s.qualification,
         s.specialization, s.hire_date, s.retirement_date, s.active] for s in w.staff])


def _program_faculty(w: World) -> list[Row]:
    return _rows("program-faculty", [[l.programme_code, l.employee_code, l.role, None] for l in w.links])


def _programme_courses(w: World) -> list[Row]:
    items = []
    for p in w.slice.programmes:
        for c in w.courses.get(p.code, []):
            items.append([p.code, c.code, c.name_th, c.name_en, c.credits, c.category])
    return _rows("programme-courses", items)


def _research(w: World) -> list[Row]:
    return _rows("research-outputs", [
        [x.employee_code, x.year, x.type, x.title, x.venue, x.citations, None] for x in w.publications])


def _campaign_rows(w: World) -> list[Row]:
    items = []
    for p in w.slice.programmes:
        for y in w.slice.years_ce:
            for c in _campaigns(p, y, w.slice.years_ce):
                items.append([p.code, y, c.round, f"{p.name_en}, mock", c.seats, c.applicants,
                              c.passed, c.confirmed, c.reported])
    return _rows("admission-campaigns", items)


def _enrolment(w: World) -> list[Row]:
    plan = _plan(w)
    return _rows("enrollment-metrics", [
        [p.code, y, v.applications, v.admitted, v.enrolled, v.retained, v.on_time, v.late, v.dropouts]
        for p in w.slice.programmes for y in w.slice.years_ce for v in [plan[(p.code, y)]]])


def _student_cohorts(w: World) -> list[Row]:
    plan = _plan(w)
    return _rows("student-cohorts", [
        [p.code, y, plan[(p.code, y)].still] for p in w.slice.programmes for y in w.slice.years_ce])


def _alumni(w: World) -> list[Row]:
    plan = _plan(w)
    cohorts = {**_older_cohorts(w, plan), **plan}
    last = w.slice.latest_year_ce
    items = []
    for p in w.slice.programmes:
        for (code, y), v in sorted(cohorts.items(), key=lambda kv: kv[0][1]):
            if code != p.code or y + p.duration > last:
                continue
            rng = _r("alumni", p.code, y)
            drop = v.dropouts or 0
            fin = round(drop * rng.uniform(0.25, 0.35))
            acad = round(drop * rng.uniform(0.2, 0.3))
            vol = round(drop * rng.uniform(0.2, 0.25))
            transferred = min(drop - fin - acad - vol, round(drop * 0.1))
            other = drop - fin - acad - vol - transferred
            graduated = (v.on_time or 0) + (v.late or 0)
            no_report = v.enrolled - graduated - drop
            counts = [("GRADUATED", graduated), ("DROPPED_FINANCIAL", fin), ("DROPPED_ACADEMIC", acad),
                      ("DROPPED_VOLUNTARY", vol), ("TRANSFERRED", transferred), ("OTHER", other),
                      ("NO_REPORT", no_report)]
            assert sum(n for _, n in counts) == v.enrolled
            items += [[p.code, y, s, n] for s, n in counts if n > 0]
    return _rows("alumni-cohorts", items)


def _students_in_year(w: World, p: Programme, y: int, plan, older) -> float:
    total = 0.0
    for k in range(p.duration):
        v = plan.get((p.code, y - k)) or older.get((p.code, y - k))
        base = v.enrolled if v else plan[(p.code, min(w.slice.years_ce))].enrolled
        total += base * (0.93 ** k)
    return total


def _finance(w: World) -> list[Row]:
    plan = _plan(w)
    older = _older_cohorts(w, plan)
    items = []
    for p in w.slice.programmes:
        lo, hi = FEE[p.level]
        fee = _r("fee", p.code).randint(lo // 1000, hi // 1000) * 1000
        for i, y in enumerate(w.slice.years_ce):
            tuition = round(_students_in_year(w, p, y, plan, older) * fee * (1.02 ** i))
            items.append([p.code, y, tuition, round(tuition * 0.08)])
    return _rows("financial-metrics", items)


def _budgets(w: World) -> list[Row]:
    fin = {(r["Programme Code"], r["Academic Year"]): r["Tuition Revenue (THB)"] for r in _finance(w)}
    fac_of = {p.code: p.faculty_code for p in w.slice.programmes}
    items = []
    for f in w.slice.faculties:
        for y in w.slice.years_ce:
            tuition = sum(v for (c, yy), v in fin.items() if yy == y and fac_of[c] == f.code)
            rng = _r("budget", f.code, y)
            for fund, mult in (("University revenue (mock)", 1.0), ("Government subsidy (mock)", 1.6)):
                total = round((20_000_000 + tuition * rng.uniform(2.0, 3.0)) * mult, -3)
                commit, oblig = round(total * 0.05, -3), round(total * 0.05, -3)
                spent = round(total * (0.5 if y == w.slice.latest_year_ce else 0.85), -3)
                items.append([f"{f.name_en} (mock)", f.code, fund, y, total, commit, oblig, spent,
                              total - commit - oblig - spent])
    return _rows("faculty-budgets", items)


def _outcomes(w: World) -> list[Row]:
    items = []
    for p in w.slice.programmes:
        for g in w.slice.years_ce[:-1]:
            rng = _r("outcome", p.code, g)
            post = p.level != "BACHELOR"
            salary = rng.randint(30, 50) if post else rng.randint(18, 30)
            items.append([p.code, g, g + 1, round(rng.uniform(0.78, 0.96), 2), salary * 1000,
                          round(rng.uniform(0.60, 0.90), 2),
                          round(rng.uniform(0.02, 0.10) if post else rng.uniform(0.05, 0.30), 2),
                          rng.randint(8, 60)])
    return _rows("graduate-outcomes", items)


def _employers(w: World) -> list[Row]:
    last = w.slice.latest_year_ce
    items = []
    for p in w.slice.programmes:
        for y in (last - 1, last):
            for n in (1, 2, 3):
                rng = _r("employer", p.code, y, n)
                items.append([p.code, y, f"Mock employer {n}", round(rng.uniform(0.70, 0.95), 2),
                              rng.randint(8, 30)])
    return _rows("employer-feedback", items)


def _bachelors(w: World) -> list[Programme]:
    return [p for p in w.slice.programmes if p.level == "BACHELOR"]


def _dq_cohorts(w: World) -> list[Row]:
    plan = _plan(w)
    items = []
    for p in _bachelors(w):
        for y in w.slice.years_ce:
            rng = _r("dq", p.code, y)
            tested = max(8, round(plan[(p.code, y)].enrolled * rng.uniform(0.70, 0.95)))
            scored = round(tested * rng.uniform(0.85, 0.98))
            items.append([p.code, y, tested, scored, round(scored * rng.uniform(0.5, 0.8))])
    return _rows("digital-competency-cohorts", items)


def _dq_modules(w: World) -> list[Row]:
    cohorts = {(r["Programme Code"], r["Entry Year"]): r for r in _dq_cohorts(w)}
    items = []
    for (code, y), c in cohorts.items():
        for m in range(1, 14):
            rng = _r("dqm", code, y, m)
            taken = max(5, round(c["Students With Scores"] * rng.uniform(0.85, 1.0)))
            items.append([code, y, m, taken, round(rng.uniform(55, 85), 1), c["Students Tested"]])
    return _rows("digital-competency-modules", items)


def _evaluations(w: World) -> list[Row]:
    last = w.slice.latest_year_ce
    fac_of = {p.code: p.faculty_code for p in w.slice.programmes}
    seen: set[tuple[int, int, str]] = set()
    items = []
    for p in w.slice.programmes:
        for c in w.courses.get(p.code, []):
            if c.category in (GE, FREE):
                continue
            code_key = re.sub(r"\s+", "", c.code).upper()
            rng = _r("eval", p.code, c.code)
            sems = rng.choice([(1,), (2,), (1, 2)])
            for y in (last - 1, last):
                for sem in sems:
                    if (y, sem, code_key) in seen:
                        continue
                    seen.add((y, sem, code_key))
                    r2 = _r("evalrow", c.code, y, sem)
                    items.append([c.code, y, sem, 1, round(r2.uniform(3.2, 4.7), 2), r2.randint(8, 60),
                                  fac_of[p.code], c.name_th, c.name_en])
    return _rows("course-evaluations", items)


def _population(w: World) -> list[Row]:
    rng = _r("pop", w.region)
    share = rng.uniform(0.12, 0.30)
    base = {"15-17": 2_900_000, "18-22": 4_600_000, "23-29": 6_300_000}
    decay = {"15-17": 0.985, "18-22": 0.985, "23-29": 0.992}
    items = []
    for region, k in ((w.region, share), ("TH", 1.0)):
        for i in range(16):
            for age in base:
                items.append([region, w.slice.latest_year_ce + i, age,
                              round(base[age] * k * decay[age] ** i), SOURCE_NAME])
    return _rows("population-projections", items)


def _fields(w: World) -> list[str]:
    dept = {d.code: d.name_en for d in w.slice.departments}
    fields: list[str] = []
    ordered = sorted(w.slice.programmes, key=lambda p: not p.is_anchor)
    for p in ordered:
        f = re.sub(r"^Department of ", "", dept.get(p.department_code, p.name_en))
        if f not in fields:
            fields.append(f)
        if len(fields) == 3:
            break
    for extra in ("Business", "Technology", "Science"):
        if len(fields) < 3 and extra not in fields:
            fields.append(extra)
    return fields


def _skills(w: World) -> list[Row]:
    items = []
    for f in _fields(w):
        rng = _r("skills", f)
        for s in rng.sample(SKILLS, 8):
            items.append([f"{f} careers (mock)", None, f"{f} professional (mock)", s, "Thailand",
                          "Job postings", round(rng.uniform(5, 45), 1)])
    return _rows("career-skill-demand", items)


_BUILDERS = {
    "faculties": _faculties, "departments": _departments, "programmes": _programmes,
    "faculty-members": _staff, "program-faculty": _program_faculty,
    "programme-courses": _programme_courses, "research-outputs": _research,
    "admission-campaigns": _campaign_rows, "enrollment-metrics": _enrolment,
    "student-cohorts": _student_cohorts, "alumni-cohorts": _alumni, "financial-metrics": _finance,
    "faculty-budgets": _budgets, "graduate-outcomes": _outcomes, "employer-feedback": _employers,
    "digital-competency-cohorts": _dq_cohorts, "digital-competency-modules": _dq_modules,
    "course-evaluations": _evaluations, "population-projections": _population,
    "career-skill-demand": _skills,
}


def build_rows(slug: str, world: World, rng: random.Random) -> list[Row]:
    """Rows keyed by header text; None is a blank cell. `rng` is accepted for the
    interface but unused: every figure derives from the world, so sheets agree."""
    return _BUILDERS[slug](world)
