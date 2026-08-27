#!/usr/bin/env bash
set -euo pipefail

EXPECTED_BYTES="164375"
EXPECTED_MD5="a9d6fe79e1e3625392b7bdb3598006ef"

[[ -f index.html ]] || { echo "ERROR: index.html missing" >&2; exit 1; }
ACTUAL_BYTES="$(wc -c < index.html | tr -d ' ')"
ACTUAL_MD5="$(md5sum index.html | awk '{print $1}')"

[[ "$ACTUAL_BYTES" == "$EXPECTED_BYTES" ]] || { echo "ERROR: size mismatch: $ACTUAL_BYTES" >&2; exit 1; }
[[ "$ACTUAL_MD5" == "$EXPECTED_MD5" ]] || { echo "ERROR: MD5 mismatch: $ACTUAL_MD5" >&2; exit 1; }

grep -q 'lm-report-lazy-guard-v1' index.html
grep -q 'lm-followup-recipient-v9' index.html
grep -q 'AI sender aldrig selv' index.html
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
assert m['bytes']==164375
assert m['md5']=='a9d6fe79e1e3625392b7bdb3598006ef'
PY

echo "Repository baseline verified: 164375 bytes / a9d6fe79e1e3625392b7bdb3598006ef"
