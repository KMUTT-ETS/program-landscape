"""Own-programme matcher for TCAS rows.

Faithful Python port of packages/shared/src/ingestion/tcas-match.ts, which is
the source of truth: keep strategy order, regexes and first-candidate
semantics identical. `link_rows` predicts what the app's `tcas` connector
links to each programme after an upload.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .tcas import TcasRow

# Separates faculty and programme in the index keys (same as the TS KEY_SEP).
KEY_SEP = "\u0001"

# JS `.` does not match these four line terminators; Python's only excludes \n.
_D = r"[^\n\r  ]"
_DEGREES = r"วศ\.บ\.|วท\.บ\.|ค\.อ\.บ\.|ทล\.บ\.|ศป\.บ\.|บธ\.บ\."

_SAKHA = re.compile(rf"สาขา(?:วิชา)?({_D}+)")
_TRAIL_DASH = re.compile(rf"\s*[-–]\s*(?:{_DEGREES}|วิชาเอก){_D}*\Z")
_TRAIL_PARINYA = re.compile(rf"\s*ปริญญา{_D}*\Z")
_TRAIL_PAREN = re.compile(rf"\s*\(หลักสูตร{_D}*\Z")
_DASH = re.compile(rf"^({_D}+?)\s*[-–]\s*(?:{_DEGREES})")
_PAREN_DASH = re.compile(rf"^({_D}+?)\s*\(หลักสูตร[^)]+\)\s*[-–]")
_PAREN = re.compile(r"\(([^)]+)\)")
_PREFIX = re.compile(r"^หลักสูตร[^ ]*บัณฑิต\s*")


@dataclass
class MatchProgramme:
    id: str
    name_th: str
    majors: list[str]
    faculty_name_th: str


@dataclass
class TcasMatchIndex:
    by_faculty_programme: dict[str, list[MatchProgramme]] = field(default_factory=dict)
    by_faculty_spec: dict[str, list[MatchProgramme]] = field(default_factory=dict)


def extract_specialization(name: str) -> str:
    n = name.strip()
    m = _SAKHA.search(n)
    if m:
        spec = m.group(1).strip()
        spec = _TRAIL_DASH.sub("", spec).strip()
        spec = _TRAIL_PARINYA.sub("", spec).strip()
        spec = _TRAIL_PAREN.sub("", spec).strip()
        if spec:
            return spec
    m = _DASH.match(n)
    if m:
        spec = _TRAIL_PAREN.sub("", m.group(1).strip()).strip()
        if spec:
            return spec
    m = _PAREN_DASH.match(n)
    if m:
        return m.group(1).strip()
    return ""


def build_tcas_match_index(programmes: list[MatchProgramme]) -> TcasMatchIndex:
    idx = TcasMatchIndex()
    for p in programmes:
        key = f"{p.faculty_name_th}{KEY_SEP}{p.name_th}"
        idx.by_faculty_programme.setdefault(key, []).append(p)
    for p in programmes:
        spec = extract_specialization(p.name_th)
        if not spec:
            continue
        key = f"{p.faculty_name_th}{KEY_SEP}{spec}"
        idx.by_faculty_spec.setdefault(key, []).append(p)
    return idx


def find_own_programme_match(
    idx: TcasMatchIndex, faculty_name_th: str, programme_name: str, major_name: str
) -> MatchProgramme | None:
    index = idx.by_faculty_programme
    spec_index = idx.by_faculty_spec
    prefix = f"{faculty_name_th}{KEY_SEP}"
    # 1: exact faculty + programme
    c = index.get(f"{prefix}{programme_name}")
    if c:
        return c[0]
    # 2: parenthesised content
    pm = _PAREN.search(programme_name)
    if pm:
        c = index.get(f"{prefix}{pm.group(1).strip()}")
        if c:
            return c[0]
    # 3: strip leading "หลักสูตร...บัณฑิต "
    stripped = _PREFIX.sub("", programme_name, count=1).strip()
    if stripped != programme_name:
        c = index.get(f"{prefix}{stripped}")
        if c:
            return c[0]
    # 4: substring
    for key, cands in index.items():
        if not key.startswith(prefix):
            continue
        for cand in cands:
            if cand.name_th and cand.name_th in programme_name:
                return cand
            if major_name and cand.name_th and cand.name_th in major_name:
                return cand
            for m in cand.majors:
                if m and m in programme_name:
                    return cand
    # 5: specialization
    tcas_spec = extract_specialization(programme_name)
    if tcas_spec:
        c = spec_index.get(f"{prefix}{tcas_spec}")
        if c:
            return c[0]
        norm = tcas_spec.lower()
        for key, cands in spec_index.items():
            if not key.startswith(prefix):
                continue
            if key[len(prefix):].lower() == norm:
                return cands[0]
        for key, cands in spec_index.items():
            if not key.startswith(prefix):
                continue
            ks = key[len(prefix):].lower()
            if ks in norm or norm in ks:
                return cands[0]
    # 5b: major as a specialization source
    if major_name:
        # TS: `extractSpecialization(majorName) ?? majorName.trim()`; the
        # function returns '' (never null), so `??` never falls back and an
        # unextractable major skips this strategy.
        major_spec = extract_specialization(major_name)
        if major_spec:
            norm_major = major_spec.lower()
            for key, cands in spec_index.items():
                if not key.startswith(prefix):
                    continue
                ks = key[len(prefix):].lower()
                if ks == norm_major or ks in norm_major or norm_major in ks:
                    return cands[0]
    return None


def link_rows(slice_programmes: list, own_rows: list[TcasRow]) -> dict[str, list[TcasRow]]:
    """Programme code -> TCAS rows the app would link to it.

    `slice_programmes` are objects with `.code`, `.name_th`,
    `.faculty_name_th` and optionally `.level` (default BACHELOR). Only
    bachelor programmes are indexed, in the order given; the result has a key
    for each of them.
    """
    bachelors = [p for p in slice_programmes if getattr(p, "level", "BACHELOR") == "BACHELOR"]
    idx = build_tcas_match_index(
        [MatchProgramme(p.code, p.name_th, [], p.faculty_name_th) for p in bachelors]
    )
    out: dict[str, list[TcasRow]] = {p.code: [] for p in bachelors}
    for r in own_rows:
        hit = find_own_programme_match(idx, r.faculty, r.programme, r.major or "")
        if hit is not None:
            out[hit.id].append(r)
    return out
