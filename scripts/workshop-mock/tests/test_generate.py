import contextlib
import io
import tempfile
import unittest
from pathlib import Path

import openpyxl

import generate
from wsmock.datasets import UPLOAD_ORDER
from wsmock.tcas import TCAS_FILES

HERE = Path(__file__).resolve().parent
FIXTURE = HERE.parent / "fixtures" / "tcas-sample.xlsx"
INPUT = HERE / "fixture-input.toml"
TCAS_ARG = f"{FIXTURE}:2567:3"


def run(argv):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = generate.main(argv)
    return code, buf.getvalue()


class GenerateTests(unittest.TestCase):
    def test_writes_20_files_and_readme_and_is_repeatable(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"
            code, text = run([str(INPUT), "--tcas-file", TCAS_ARG, "--out", str(out)])
            self.assertEqual(code, 0, text)
            files = sorted(p.name for p in out.glob("*.xlsx"))
            self.assertEqual(len(files), 20)
            self.assertEqual(files[0], f"01-{UPLOAD_ORDER[0]}.xlsx")
            self.assertEqual(files[-1], f"20-{UPLOAD_ORDER[-1]}.xlsx")
            self.assertTrue((out / "README.txt").exists())
            self.assertEqual((out / ".gitignore").read_text().strip(), "*")
            self.assertIn("วิศวกรรมวัสดุ", text)  # anchor resolution shown
            first = {p.name: p.read_bytes() for p in out.iterdir() if p.is_file()}
            code, _ = run([str(INPUT), "--tcas-file", TCAS_ARG, "--out", str(out)])
            self.assertEqual(code, 0)
            second = {p.name: p.read_bytes() for p in out.iterdir() if p.is_file()}
            self.assertEqual(first, second)

    def test_tcas_file_is_cached_under_the_download_name(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"
            run([str(INPUT), "--tcas-file", TCAS_ARG, "--out", str(out)])
            name = next(Path(u).name for u, y, r in TCAS_FILES if (y, r) == (2567, "3"))
            self.assertTrue((out / ".cache" / name).exists())
            # a later run needs no --tcas-file
            code, text = run([str(INPUT), "--offline", "--out", str(out)])
            self.assertEqual(code, 0, text)

    def test_thai_name_byte_for_byte(self):
        from wsmock.inputs import load_inputs
        from wsmock.tcas import load_rows, own_rows
        rows = own_rows(load_rows(Path("/x"), offline=True, files=[(FIXTURE, 2567, "3")]),
                        load_inputs(INPUT).university)
        raw = {r.programme for r in rows if "วิศวกรรมวัสดุ" in r.programme}
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            code, _ = run([str(INPUT), "--tcas-file", TCAS_ARG, "--out", str(out)])
            self.assertEqual(code, 0)
            ws = openpyxl.load_workbook(out / "03-programmes.xlsx").worksheets[0]
            names = {ws.cell(r, 2).value for r in range(2, ws.max_row + 1)}
            self.assertTrue(raw & names)

    def test_offline_without_cache_is_an_input_error(self):
        with tempfile.TemporaryDirectory() as d:
            code, text = run([str(INPUT), "--offline", "--out", str(Path(d) / "o")])
            self.assertEqual(code, 2)
            self.assertIn("--offline", text)

    def test_bad_input_and_bad_flags(self):
        with tempfile.TemporaryDirectory() as d:
            code, text = run([str(Path(d) / "missing.toml"), "--out", d])
            self.assertEqual(code, 2)
            self.assertIn("not found", text)
            code, _ = run([str(INPUT), "--tcas-file", "nocolons.xlsx", "--out", d])
            self.assertEqual(code, 2)
            code, _ = run([str(INPUT), "--size", "huge"])
            self.assertEqual(code, 2)

    def test_corrupt_tcas_file_is_an_input_error(self):
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "bad.xlsx"
            bad.write_text("not a spreadsheet")
            code, text = run([str(INPUT), "--tcas-file", f"{bad}:2567:3", "--out", str(Path(d) / "o")])
            self.assertEqual(code, 2)
            self.assertIn("bad.xlsx", text)

    def test_write_dataset_refuses_control_characters(self):
        from wsmock.write import write_dataset
        from wsmock.datasets import SHEETS
        h = SHEETS["faculties"][1]
        row = {k: "x" for k in h}
        row[h[1]] = "bad\x01name"
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError) as cm:
                write_dataset(Path(d), 1, "faculties", [row])
            self.assertIn("faculties", str(cm.exception))
            self.assertIn(h[1], str(cm.exception))
            self.assertIn("row 2", str(cm.exception))

    def test_readme_content(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            run([str(INPUT), "--tcas-file", TCAS_ARG, "--out", str(out)])
            t = (out / "README.txt").read_text(encoding="utf-8")
            for s in ("มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี", "Bangkok", "University Rankings",
                      "un-wpp", "openalex-works", "Start over", "Programme teaching staff", "/admin/data-setup", "/admin/organization", "/admin/data-sources"):
                self.assertIn(s, t)


if __name__ == "__main__":
    unittest.main()
