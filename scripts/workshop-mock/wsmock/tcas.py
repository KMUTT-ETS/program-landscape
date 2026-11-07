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


def _norm(h: object) -> str:
    """Header comparison only: collapse whitespace (incl. newlines)."""
    return " ".join(str(h or "").split())


ALIASES = {
    "institution": ["สถาบัน", "university_name"],
    "code": ["รหัสหลักสูตร", "program_id"],
    "faculty": ["คณะ", "คณะ/สำนักวิชา", "program_lookup_programs.faculty_name_th"],
    "programme": ["หลักสูตร", "ชื่อหลักสูตร", "program_name_th"],
    "major": ["สาขา/วิชาเอก", "สาขาวิชา/วิชาเอก", "แขนง/วิชาเอก", "major_name_th"],
    "quota": ["รับ"],
    "applicants": ["สมัคร"],
    "pass": ["ผ่าน"],
    "pass1": ["ผ่าน(รอบ1)", "ผ่าน ประมวลผลครั้งที่ 1"],
    "pass2": ["ผ่าน(รอบ2)", "ผ่าน ประมวลผลครั้งที่ 2"],
    "min": ["คะแนนต่ำสุด", "คะแนนต่ำสุด ประมวลผลครั้งที่ 1"],
    "max": ["คะแนนสูงสุด", "คะแนนสูงสุด ประมวลผลครั้งที่ 1"],
}


def _index(headers: list[str], key: str) -> int | None:
    for alias in ALIASES[key]:
        for i, h in enumerate(headers):
            if h == alias:
                return i
    return None


def _read_file(path: Path, year: int, rnd: str) -> list[TcasRow]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        it = wb.worksheets[0].iter_rows(values_only=True)
        headers = [_norm(h) for h in next(it)]
        ix = {k: _index(headers, k) for k in ALIASES}
        if ix["institution"] is None or ix["code"] is None:
            raise ValueError(f"{path.name}: missing institution/course-code header")

        def at(r: tuple, key: str) -> object:
            i = ix[key]
            return r[i] if i is not None and i < len(r) else None

        out: list[TcasRow] = []
        for r in it:
            code, inst = _text(at(r, "code")), _text(at(r, "institution"))
            if not code or not inst:
                continue
            plain = _int(at(r, "pass"))
            p1, p2 = _int(at(r, "pass1")), _int(at(r, "pass2"))
            if plain is not None:
                admitted = plain
            elif p1 is None and p2 is None:
                admitted = None
            else:
                admitted = (p1 or 0) + (p2 or 0)
            out.append(
                TcasRow(
                    course_code=code,
                    institution=inst,
                    faculty=_text(at(r, "faculty")) or "",
                    programme=_text(at(r, "programme")) or "",
                    major=_text(at(r, "major")),
                    entry_year_be=year,
                    round=rnd,
                    quota=_int(at(r, "quota")),
                    applicants=_int(at(r, "applicants")),
                    admitted=admitted,
                    min_score=_num(at(r, "min")),
                    max_score=_num(at(r, "max")),
                )
            )
        empty = sum(1 for x in out if not x.faculty or not x.programme)
        if empty:
            print(f"warning: {path.name}: {empty} of {len(out)} rows have empty faculty or programme")
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
    cache_dir: Path,
    *,
    offline: bool,
    files: list[tuple[Path, int, str]] | None = None,
) -> list[TcasRow]:
    """Read TCAS rows. `files` (path, entry_year_be, round) bypasses download
    (tests and local files)."""
    rows: list[TcasRow] = []
    if files is not None:
        for f, year, rnd in files:
            rows.extend(_read_file(Path(f), year, rnd))
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
    """Per entry year, summed over distinct course codes. A code repeated by
    rounds 3.1 and 3.2 counts once: the row that states `admitted`, else the
    first seen."""
    seen: dict[tuple[int, str], TcasRow] = {}
    for r in rows:
        if not r.round.startswith("3"):
            continue
        key = (r.entry_year_be, r.course_code)
        cur = seen.get(key)
        if cur is None or (cur.admitted is None and r.admitted is not None):
            seen[key] = r
    acc: dict[int, list] = {}
    for (year, _), r in seen.items():
        a = acc.setdefault(year, [0, 0, None])
        a[0] += r.quota or 0
        a[1] += r.applicants or 0
        if r.admitted is not None:
            a[2] = (a[2] or 0) + r.admitted
    return {y: TcasTotals(a[0], a[1], a[2]) for y, a in acc.items()}
