"""Attendee input file (TOML) and resolution of programmes to TCAS rows."""
from __future__ import annotations

import difflib
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from .tcas import TcasRow

LEVELS = ("BACHELOR", "MASTER", "DOCTORAL", "HIGHER_GRAD_DIPLOMA")
MIN_SCORE = 0.6
MIN_MARGIN = 0.05


class InputError(Exception):
    """The message is the text printed to the attendee."""


@dataclass
class ProgrammeInput:
    name: str
    pdf: Path | None
    level: str = "BACHELOR"
    faculty: str | None = None
    tcas_code: str | None = None
    courses: Path | None = None
    name_en: str | None = None


@dataclass
class Inputs:
    university: str
    region: str
    programmes: list[ProgrammeInput] = field(default_factory=list)


@dataclass
class Anchor:
    input: ProgrammeInput
    faculty_th: str
    programme_th: str
    course_codes: list[str]
    rows: list[TcasRow]


def _str(d: dict, key: str, where: str, required: bool = False) -> str | None:
    v = d.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            raise InputError(f"{where}: `{key}` is required")
        return None
    if not isinstance(v, str):
        raise InputError(f"{where}: `{key}` must be text")
    return v.strip()


def load_inputs(path: Path) -> Inputs:
    path = Path(path)
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise InputError(f"Input file not found: {path}") from None
    except tomllib.TOMLDecodeError as err:
        raise InputError(f"{path.name}: not valid TOML ({err})") from None
    base = path.resolve().parent

    def rel(v: str | None) -> Path | None:
        if v is None:
            return None
        p = Path(v)
        return p if p.is_absolute() else base / p

    university = _str(data, "university", path.name, True)
    region = _str(data, "region", path.name, True)
    blocks = data.get("programme", [])
    if not isinstance(blocks, list) or not blocks:
        raise InputError(f"{path.name}: add at least one [[programme]] block")
    progs: list[ProgrammeInput] = []
    for i, b in enumerate(blocks, 1):
        where = f"{path.name} [[programme]] #{i}"
        level = (_str(b, "level", where) or "BACHELOR").upper()
        if level not in LEVELS:
            raise InputError(f"{where}: level must be one of {', '.join(LEVELS)} (got {level})")
        faculty = _str(b, "faculty", where)
        if level != "BACHELOR" and not faculty:
            raise InputError(f"{where}: `faculty` is required for level {level}")
        progs.append(
            ProgrammeInput(
                name=_str(b, "name", where, True),
                pdf=rel(_str(b, "pdf", where)),
                level=level,
                faculty=faculty,
                tcas_code=_str(b, "tcas_code", where),
                courses=rel(_str(b, "courses", where)),
                name_en=_str(b, "name_en", where),
            )
        )
    return Inputs(university=university, region=region, programmes=progs)


def _squash(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


# "-วศ.บ.4ปี" (older files) or "ปริญญาตรี 4 ปี" (newer) after whitespace is squashed
_TRAILING_DEGREE = re.compile(r"-[^-]*ปี$|ปริญญา[^()]*?ปี")
_INTL = re.compile(r"\(?หลักสูตรนานาชาติ\)?")
_PAREN = re.compile(r"\(([^)]*)\)")
_DEGREE_TOKEN = re.compile(r"\S*บัณฑิต")
_YEARS = re.compile(r"\d+\s*ปี")


def _after_marker(name: str) -> tuple[str, bool]:
    s = _squash(name)
    if s.startswith("หลักสูตร"):
        s = s[len("หลักสูตร"):]
    s = _TRAILING_DEGREE.sub("", s)
    for marker in ("สาขาวิชา", "สาขา"):
        if marker in s:
            return s.split(marker, 1)[1], True
    return s, False


def _views(name: str) -> set[str]:
    """Normalised readings of a programme name, for comparison only: the part
    after สาขา(วิชา), each parenthesised field, the name without degree words,
    year suffixes, a leading หลักสูตร and หลักสูตรนานาชาติ, and the full name."""
    out = {_squash(name), _after_marker(name)[0]}
    for inner in _PAREN.findall(name):
        out.add(_squash(_INTL.sub("", inner)))
    t = _INTL.sub(" ", name).strip()
    t = re.sub(r"^หลักสูตร", "", t)
    t = _TRAILING_DEGREE.sub("", _YEARS.sub("", t))
    t = _DEGREE_TOKEN.sub(" ", t)
    t = re.sub(r"สาขาวิชา|สาขา", " ", t)
    out.add(_squash(re.sub(r"[()]", " ", t)))
    return {v for v in out if v}


def _score(typed: str, tcas: str) -> float:
    """Best similarity over the readings of both names."""
    return max(
        difflib.SequenceMatcher(None, a, b).ratio()
        for a in _views(typed)
        for b in _views(tcas)
    )


def _intl(name: str) -> bool:
    return "นานาชาติ" in name


def _same_but_international(a: str, b: str) -> bool:
    return _squash(_INTL.sub("", a)) == _squash(_INTL.sub("", b))


@dataclass
class _Pair:
    faculty: str
    programme: str
    codes: set[str]
    rows: list[TcasRow]


def _latest_pairs(own: list[TcasRow]) -> list[_Pair]:
    """One pair per distinct (faculty, programme) in the latest entry year."""
    if not own:
        return []
    year = max(r.entry_year_be for r in own)
    grouped: dict[tuple[str, str], list[TcasRow]] = {}
    for r in own:
        if r.entry_year_be == year:
            grouped.setdefault((r.faculty, r.programme), []).append(r)
    return [
        _Pair(f, p, {r.course_code for r in rs}, rs)
        for (f, p), rs in sorted(grouped.items())
    ]


def _anchor(inp: ProgrammeInput, pair: _Pair) -> Anchor:
    return Anchor(inp, pair.faculty, pair.programme, sorted(pair.codes), list(pair.rows))


def _normalise_faculty(s: str) -> str:
    return _squash(s)


def _candidate_lines(ranked: list[tuple[float, _Pair]]) -> str:
    return "\n".join(
        f"  {sorted(p.codes)[0]}  {p.faculty} | {p.programme}  ({s:.2f})" for s, p in ranked[:5]
    )


def resolve_anchors(inputs: Inputs, own: list[TcasRow]) -> list[Anchor]:
    pairs = _latest_pairs(own)
    out: list[Anchor] = []
    for inp in inputs.programmes:
        if inp.level not in LEVELS:
            raise InputError(f"{inp.name}: level must be one of {', '.join(LEVELS)} (got {inp.level})")
        if inp.level != "BACHELOR":
            if not inp.faculty:
                raise InputError(f"{inp.name}: `faculty` is required for level {inp.level}")
            typed = _normalise_faculty(inp.faculty)
            known = sorted({r.faculty for r in own})
            faculty_th = next((f for f in known if _normalise_faculty(f) == typed), inp.faculty)
            out.append(Anchor(inp, faculty_th, inp.name, [], []))
            continue
        if not pairs:
            raise InputError(f"{inp.name}: no TCAS rows for {inputs.university}")
        year = max(r.entry_year_be for r in own)
        if inp.tcas_code:
            hit = next((p for p in pairs if inp.tcas_code in p.codes), None)
            if hit is not None:
                out.append(_anchor(inp, hit))
                continue
            older = next((r for r in own if r.course_code == inp.tcas_code), None)
            if older is None:
                raise InputError(
                    f"{inp.name}: tcas_code {inp.tcas_code} is not a course code of {inputs.university}"
                )
            near = max(pairs, key=lambda p: _score(older.programme, p.programme))
            raise InputError(
                f"{inp.name}: tcas_code {inp.tcas_code} is not in the latest TCAS year ({year}); "
                f"course codes change between years. Closest programme in {year}: "
                f"{near.faculty} | {near.programme}, codes: {', '.join(sorted(near.codes))}"
            )
        pool = pairs
        if inp.faculty:  # an optional faculty narrows the candidates when it matches any
            typed_f = _normalise_faculty(inp.faculty)
            pool = [p for p in pairs if _normalise_faculty(p.faculty) == typed_f] or pairs
        ranked = sorted(
            ((_score(inp.name, p.programme), p) for p in pool),
            key=lambda t: (-round(t[0], 9), _intl(t[1].programme) != _intl(inp.name),
                           t[1].faculty, t[1].programme),
        )
        best = ranked[0][0]
        # the international twin of the winner is not a rival: the typed name decides between them
        rivals = [
            sc for sc, p in ranked[1:]
            if not (p.faculty == ranked[0][1].faculty
                    and _same_but_international(p.programme, ranked[0][1].programme))
        ]
        second = rivals[0] if rivals else 0.0
        if best < MIN_SCORE or best - second < MIN_MARGIN:
            why = "no close match" if best < MIN_SCORE else "more than one close match"
            raise InputError(
                f"Cannot match programme '{inp.name}' to a TCAS programme ({why}). "
                f"Closest candidates:\n{_candidate_lines(ranked)}\n"
                "Add `tcas_code = \"<course code>\"` to that programme in the input file."
            )
        out.append(_anchor(inp, ranked[0][1]))
    return out
