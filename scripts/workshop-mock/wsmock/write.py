"""Write the xlsx files and the attendee-facing README.txt."""
from __future__ import annotations

import datetime as dt
import io
import re
import zipfile
from pathlib import Path

import openpyxl

from .datasets import SHEETS, UPLOAD_ORDER, World
from .inputs import Anchor

# The dataset page names in the app (the `title` of each import dataset declaration).
PAGE_TITLES: dict[str, str] = {
    "faculties": "Faculties",
    "departments": "Departments",
    "programmes": "Programmes",
    "faculty-members": "Staff",
    "program-faculty": "Programme teaching staff",
    "programme-courses": "Programme course lists",
    "research-outputs": "Publications",
    "admission-campaigns": "Admission Campaigns",
    "enrollment-metrics": "Enrolment",
    "student-cohorts": "Student Cohorts",
    "alumni-cohorts": "Alumni Cohorts",
    "financial-metrics": "Finance",
    "faculty-budgets": "Budgets",
    "graduate-outcomes": "Graduate Outcomes",
    "employer-feedback": "Employer Feedback",
    "digital-competency-cohorts": "Digital Competency — Cohorts",
    "digital-competency-modules": "Digital Competency — Modules",
    "course-evaluations": "Course Evaluations",
    "population-projections": "Population Projections",
    "career-skill-demand": "Career Skill Demand",
}

# characters a spreadsheet cannot hold (a PDF can hand over NUL for a mark its font lacks)
ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

_FIXED = dt.datetime(2000, 1, 1, 0, 0, 0)
_ZIP_TIME = (2000, 1, 1, 0, 0, 0)


def file_name(index: int, slug: str) -> str:
    return f"{index:02d}-{slug}.xlsx"


def write_dataset(out: Path, index: int, slug: str, rows) -> Path:
    """One sheet named as the app expects, headers in row 1. Text stays text; None stays empty."""
    sheet_name, headers = SHEETS[slug]
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name
    ws.append(headers)
    for r in rows:
        ws.append([ILLEGAL.sub("", v) if isinstance(v, str) else v for v in (r.get(h) for h in headers)])
    for row in ws.iter_rows(min_row=2):
        for c in row:
            if isinstance(c.value, str):
                c.data_type = "s"  # never a formula or a number, whatever the text looks like
            elif isinstance(c.value, dt.date):
                c.number_format = "yyyy-mm-dd"
    wb.properties.created = _FIXED
    wb.properties.modified = _FIXED
    buf = io.BytesIO()
    wb.save(buf)
    # openpyxl stamps each zip entry with the clock; fix it so a rerun is byte-identical
    src = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
    final = io.BytesIO()
    with zipfile.ZipFile(final, "w", zipfile.ZIP_DEFLATED) as dst:
        for name in sorted(src.namelist()):
            info = zipfile.ZipInfo(name, _ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            dst.writestr(info, src.read(name))
    path = Path(out) / file_name(index, slug)
    path.write_bytes(final.getvalue())
    return path


def anchor_lines(world: World, anchors: list[Anchor]) -> list[str]:
    """One line per anchor: the TCAS row it was matched to and the mock programme it became."""
    lines: list[str] = []
    for a in anchors:
        prog = next((p for p in world.slice.programmes
                     if p.is_anchor and p.name_th == a.programme_th and p.level == a.input.level), None)
        code = prog.code if prog else "?"
        if a.course_codes:
            first = a.course_codes[0]
            more = f" (+{len(a.course_codes) - 1} more codes)" if len(a.course_codes) > 1 else ""
            lines.append(f"{a.input.name} -> programme {code}: TCAS course code {first}{more}, "
                         f"faculty '{a.faculty_th}', programme '{a.programme_th}'")
        else:
            lines.append(f"{a.input.name} -> programme {code} ({a.input.level}): "
                         f"no TCAS row (only bachelor programmes have TCAS rows), faculty '{a.faculty_th}'")
    return lines


def write_readme(out: Path, world: World, anchors: list[Anchor], notes: list[str],
                 university: str | None = None) -> Path:
    uni = university or ""
    L: list[str] = []
    L += ["WORKSHOP MOCK DATA - what to do next", "=" * 40, "",
          "These files are MOCK data. They are not your university's real figures.",
          "Do not show them to anyone as real results.",
          "",
          "1. Organisation profile",
          "-" * 24,
          "In the app, open the organisation profile page and type these two values exactly:",
          f"  University name (Thai): {uni}",
          f"  Region (English): {world.region}",
          "",
          "2. Upload the files in this order",
          "-" * 33,
          "Open each dataset page in the app's data import area and upload the file.",
          "Upload in this order. Later files refer to codes in earlier ones.", ""]
    for i, slug in enumerate(UPLOAD_ORDER, 1):
        L.append(f"  {i:2d}. {file_name(i, slug):<46} dataset page: {PAGE_TITLES[slug]}")
    L += ["",
          "University Rankings: this one has no file. Download the app's pre-filled",
          "template and upload it unchanged.",
          "",
          "3. Run these connectors",
          "-" * 23,
          "  tcas              needed. Links the public TCAS admission rows to the mock programmes.",
          "  un-wpp            needed. Loads the public UN population projections.",
          "  kmitl-skill-mapping  optional. Adds public job-skill demand.",
          "  openalex-works    will NOT match. The mock staff are tokens (Lecturer 001 and so on),",
          "                    not real people, so there is nothing for it to find. Skip it.",
          "",
          "4. Which TCAS row anchors which programme",
          "-" * 41,
          "Check that each match below is the programme you meant. If one is wrong, add",
          "`tcas_code = \"...\"` to that [[programme]] block in your input file and run again.", ""]
    L += [f"  {x}" for x in anchor_lines(world, anchors)]
    L += ["", "5. Notes from this run", "-" * 22]
    L += [f"  - {n}" for n in notes] if notes else ["  (none)"]
    L += ["", "6. How to remove the mock data", "-" * 30,
          "On each dataset page use Start over, in the REVERSE of the upload order:",
          "from Career Skill Demand (20) back to Faculties (1). Programmes cannot be cleared",
          "while metric rows still depend on them, so go in that order.",
          "Then delete the generated folder.",
          ""]
    path = Path(out) / "README.txt"
    path.write_text("\n".join(L), encoding="utf-8")
    return path
