"""Generate mock import spreadsheets for a workshop attendee's university.

    python generate.py <input.toml> [--size small|medium] [--seed N] [--out DIR]
                       [--cache DIR] [--offline] [--tcas-file PATH:YEAR:ROUND ...]

Exit codes: 0 success, 2 input error.
"""
from __future__ import annotations

import argparse
import random
import shutil
import sys
from pathlib import Path

from wsmock.courses import courses_from_csv, courses_from_pdf, invented_courses, share_with_sibling
from wsmock.datasets import UPLOAD_ORDER, World, build_rows
from wsmock.inputs import InputError, load_inputs, resolve_anchors
from wsmock.people import make_publications, make_staff
from wsmock.slice import SIZES, choose_slice
from wsmock.tcas import TCAS_FILES, closest_institutions, load_rows, own_rows
from wsmock.write import anchor_lines, write_dataset, write_readme


class _Parser(argparse.ArgumentParser):
    def error(self, message: str):  # argparse would exit 2 with usage; keep 2, no traceback
        raise InputError(f"{message}\n{self.format_usage().strip()}")


def _parser() -> argparse.ArgumentParser:
    p = _Parser(prog="generate.py", description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("input", type=Path, help="the input TOML file")
    p.add_argument("--size", choices=sorted(SIZES), default="small")
    p.add_argument("--seed", type=int, default=2026)
    p.add_argument("--out", type=Path, default=Path("workshop-mock-out"))
    p.add_argument("--cache", type=Path, default=None, help="folder for downloaded TCAS files (default <out>/.cache)")
    p.add_argument("--offline", action="store_true", help="never download; use the cache only")
    p.add_argument("--tcas-file", action="append", default=[], metavar="PATH:YEAR:ROUND",
                   help="use a local TCAS file; YEAR is the Buddhist-era entry year and ROUND the round\n"
                        "(for example data/tcas67.xlsx:2567:3). Repeatable.")
    return p


def _parse_tcas_files(specs: list[str]) -> list[tuple[Path, int, str]]:
    known = {(y, r) for _, y, r in TCAS_FILES}
    out: list[tuple[Path, int, str]] = []
    for s in specs:
        parts = s.rsplit(":", 2)  # a Windows path holds a colon
        if len(parts) != 3 or not parts[1].isdigit() or not parts[2]:
            raise InputError(f"--tcas-file '{s}': write it as PATH:YEAR:ROUND, e.g. tcas67.xlsx:2567:3")
        path, year, rnd = Path(parts[0]), int(parts[1]), parts[2]
        if (year, rnd) not in known:
            raise InputError(
                f"--tcas-file '{s}': no TCAS file for year {year} round {rnd}. Known: "
                + ", ".join(f"{y}:{r}" for y, r in sorted(known)))
        if not path.is_file():
            raise InputError(f"--tcas-file '{s}': file not found: {path}")
        out.append((path, year, rnd))
    return out


def _cache_name(year: int, rnd: str) -> str:
    return next(Path(u).name for u, y, r in TCAS_FILES if (y, r) == (year, rnd))


def _build_courses(slice_, rng_seed: int, notes: list[str]) -> dict:
    dept = {d.code: d.name_en for d in slice_.departments}
    by_code = {p.code: p for p in slice_.programmes}
    courses: dict = {}

    def own(p):
        if p.courses_csv:
            cs = courses_from_csv(p.courses_csv)
            if cs:
                notes.append(f"{p.name_th}: {len(cs)} courses read from {Path(p.courses_csv).name}")
                return cs
            notes.append(f"{p.name_th}: no courses in {Path(p.courses_csv).name}; using an invented list")
        elif p.pdf:
            cs, note = courses_from_pdf(p.pdf)
            notes.append(f"{p.name_th}: {note}")
            if cs:
                return cs
        return invented_courses(p, random.Random(f"{rng_seed}-{p.code}"), dept[p.department_code])

    for p in slice_.programmes:
        if p.sibling_of is None:
            courses[p.code] = own(p)
    for p in slice_.programmes:
        if p.sibling_of is not None:
            base = by_code[p.sibling_of]
            mine = invented_courses(p, random.Random(f"{rng_seed}-{p.code}"), dept[p.department_code])
            courses[p.code] = share_with_sibling(courses[base.code], mine,
                                                 random.Random(f"{rng_seed}-share-{p.code}"))
    return courses


def run(args: argparse.Namespace) -> int:
    inputs = load_inputs(args.input)
    out: Path = args.out
    cache: Path = args.cache or (out / ".cache")
    tcas_files = _parse_tcas_files(args.tcas_file)
    out.mkdir(parents=True, exist_ok=True)
    (out / ".gitignore").write_text("*\n", encoding="utf-8")  # mock data is never committed
    cache.mkdir(parents=True, exist_ok=True)
    for path, year, rnd in tcas_files:
        dest = cache / _cache_name(year, rnd)
        if path.resolve() != dest.resolve():
            shutil.copyfile(path, dest)
    if tcas_files:
        rows = []
        for f in tcas_files:
            try:
                rows += load_rows(cache, offline=True, files=[f])
            except Exception as err:  # bad zip, not xlsx, missing headers ...
                raise InputError(f"--tcas-file {f[0]} cannot be read as a TCAS file "
                                 f"({type(err).__name__}: {err})") from None
    else:
        try:
            rows = load_rows(cache, offline=args.offline)
        except OSError as err:
            raise InputError(f"Cannot download the TCAS files ({err}). Download them yourself and pass "
                             "--tcas-file PATH:YEAR:ROUND, or fix the network.") from None
    if not rows:
        hint = ("Nothing is cached and --offline forbids downloading. Run once without --offline, "
                "or pass --tcas-file PATH:YEAR:ROUND." if args.offline
                else "No TCAS rows could be read. Check the network, or pass --tcas-file PATH:YEAR:ROUND.")
        raise InputError(f"No TCAS data. {hint}")
    own = own_rows(rows, inputs.university)
    if not own:
        near = closest_institutions(rows, inputs.university)
        raise InputError(f"University '{inputs.university}' is not in the TCAS files. "
                         "Use the Thai name exactly as TCAS spells it. Closest names:\n  " + "\n  ".join(near))
    anchors = resolve_anchors(inputs, own)
    s = choose_slice(anchors, own, args.size, random.Random(args.seed))
    staff, links = make_staff(s, random.Random(args.seed))
    pubs = make_publications(s, staff, links, random.Random(args.seed))
    notes = list(s.notes)
    courses = _build_courses(s, args.seed, notes)
    world = World(s, staff, links, pubs, courses, inputs.region, args.seed)

    print("TCAS matches:")
    for line in anchor_lines(world, anchors):
        print(f"  {line}")
    for n in notes:
        print(f"note: {n}")
    for i, slug in enumerate(UPLOAD_ORDER, 1):
        rows_ = build_rows(slug, world, random.Random(args.seed))
        path = write_dataset(out, i, slug, rows_)
        print(f"wrote {path} ({len(rows_)} rows)")
    readme = write_readme(out, world, anchors, notes, inputs.university)
    print(f"wrote {readme}")
    print(f"Next: open {readme} and follow it.")
    return 0


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        return run(args)
    except InputError as err:
        print(str(err))
        return 2
    except SystemExit as e:  # --help
        return int(e.code or 0)


if __name__ == "__main__":
    sys.exit(main())
