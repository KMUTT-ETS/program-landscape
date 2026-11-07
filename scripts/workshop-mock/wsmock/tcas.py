"""Reader for the public TCAS round-3 max/min files (mytcas.com)."""
from __future__ import annotations

import difflib
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import openpyxl

USER_AGENT = "ProgramLandscape-WorkshopMock/1.0"
REFERER = "https://www.mytcas.com/stat/"
TIMEOUT_S = 60

# Copy of BUILT_IN_TCAS_FILES in apps/ingestion/src/connectors/sources/tcas/files.ts
# as (url, entry_year_be, round).
TCAS_FILES: list[tuple[str, int, str]] = [
    ("https://assets.mytcas.com/maxmin/TCAS62_maxmin.xlsx", 2562, "3"),
    ("https://assets.mytcas.com/maxmin/TCAS63_maxmin.xlsx", 2563, "3"),
    ("https://assets.mytcas.com/maxmin/TCAS64_maxmin.xlsx", 2564, "3"),
    ("https://assets.mytcas.com/maxmin/TCAS65_maxmin.xlsx", 2565, "3"),
    ("https://assets.mytcas.com/maxmin/TCAS66_maxmin.xlsx", 2566, "3"),
    ("https://assets.mytcas.com/67/TCAS67_maxmin.xlsx", 2567, "3"),
    ("https://assets.mytcas.com/68/T68-stat-r3_1-maxmin-20May25.xlsx", 2568, "3.1"),
    ("https://assets.mytcas.com/68/T68-stat-r3_2-maxmin-24May25.xlsx", 2568, "3.2"),
    ("https://assets.mytcas.com/69/TCAS69-R3-MinMax-10June26.xlsx", 2569, "3"),
]


@dataclass(frozen=True)
class TcasRow:
    course_code: str
    institution: str
    faculty: str
    programme: str
    major: str | None
    entry_year_be: int
    round: str
    quota: int | None
    applicants: int | None
    admitted: int | None  # pass1 + pass2 when either is stated, else None
    min_score: float | None
    max_score: float | None


@dataclass(frozen=True)
class TcasTotals:
    quota: int
    applicants: int
    admitted: int | None


def _text(v: object) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _num(v: object) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _int(v: object) -> int | None:
    n = _num(v)
    return None if n is None else int(n)


def _find(headers: list[str], pred) -> int | None:
    for i, h in enumerate(headers):
        if pred(h):
            return i
    return None


def _read_file(path: Path, year: int, rnd: str) -> list[TcasRow]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        it = wb.worksheets[0].iter_rows(values_only=True)
        headers = [(_text(h) or "") for h in next(it)]

        def exact(name: str) -> int | None:
            return _find(headers, lambda h: h == name)

        c_inst, c_code = exact("สถาบัน"), exact("รหัสหลักสูตร")
        c_fac, c_prog, c_major = exact("คณะ"), exact("หลักสูตร"), exact("สาขา/วิชาเอก")
        c_quota, c_app = exact("รับ"), exact("สมัคร")
        # Header wording differs between years, so pass columns match by shape.
        c_p1 = _find(headers, lambda h: h.startswith("ผ่าน") and "1" in h)
        c_p2 = _find(headers, lambda h: h.startswith("ผ่าน") and "2" in h)
        c_min = _find(headers, lambda h: h.startswith("คะแนนต่ำสุด") and "2" not in h)
        c_max = _find(headers, lambda h: h.startswith("คะแนนสูงสุด") and "2" not in h)
        if c_inst is None or c_code is None:
            raise ValueError(f"{path.name}: missing institution/course-code header")

        def at(r: tuple, i: int | None) -> object:
            return r[i] if i is not None and i < len(r) else None

        out: list[TcasRow] = []
        for r in it:
            code, inst = _text(at(r, c_code)), _text(at(r, c_inst))
            if not code or not inst:
                continue
            p1, p2 = _int(at(r, c_p1)), _int(at(r, c_p2))
            admitted = None if p1 is None and p2 is None else (p1 or 0) + (p2 or 0)
            out.append(
                TcasRow(
                    course_code=code,
                    institution=inst,
                    faculty=_text(at(r, c_fac)) or "",
                    programme=_text(at(r, c_prog)) or "",
                    major=_text(at(r, c_major)),
                    entry_year_be=year,
                    round=rnd,
                    quota=_int(at(r, c_quota)),
                    applicants=_int(at(r, c_app)),
                    admitted=admitted,
                    min_score=_num(at(r, c_min)),
                    max_score=_num(at(r, c_max)),
                )
            )
        return out
    finally:
        wb.close()


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Referer": REFERER})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        data = resp.read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(data)
    tmp.replace(dest)


def load_rows(
    cache_dir: Path, *, offline: bool, files: list[Path] | None = None
) -> list[TcasRow]:
    """Read TCAS rows. `files` bypasses download (tests); the year is read from
    the matching TCAS_FILES entry by file name, defaulting to 2567."""
    rows: list[TcasRow] = []
    if files is not None:
        by_name = {Path(u).name: (y, r) for u, y, r in TCAS_FILES}
        for f in files:
            year, rnd = by_name.get(f.name, (2567, "3"))
            rows.extend(_read_file(f, year, rnd))
        return rows
    for url, year, rnd in TCAS_FILES:
        dest = cache_dir / Path(url).name
        try:
            if not dest.exists():
                if offline:
                    print(f"warning: {dest.name} not cached and offline; skipped")
                    continue
                _download(url, dest)
            rows.extend(_read_file(dest, year, rnd))
        except Exception as err:  # one bad file must not stop the run
            print(f"warning: TCAS file {url} skipped: {err}")
    return rows


def own_rows(rows: list[TcasRow], university: str) -> list[TcasRow]:
    """Rows of one institution, exact name match."""
    return [r for r in rows if r.institution == university]


def closest_institutions(rows: list[TcasRow], university: str, n: int = 5) -> list[str]:
    names = sorted({r.institution for r in rows})
    scored = sorted(
        names,
        key=lambda s: (-difflib.SequenceMatcher(None, university, s).ratio(), s),
    )
    return scored[:n]


def round3_totals(rows: list[TcasRow]) -> dict[int, TcasTotals]:
    """Per entry year, summed over distinct course codes (a code repeated by
    rounds 3.1 and 3.2 counts once: the first row seen)."""
    seen: dict[tuple[int, str], TcasRow] = {}
    for r in rows:
        if r.round.startswith("3"):
            seen.setdefault((r.entry_year_be, r.course_code), r)
    acc: dict[int, list] = {}
    for (year, _), r in seen.items():
        a = acc.setdefault(year, [0, 0, None])
        a[0] += r.quota or 0
        a[1] += r.applicants or 0
        if r.admitted is not None:
            a[2] = (a[2] or 0) + r.admitted
    return {y: TcasTotals(a[0], a[1], a[2]) for y, a in acc.items()}
