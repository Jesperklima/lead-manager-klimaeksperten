#!/usr/bin/env bash
set -euo pipefail

SOURCE_URL="https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/lead-manager-customer"
EXPECTED_BYTES="164375"
EXPECTED_MD5="a9d6fe79e1e3625392b7bdb3598006ef"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl --fail --silent --show-error --location "$SOURCE_URL" --output "$TMP"

ACTUAL_BYTES="$(wc -c < "$TMP" | tr -d ' ')"
ACTUAL_MD5="$(md5sum "$TMP" | awk '{print $1}')"

printf 'Fetched bytes: %s\n' "$ACTUAL_BYTES"
printf 'Fetched MD5:  %s\n' "$ACTUAL_MD5"

if [[ "$ACTUAL_BYTES" != "$EXPECTED_BYTES" ]]; then
  echo "ERROR: canonical byte-size mismatch" >&2
  exit 1
fi

if [[ "$ACTUAL_MD5" != "$EXPECTED_MD5" ]]; then
  echo "ERROR: canonical MD5 mismatch" >&2
  exit 1
fi

grep -q 'lm-report-lazy-guard-v1' "$TMP"
grep -q 'lm-followup-recipient-v9' "$TMP"
grep -q 'AI sender aldrig selv' "$TMP"
if grep -q 'Godkendt – sendes automatisk' "$TMP"; then
  echo "ERROR: forbidden automatic-send wording found" >&2
  exit 1
fi

mkdir -p baseline
cp "$TMP" index.html
cat > baseline/manifest.json <<EOF
{
  "source": "$SOURCE_URL",
  "snapshot": "lead_manager_canonical_baseline_20260827_1242",
  "active_snapshot": "lead_manager_customer_v9_followup_recipient_fix",
  "bytes": $EXPECTED_BYTES,
  "md5": "$EXPECTED_MD5",
  "verified_markers": [
    "lm-report-lazy-guard-v1",
    "lm-followup-recipient-v9",
    "AI sender aldrig selv"
  ]
}
EOF

echo "Canonical baseline verified successfully."
