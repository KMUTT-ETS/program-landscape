"""Invent staff (numbered tokens, never names), programme rosters and publications."""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date

from .slice import Slice

RETIRE_AFTER = date(2027, 12, 31)
RANKS = ["LECTURER"] * 40 + ["ASST_PROF"] * 35 + ["ASSOC_PROF"] * 20 + ["PROF"] * 5
QUAL = {"LECTURER": "Mock PhD", "ASST_PROF": "Mock PhD", "ASSOC_PROF": "Mock PhD", "PROF": "Mock PhD"}
ROLES = ["COORDINATOR"] + ["CORE"] * 4 + ["SUPPORT"] * 2
TYPES = ["JOURNAL"] * 6 + ["CONFERENCE"] * 3 + ["BOOK", "PATENT"]
TEMPLATES = [
    "A survey of recent methods in {f}", "Case study: applying {f} in practice",
    "Improving accuracy in {f} with data-driven models", "Challenges and opportunities in {f}",
    "A comparative evaluation of approaches to {f}", "Teaching and learning in {f}",
    "Sustainable practice in {f}", "Measuring quality in {f}",
    "Towards a framework for {f}", "Industry perspectives on {f}",
    "Experimental study in {f}", "Modelling and simulation for {f}",
    "Ethics and policy in {f}", "Low-cost solutions for {f}",
    "Field trial results in {f}", "Emerging trends in {f}",
]
VENUE = {"JOURNAL": "Mock Journal of {f}", "CONFERENCE": "Mock International Conference on {f}",
         "BOOK": "Mock Press ({f})", "PATENT": "Mock Patent Office ({f})"}


@dataclass
class Staff:
    code: str
    name_th: str
    name_en: str
    faculty_code: str
    department_code: str
    rank: str
    qualification: str
    specialization: str
    hire_date: date
    retirement_date: date
    active: bool


@dataclass
class RosterLink:
    programme_code: str
    employee_code: str
    role: str


@dataclass
class Publication:
    employee_code: str
    year: int
    type: str
    title: str
    venue: str
    citations: int


def make_staff(slice: Slice, rng: random.Random) -> tuple[list[Staff], list[RosterLink]]:
    first_year = min(slice.years_ce)
    dept_en = {d.code: d.name_en for d in slice.departments}
    staff: list[Staff] = []
    links: list[RosterLink] = []
    n = 0
    for p in slice.programmes:
        field = dept_en.get(p.department_code) or p.name_en
        for role in ROLES:
            n += 1
            rank = rng.choice(RANKS)
            staff.append(Staff(
                code=f"MOCK-E{n:04d}", name_th=f"อาจารย์ {n:03d}", name_en=f"Lecturer {n:03d}",
                faculty_code=p.faculty_code, department_code=p.department_code, rank=rank,
                qualification=QUAL[rank], specialization=field,
                hire_date=date(rng.randint(first_year - 25, first_year - 2), rng.randint(1, 12), 1),
                retirement_date=date(rng.randint(2030, 2055), 9, 30), active=True))
            links.append(RosterLink(p.code, staff[-1].code, role))
    return staff, links


def make_publications(slice: Slice, staff: list[Staff], links: list[RosterLink],
                      rng: random.Random) -> list[Publication]:
    """The app counts distinct lower-cased titles (no DOI) credited to roster
    members with year >= current year - 10 (real clock), so every anchor roster
    gets >= 15 unique titles inside the last 10 years of the slice, clamped to that."""
    lo = max(slice.latest_year_ce - 9, date.today().year - 10)
    years = list(range(lo, slice.latest_year_ce + 1))
    pubs: list[Publication] = []
    seen: set[str] = set()
    for p in slice.programmes:
        members = [l.employee_code for l in links if l.programme_code == p.code]
        field = p.name_en
        count = rng.randint(16, 20) if p.is_anchor else rng.randint(3, 8)
        templates = rng.sample(TEMPLATES, len(TEMPLATES))
        for i in range(count):
            title = templates[i % len(templates)].format(f=field)
            if i >= len(templates):
                title += f" (part {i // len(templates) + 1})"
            if title.lower() in seen:
                title += f" ({p.code})"
            seen.add(title.lower())
            typ = rng.choice(TYPES)
            year = years[i % len(years)] if p.is_anchor else rng.choice(years)
            for author in rng.sample(members, rng.randint(1, 2)):
                pubs.append(Publication(author, year, typ, title,
                                        VENUE[typ].format(f=field), rng.randint(0, 60)))
    return pubs
