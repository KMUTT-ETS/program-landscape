"""Course lists for each programme: read from the PDF, a CSV, or invented."""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, replace
from pathlib import Path

from .slice import Programme

# Python port of COURSE_CODE_SOURCE in packages/shared/src/curriculum/course-code-pattern.ts
# (that file is the source of truth; keep the two in step).
COURSE_CODE_RE = re.compile(
    r"\b[A-Z]{2,4}\s?(?:\d{3}\s?\d{3}|\d{3}(?!\d)(?!\s?\d{3}))(?!\d)\b",
    re.ASCII,  # JS \b and \d are ASCII-only; Thai text runs straight into codes
)

GE, CORE, REQ, ELEC, FREE, THESIS = (
    "General education", "Core", "Major required", "Major elective", "Free elective", "Thesis / project",
)
CATEGORIES = (GE, CORE, REQ, ELEC, FREE, THESIS)
_NOT_MAJOR = (GE, FREE)


@dataclass
class Course:
    code: str
    name_th: str | None
    name_en: str | None
    credits: int
    category: str


# ---------------------------------------------------------------- PDF

_CREDITS_RE = re.compile(r"(\d)\s*\(\d-\d-\d\)")
_LONE_INT = re.compile(r"^\s*(\d)\s*$")
_HEADING_START = re.compile(r"^\s*(?:\d+(?:\.\d+)*\)?\s|หมวด|กลุ่ม)")
_LATIN_LINE = re.compile(r"^[A-Za-z][A-Za-z0-9 ,.&'()/:+\-\ufb00-\ufb06]*$")
_COMBINING = {0x0E31} | set(range(0x0E34, 0x0E3B)) | set(range(0x0E47, 0x0E4F))


def _has_control(s: str) -> bool:
    return any(ord(ch) < 32 for ch in s)


def _clean_thai_name(s: str | None) -> str | None:
    """Keep a Thai name only if it looks intact (3-80 chars, no leading combining mark)."""
    if not s:
        return None
    s = s.strip()
    if _has_control(s):  # a NUL marks a Thai mark the PDF font lost: misspelled, so unusable
        return None
    if not 3 <= len(s) <= 80 or ord(s[0]) in _COMBINING:
        return None
    return s


def _heading_category(line: str) -> str | None:
    """Category set by a heading line, or None when the line is not a heading."""
    if COURSE_CODE_RE.search(line) or not _HEADING_START.match(line):
        return None
    if "หมวดวิชาศึกษา" in line:
        return GE
    if "เลือกเสรี" in line:
        return FREE
    if "วิชาเฉพาะเลือก" in line or "วิชาเลือก" in line:
        return ELEC
    if "วิชาแกน" in line:
        return CORE
    if re.search(r"วิทยานิพนธ์|โครงงาน|สหกิจ", line):
        return THESIS
    if "หมวดวิชา" in line or "กลุ่มวิชา" in line:
        return REQ
    return None


def courses_from_pdf(pdf: Path) -> tuple[list[Course], str]:
    """Read course codes from a curriculum PDF. Never raises on a bad PDF."""
    empty = f"no course codes found in {Path(pdf).name}; using an invented list"
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(pdf))
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception:  # unreadable, encrypted, not a PDF, pypdf missing
        return [], empty
    lines = text.splitlines()
    seen: dict[str, Course] = {}
    category = REQ
    lost_marks = 0
    for i, line in enumerate(lines):
        h = _heading_category(line)
        if h:
            category = h
            continue
        m = COURSE_CODE_RE.search(line)
        if not m:
            continue
        code = re.sub(r"\s+", " ", m.group(0)).strip()
        if code in seen:
            continue
        rest = line[m.end():]
        cm = _CREDITS_RE.search(rest)
        credits = int(cm.group(1)) if cm else None
        if cm:
            rest = rest[: cm.start()]
        # drop an English parenthetical (description lines: "GEN 101 ชื่อ (English)")
        rest = re.sub(r"\(.*$", "", rest).strip()
        name_th = _clean_thai_name(rest) if re.search(r"[฀-๿]", rest) else None
        if re.search(r"[฀-๿]", rest) and name_th is None and _has_control(rest):
            lost_marks += 1
        name_en = None
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if nxt and _LATIN_LINE.match(nxt) and not COURSE_CODE_RE.search(nxt) and not _has_control(nxt):
            name_en = nxt
        if credits is None:
            # table layout puts the credit figure alone on the line after the English name
            for j in (i + 2, i + 1):
                if j < len(lines) and (lm := _LONE_INT.match(lines[j])):
                    credits = int(lm.group(1))
                    break
        seen[code] = Course(code, name_th, name_en, credits or 3, category)
    if not seen:
        return [], empty
    note = f"{len(seen)} course codes read from {Path(pdf).name}"
    if lost_marks:
        note += (f"; {lost_marks} Thai course names were left blank because they did not survive "
                 "PDF extraction (a font mark was lost)")
    return list(seen.values()), note


# ---------------------------------------------------------------- CSV

def _clean_csv_name(v: str | None) -> str | None:
    s = (v or "").strip()
    return None if not s or _has_control(s) else s


def courses_from_csv(path: Path) -> list[Course]:
    out: list[Course] = []
    seen: set[str] = set()
    by_label = {c.lower(): c for c in CATEGORIES}
    with Path(path).open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            code = (row.get("code") or "").strip()
            if not code or code in seen:
                continue
            seen.add(code)
            try:
                credits = int(float((row.get("credits") or "").strip()))
            except ValueError:
                credits = 3
            out.append(Course(
                code,
                _clean_csv_name(row.get("name_th")),
                _clean_csv_name(row.get("name_en")),
                credits,
                by_label.get((row.get("category") or "").strip().lower(), REQ),
            ))
    return out


# ---------------------------------------------------------------- invented

_STOP = {"department", "of", "and", "the", "faculty", "school", "in", "for"}
GEN_COURSES = [
    ("GEN 101", "Communication in English"),
    ("GEN 102", "Thai Language for Communication"),
    ("GEN 111", "Citizenship and Society"),
    ("GEN 121", "Digital Literacy"),
]


def _prefix(dept_name_en: str) -> str:
    """3 uppercase letters from the department name. Never starts with GE or LI: the app's
    overlap method (isGeneralEducationCode) reads those as general education."""
    words = [w for w in re.split(r"[^A-Za-z0-9]+", dept_name_en) if w and w.lower() not in _STOP]
    letters = [w for w in words if w.isalpha()]
    src = letters[0] if letters else "".join(ch for w in words for ch in w if ch.isalpha())
    src = re.sub(r"[^A-Z]", "", src.upper())
    while src[:2] in ("GE", "LI"):
        src = src[1:]  # next letters instead: Geology -> EOL
    p = (src + "XXX")[:3]
    return p if p[:2] not in ("GE", "LI") else "XXX"


def invented_courses(programme: Programme, rng, department_name_en: str) -> list[Course]:
    """Invent a plausible course list. `department_name_en` is the English name of the
    programme's department (from Slice.departments); the 3-letter prefix comes from it."""
    prefix = _prefix(department_name_en)
    bachelor = programme.level == "BACHELOR"
    gen = [Course(c, None, n, 3, GE) for c, n in GEN_COURSES] if bachelor else []
    n_major = max(8, round(programme.credits / 3) - len(gen))
    years = [1, 2, 3, 4] if bachelor else [5, 6]
    per_year = [n_major // len(years) + (1 if k < n_major % len(years) else 0) for k in range(len(years))]
    courses: list[Course] = []
    for y, n in zip(years, per_year):
        for nn in sorted(rng.sample(range(1, 60), n)):
            courses.append(Course(f"{prefix} {y}{nn:02d}", None, None, 3, REQ))
    # categories: first ~25 % core, then required; last years carry electives, last two are project
    n = len(courses)
    n_core, n_elec = round(n * 0.25), round(n * 0.25)
    for k, c in enumerate(courses):
        if k < n_core:
            c.category = CORE
        elif k >= n - 2:
            c.category = THESIS
        elif k >= n - 2 - n_elec:
            c.category = ELEC
    if bachelor:
        courses[n - 3 - n_elec].category = FREE
        courses[n - 4 - n_elec].category = FREE
    for k, c in enumerate(courses, 1):
        c.name_en = f"{prefix} Topic {k}"
    # tune credits so the total lands within a credit or two of the programme total
    allc = gen + courses
    diff = programme.credits - sum(c.credits for c in allc)
    step = 1 if diff > 0 else -1
    idx = [k for k, c in enumerate(courses) if c.category not in (THESIS,)]
    for k in range(abs(diff)):
        courses[idx[(k * 7) % len(idx)]].credits += step
    return gen + courses


def share_with_sibling(anchor_courses: list[Course], sibling_courses: list[Course], rng) -> list[Course]:
    """The sibling's list with 6-10 of the anchor's major courses substituted in (same code and name)."""
    anchor_major = [c for c in anchor_courses if c.category not in _NOT_MAJOR]
    sib_major_idx = [i for i, c in enumerate(sibling_courses) if c.category not in _NOT_MAJOR]
    k = min(rng.randint(6, 10), len(anchor_major), len(sib_major_idx))
    chosen = rng.sample(anchor_major, k)
    slots = set(rng.sample(sib_major_idx, k))
    out: list[Course] = []
    shared_ids: set[int] = set()
    queue = list(chosen)
    for i, c in enumerate(sibling_courses):
        if i in slots:
            out.append(replace(queue.pop()))
            shared_ids.add(id(out[-1]))
        else:
            out.append(replace(c))
    # an unshared sibling course must not reuse a code the anchor already uses
    anchor_codes = {c.code for c in anchor_courses}
    used = {c.code for c in out if id(c) in shared_ids} | {c.code for c in out if c.code not in anchor_codes}
    for c in out:
        if id(c) in shared_ids or c.category == GE or c.code not in anchor_codes:
            continue
        m = re.match(r"^([A-Z]+) (\d)", c.code)
        pre, yr = (m.group(1), m.group(2)) if m else ("XXX", "1")
        for nn in range(99, 0, -1):
            cand = f"{pre} {yr}{nn:02d}"
            if cand not in used and cand not in anchor_codes:
                c.code = cand
                used.add(cand)
                break
    return out
