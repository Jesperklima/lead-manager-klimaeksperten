#!/usr/bin/env bash
set -euo pipefail

[[ -f index.html ]] || { echo "ERROR: index.html missing" >&2; exit 1; }
ACTUAL_BYTES="$(wc -c < index.html | tr -d ' ')"
[[ "$ACTUAL_BYTES" -ge 150000 ]] || { echo "ERROR: index.html unexpectedly small: $ACTUAL_BYTES bytes" >&2; exit 1; }

for marker in   'lm-report-lazy-guard-v1'   'lm-followup-recipient-v9'   'AI sender aldrig selv'   'function setText(id,value)'   "console.error('Renderfejl i '+name,error)"; do
  grep -q "$marker" index.html || { echo "ERROR: required marker missing: $marker" >&2; exit 1; }
done

! grep -q 'Godkendt – sendes automatisk' index.html || { echo "ERROR: automatic-send wording returned" >&2; exit 1; }

if grep -Eqi 'sb_secret_[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{15,}|sk-[A-Za-z0-9_-]{20,}' index.html; then
  echo "ERROR: possible secret pattern found in index.html" >&2
  exit 1
fi

python3 - <<'PY'
import json
with open('vercel.json', encoding='utf-8') as f:
    json.load(f)
with open('baseline/manifest.json', encoding='utf-8') as f:
    m=json.load(f)
markers=set(m.get('verified_markers') or [])
for required in ['lm-report-lazy-guard-v1','lm-followup-recipient-v9','AI sender aldrig selv']:
    assert required in markers, f'baseline manifest missing marker: {required}'
PY

echo "Repository source verified semantically: $ACTUAL_BYTES bytes"
