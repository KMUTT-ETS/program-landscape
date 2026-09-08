#!/usr/bin/env python3
"""Regression suite for the PreToolUse guard.

    python3 scripts/dev-guard/test-guard.py \
        scripts/dev-guard/guard-cases.json \
        scripts/dev-guard/db-destructive-guard.py

Every case is a real (tool, tool_input) payload and the verdict it must get.
The ALLOW cases matter as much as the DENY ones: a guard that refuses ordinary
work gets disabled, and a disabled guard protects nothing.

Add a case here whenever the guard gains a rule — and whenever it produces a
false positive worth keeping, so the exemption cannot regress silently.
"""
import json, subprocess, sys, pathlib
cases = json.loads(pathlib.Path(sys.argv[1]).read_text())
guard = sys.argv[2]
fails = 0
for expected, tool, tool_input in cases:
    payload = json.dumps({"tool_name": tool, "tool_input": tool_input})
    out = subprocess.run([sys.executable, guard], input=payload, capture_output=True, text=True).stdout
    actual = "DENY" if out.strip() else "ALLOW"
    ok = actual == expected
    fails += not ok
    label = json.dumps(tool_input)[:78]
    print(f"{'  ok ' if ok else 'FAIL '}{actual:5} (want {expected:5}) {tool:5} {label}")
print(f"\n{len(cases) - fails}/{len(cases)} correct")
sys.exit(1 if fails else 0)
