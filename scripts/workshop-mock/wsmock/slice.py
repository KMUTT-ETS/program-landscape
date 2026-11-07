"""Choose the faculties, departments and programmes of the mock dataset."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from pathlib import Path

from .inputs import Anchor
from .tcas import TcasRow, TcasTotals, round3_totals
from .tcas_match import extract_specialization, link_rows

SIZES = {"small": (3, 8), "medium": (5, 15)}  # (faculties, programmes)

FIELD_EN = {
    "วิศวกรรมคอมพิวเตอร์": "Computer Engineering",
    "วิศวกรรมเครื่องกล": "Mechanical Engineering",
    "วิศวกรรมไฟฟ้า": "Electrical Engineering",
    "วิศวกรรมโยธา": "Civil Engineering",
    "วิศวกรรมเคมี": "Chemical Engineering",
    "วิศวกรรมอุตสาหการ": "Industrial Engineering",
    "วิทยาการคอมพิวเตอร์": "Computer Science",
    "เทคโนโลยีสารสนเทศ": "Information Technology",
    "คณิตศาสตร์": "Mathematics",
    "ฟิสิกส์": "Physics",
    "เคมี": "Chemistry",
    "ชีววิทยา": "Biology",
    "สถิติ": "Statistics",
    "การบัญชี": "Accounting",
    "การตลาด": "Marketing",
    "บริหารธุรกิจ": "Business Administration",
    "นิติศาสตร์": "Law",
    "พยาบาลศาสตร์": "Nursing",
    "สถาปัตยกรรม": "Architecture",
    "เศรษฐศาสตร์": "Economics",
}
FACULTY_EN = {
    "วิศวกรรมศาสตร์": "Engineering",
    "วิทยาศาสตร์": "Science",
    "บริหารธุรกิจ": "Business Administration",
    "นิติศาสตร์": "Law",
    "พยาบาลศาสตร์": "Nursing",
    "สถาปัตยกรรมศาสตร์": "Architecture",
    "เศรษฐศาสตร์": "Economics",
    "ครุศาสตร์": "Education",
    "แพทยศาสตร์": "Medicine",
}
DEGREE_EN = {
    "BACHELOR": "Bachelor of",
    "MASTER": "Master of",
    "DOCTORAL": "Doctor of Philosophy in",
    "HIGHER_GRAD_DIPLOMA": "Graduate Diploma in",
}
DURATION = {"BACHELOR": 4, "MASTER": 2, "DOCTORAL": 3, "HIGHER_GRAD_DIPLOMA": 1}
CREDITS = {"MASTER": 36, "DOCTORAL": 48, "HIGHER_GRAD_DIPLOMA": 24}


@dataclass
class Faculty:
    code: str
    name_th: str
    name_en: str


@dataclass
class Department:
    code: str
    name_th: str
    name_en: str
    faculty_code: str


@dataclass
class Programme:
    code: str
    name_th: str
    name_en: str
    faculty_code: str
    department_code: str
    level: str
    duration: int
    credits: int
    year_established: int
    tcas: dict[int, TcasTotals] = field(default_factory=dict)  # keyed by CE year (BE - 543)
    is_anchor: bool = False
    pdf: Path | None = None
    courses_csv: Path | None = None
    sibling_of: str | None = None


@dataclass
class Slice:
    faculties: list[Faculty]
    departments: list[Department]
    programmes: list[Programme]
    latest_year_ce: int
    years_ce: list[int]


def _spec(name: str) -> str:
    base = name.replace("(แผน ข)", "").strip()
    return extract_specialization(base) or base


def _faculty_en(name_th: str) -> str:
    core = name_th[len("คณะ"):] if name_th.startswith("คณะ") else name_th
    return "Faculty of " + FACULTY_EN.get(core.strip(), core.strip())


def _dept_en(spec: str) -> str:
    en = FIELD_EN.get(spec)
    return f"Department of {en}" if en else f"Department of {spec}"


def _pairs(own: list[TcasRow]) -> dict[str, list[str]]:
    """faculty -> sorted programme names of the latest entry year."""
    year = max(r.entry_year_be for r in own)
    acc: dict[str, set[str]] = {}
    for r in own:
        if r.entry_year_be == year:
            acc.setdefault(r.faculty, set()).add(r.programme)
    return {f: sorted(ps) for f, ps in acc.items()}


@dataclass
class _Draft:
    faculty: str
    name_th: str
    level: str
    anchor: Anchor | None = None
    sibling_of: tuple[str, str] | None = None  # (faculty, name) of the anchor draft


def choose_slice(anchors: list[Anchor], own: list[TcasRow], size: str, rng: random.Random) -> Slice:
    n_fac, n_prog = SIZES[size]
    avail = _pairs(own)
    drafts: list[_Draft] = []
    used: set[tuple[str, str]] = set()

    for a in anchors:
        drafts.append(_Draft(a.faculty_th, a.programme_th, a.input.level, anchor=a))
        used.add((a.faculty_th, a.programme_th))

    def free(f: str) -> list[str]:
        return [p for p in avail.get(f, []) if (f, p) not in used]

    for a in anchors:
        if a.input.level == "BACHELOR":
            pool = [(a.faculty_th, p) for p in free(a.faculty_th)]
            if not pool:
                pool = [(f, p) for f in sorted(avail) for p in free(f)]
            if not pool:
                continue
            f, p = rng.choice(pool)
            used.add((f, p))
            drafts.append(_Draft(f, p, "BACHELOR", sibling_of=(a.faculty_th, a.programme_th)))
        else:
            name = f"{a.programme_th} (แผน ข)"
            used.add((a.faculty_th, name))
            drafts.append(_Draft(a.faculty_th, name, a.input.level, sibling_of=(a.faculty_th, a.programme_th)))

    faculties = {d.faculty for d in drafts}

    def add_other(f: str) -> bool:
        pool = free(f)
        if not pool:
            return False
        p = rng.choice(pool)
        used.add((f, p))
        drafts.append(_Draft(f, p, "BACHELOR"))
        return True

    while len(drafts) < n_prog:
        if len(faculties) < n_fac:
            cands = sorted(f for f in avail if f not in faculties and free(f))
            multi = [f for f in cands if len(avail[f]) >= 2]
            pick = multi or cands
            if pick:
                f = rng.choice(pick)
                faculties.add(f)
                add_other(f)
                continue
        pool = [f for f in sorted(faculties) if free(f)]
        if not pool:
            break
        add_other(rng.choice(pool))

    # ---- codes, in sort order
    fac_names = sorted(faculties)
    fac_code = {n: f"MOCK-F{i:02d}" for i, n in enumerate(fac_names, 1)}
    spec_of = {}
    for d in drafts:
        if d.sibling_of and d.level != "BACHELOR":
            spec_of[(d.faculty, d.name_th)] = _spec(d.sibling_of[1])
        else:
            spec_of[(d.faculty, d.name_th)] = _spec(d.name_th)
    dep_keys = sorted({(fac_code[d.faculty], spec_of[(d.faculty, d.name_th)]) for d in drafts})
    dep_code = {k: f"{k[0]}-D{i:02d}" for k, i in _enumerate_by_faculty(dep_keys)}
    ordered = sorted(
        drafts,
        key=lambda d: (fac_code[d.faculty], dep_code[(fac_code[d.faculty], spec_of[(d.faculty, d.name_th)])], d.name_th),
    )
    prog_code = {(d.faculty, d.name_th): f"MOCK-P{i:03d}" for i, d in enumerate(ordered, 1)}

    latest_be = max(r.entry_year_be for r in own)
    latest_ce = latest_be - 543
    programmes: list[Programme] = []
    for d in ordered:
        spec = spec_of[(d.faculty, d.name_th)]
        fc = fac_code[d.faculty]
        inp = d.anchor.input if d.anchor else None
        en_field = FIELD_EN.get(spec, spec)
        programmes.append(
            Programme(
                code=prog_code[(d.faculty, d.name_th)],
                name_th=d.name_th,
                name_en=f"{DEGREE_EN[d.level]} {en_field}" + (" (Plan B)" if d.name_th.endswith("(แผน ข)") else ""),
                faculty_code=fc,
                department_code=dep_code[(fc, spec)],
                level=d.level,
                duration=DURATION[d.level],
                credits=rng.choice([124, 128, 132, 136]) if d.level == "BACHELOR" else CREDITS[d.level],
                year_established=rng.randint(1990, 2018),
                is_anchor=d.anchor is not None,
                pdf=inp.pdf if inp else None,
                courses_csv=inp.courses if inp else None,
                sibling_of=prog_code[d.sibling_of] if d.sibling_of else None,
            )
        )

    # TCAS figures: exactly what the app's `tcas` connector will link
    fac_name_of = {v: k for k, v in fac_code.items()}
    view = [
        type("P", (), {"code": p.code, "name_th": p.name_th, "level": p.level,
                       "faculty_name_th": fac_name_of[p.faculty_code]})
        for p in programmes
    ]
    linked = link_rows(view, own)
    for p in programmes:
        if p.level == "BACHELOR":
            p.tcas = {y - 543: t for y, t in round3_totals(linked.get(p.code, [])).items()}

    departments = [
        Department(code=code, name_th=f"สาขาวิชา{spec}", name_en=_dept_en(spec), faculty_code=fc)
        for (fc, spec), code in sorted(dep_code.items(), key=lambda kv: kv[1])
    ]
    return Slice(
        faculties=[Faculty(fac_code[n], n, _faculty_en(n)) for n in fac_names],
        departments=departments,
        programmes=programmes,
        latest_year_ce=latest_ce,
        years_ce=list(range(latest_ce - 4, latest_ce + 1)),
    )


def _enumerate_by_faculty(keys: list[tuple[str, str]]):
    """Yield (key, n) with n restarting at 1 for each faculty."""
    counts: dict[str, int] = {}
    for k in keys:
        counts[k[0]] = counts.get(k[0], 0) + 1
        yield k, counts[k[0]]
