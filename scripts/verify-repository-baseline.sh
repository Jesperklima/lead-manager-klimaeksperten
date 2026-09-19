#!/usr/bin/env bash
set -euo pipefail

EXPECTED_BYTES="190895"
EXPECTED_GIT_BLOB="6e9da474f836302440bcfc271141f0950697c27e"

[[ -f index.html ]] || { echo "ERROR: index.html missing" >&2; exit 1; }
ACTUAL_BYTES="$(wc -c < index.html | tr -d ' ')"
ACTUAL_GIT_BLOB="$(git hash-object index.html)"

[[ "$ACTUAL_BYTES" == "$EXPECTED_BYTES" ]] || { echo "ERROR: size mismatch: $ACTUAL_BYTES" >&2; exit 1; }
[[ "$ACTUAL_GIT_BLOB" == "$EXPECTED_GIT_BLOB" ]] || { echo "ERROR: Git blob mismatch: $ACTUAL_GIT_BLOB" >&2; exit 1; }

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
assert m['repository_bytes']==190895
assert m['repository_git_blob_sha']=='6e9da474f836302440bcfc271141f0950697c27e'
PY

echo 'Repository source verified: 190895 bytes / git blob 6e9da474f836302440bcfc271141f0950697c27e'
