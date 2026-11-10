#!/usr/bin/env bash
# One-shot health check. No network, no API key, no quota.
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"

"$PY" -m py_compile pipeline.py
echo "compile   OK"

"$PY" pipeline.py --selftest
echo "selftest  OK"

"$PY" - <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("pipeline", "pipeline.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

# every category referenced by eval/set.jsonl must have an acceptance threshold
import json
cats = {json.loads(l).get("cat", "default") for l in open("eval/set.jsonl", encoding="utf-8") if l.strip()}
missing = sorted(c for c in cats if c not in m.MIN_CHARS)
assert not missing, "missing MIN_CHARS for: %s" % missing
print("cats      OK (%d: %s)" % (len(cats), ",".join(sorted(cats))))

# frame rotation must return at least one frame for every category
for c in cats:
    frames = m.FRAME_ROTATION.get(c) or m.FRAME_ROTATION["default"]
    assert frames, "no frames for %s" % c
print("frames    OK")
PY

echo "all checks passed"
