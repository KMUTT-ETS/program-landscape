"""Choose the faculties, departments and programmes of the mock dataset."""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from types import SimpleNamespace
from pathlib import Path

from .inputs import Anchor
from .tcas import TcasRow, TcasTotals, round3_totals
from .thai_en import faculty_en, translate
from .tcas_match import extract_specialization, link_rows

SIZES = {"small": (3, 8), "medium": (5, 15)}  # (faculties, programmes)

DEGREE_EN = {
    "BACHELOR": "Bachelor of",
    "MASTER": "Master of",
    "DOCTORAL": "Doctor of Philosophy in",
    "HIGHER_GRAD_DIPLOMA": "Graduate Diploma in",
}
PLACEHOLDER_EN = {
    "BACHELOR": "Bachelor's programme",
    "MASTER": "Master's programme",
    "DOCTORAL": "Doctoral programme",
    "HIGHER_GRAD_DIPLOMA": "Graduate diploma programme",
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
    # One line per English-name placeholder: which Thai name had no English
    # equivalent and how to fix it.
    notes: list[str] = field(default_factory=list)


_META_PAREN = ("หลักสูตร", "นานาชาติ", "ภาษาอังกฤษ", "แผน", "ต่อเนื่อง", "สหกิจ")
_DEGREE_WORD = re.compile(r"บัณฑิต$")
_TAIL = re.compile(r"\s*(ปริญญา.*|\d+\s*ปี)$")


def _spec(name: str) -> str:
    """The field of a programme name, used as the department. Never just a degree name."""
    base = name.replace("(แผน ข)", "").strip()
    spec = extract_specialization(base)
    if spec:
        return spec
    inner = [m.strip() for m in re.findall(r"\(([^)]+)\)", base)]
    inner = [m for m in inner if m and not any(k in m for k in _META_PAREN)]
    if inner:
        return inner[0]
    rest = re.sub(r"\([^)]*\)", " ", base)
    rest = re.sub(r"^หลักสูตร", "", rest.strip())
    rest = _TAIL.sub("", rest.strip())
    tokens = rest.split()
    fields = [t for t in tokens if not _DEGREE_WORD.search(t)]
    if not fields and tokens:  # only a degree name, e.g. "พยาบาลศาสตรบัณฑิต"
        d = _DEGREE_WORD.sub("", tokens[0])
        fields = [d + "์" if d.endswith("ศาสตร") else d]
    dedup: list[str] = []
    for t in fields:
        if not dedup or dedup[-1] != t:
            dedup.append(t)
    return " ".join(dedup) or base


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


def _translatable(faculty: str, programme: str) -> bool:
    return faculty_en(faculty) is not None and translate(_spec(programme)) is not None


def choose_slice(anchors: list[Anchor], own: list[TcasRow], size: str, rng: random.Random) -> Slice:
    """Pick faculties, departments and programmes around the anchors.

    SIZES caps only the filler: every anchor, its faculty and its sibling are
    always included, so many anchors can push the slice past SIZES.
    """
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
            pool = [t for t in pool if _translatable(*t)] or pool
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
        pool = [p for p in pool if _translatable(f, p)] or pool
        p = rng.choice(pool)
        used.add((f, p))
        drafts.append(_Draft(f, p, "BACHELOR"))
        return True

    while len(drafts) < n_prog:
        if len(faculties) < n_fac:
            cands = sorted(f for f in avail if f not in faculties and free(f))
            cands = [f for f in cands if faculty_en(f) is not None and any(_translatable(f, p) for p in free(f))] or cands
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
    notes: list[str] = []
    fac_en: dict[str, str] = {}
    for n in fac_names:
        en = faculty_en(n)
        if en is None:
            en = f"Faculty {fac_code[n][-3:]}"
            notes.append(
                f"No English name for faculty '{n}'; wrote '{en}'. Fix: the glossary has no equivalent, "
                "so edit the English faculty name in the generated sheet."
            )
        fac_en[n] = en
    dep_en: dict[str, str] = {}
    for (fc, spec), code in dep_code.items():
        t = translate(spec)
        if t is None:
            dep_en[code] = f"Department {code[len('MOCK-'):]}"
            notes.append(
                f"No English name for department '{spec}'; wrote '{dep_en[code]}'. Fix: edit the English "
                "department name in the generated sheet (it is derived from the programme name)."
            )
        else:
            dep_en[code] = f"Department of {t}"
    programmes: list[Programme] = []
    en_cache: dict[tuple[str, str], str] = {}
    for d in ordered:
        spec = spec_of[(d.faculty, d.name_th)]
        fc = fac_code[d.faculty]
        inp = d.anchor.input if d.anchor else None
        code = prog_code[(d.faculty, d.name_th)]
        if inp and inp.name_en:
            name_en = inp.name_en
        else:
            t = translate(spec)
            if t is None:
                name_en = f"{PLACEHOLDER_EN[d.level]} {code[len('MOCK-'):]}"
                notes.append(
                    f"No English name for programme '{d.name_th}'; wrote '{name_en}'. Fix: edit the "
                    "programme's TCAS sheet name, or add `name_en = \"...\"` to its [[programme]] block "
                    "in the input file."
                )
            else:
                name_en = f"{DEGREE_EN[d.level]} {t}"
        if d.sibling_of and d.level != "BACHELOR":
            base = en_cache.get(d.sibling_of)
            if base is not None:
                name_en = f"{base} (Plan B)"
        en_cache[(d.faculty, d.name_th)] = name_en
        programmes.append(
            Programme(
                code=code,
                name_th=d.name_th,
                name_en=name_en,
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
        SimpleNamespace(code=p.code, name_th=p.name_th, level=p.level,
                        faculty_name_th=fac_name_of[p.faculty_code])
        for p in programmes
    ]
    linked = link_rows(view, own)
    for p in programmes:
        if p.level == "BACHELOR":
            p.tcas = {y - 543: t for y, t in round3_totals(linked.get(p.code, [])).items()}

    departments = [
        Department(code=code, name_th=f"สาขาวิชา{spec}", name_en=dep_en[code], faculty_code=fc)
        for (fc, spec), code in sorted(dep_code.items(), key=lambda kv: kv[1])
    ]
    return Slice(
        faculties=[Faculty(fac_code[n], n, fac_en[n]) for n in fac_names],
        departments=departments,
        programmes=programmes,
        latest_year_ce=latest_ce,
        years_ce=list(range(latest_ce - 4, latest_ce + 1)),
        notes=notes,
    )


def _enumerate_by_faculty(keys: list[tuple[str, str]]):
    """Yield (key, n) with n restarting at 1 for each faculty."""
    counts: dict[str, int] = {}
    for k in keys:
        counts[k[0]] = counts.get(k[0], 0) + 1
        yield k, counts[k[0]]
