#!/usr/bin/env bash
set -euo pipefail

[[ -f index.html ]] || { echo "ERROR: index.html missing" >&2; exit 1; }

ACTUAL_BYTES="$(wc -c < index.html | tr -d ' ')"
if [[ "$ACTUAL_BYTES" -lt 150000 ]]; then
  echo "ERROR: index.html unexpectedly small: $ACTUAL_BYTES bytes" >&2
  exit 1
fi

grep -q 'lm-report-lazy-guard-v1' index.html
grep -q 'lm-followup-recipient-v9' index.html
grep -q 'AI sender aldrig selv' index.html
grep -q 'lm-required-views-v1' index.html
grep -q 'executive-dashboard-v1.js' index.html
! grep -q 'Godkendt – sendes automatisk' index.html

# Reject common server/API secret formats. The existing sb_publishable_ key is browser configuration.
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
assert m.get('source'), 'baseline source missing'
assert m.get('snapshot'), 'baseline snapshot missing'
assert 'verified_markers' in m, 'baseline marker history missing'
PY

echo "Repository source verified structurally: $ACTUAL_BYTES bytes"
