#!/usr/bin/env bash
set -euo pipefail

FILE=index.html
fail=0
check(){
  local label="$1" pattern="$2"
  if grep -Fq "$pattern" "$FILE"; then
    echo "PASS: $label"
  else
    echo "FAIL: $label -- missing: $pattern"
    fail=1
  fi
}

check "login UI" 'id="loginBtn"'
check "lead list" 'id="leads" class="view"'
check "lead pipeline" 'id="pipeline" class="view"'
check "lead kanban" 'id="kanban"'
check "offers list" 'id="offers" class="view"'
check "offer pipeline navigation" 'data-view="offerpipeline"'
check "offer pipeline view" 'id="offerpipeline"'
check "contact info block" 'id="contactBlock"'
check "mail view" 'id="mail" class="view"'
check "Gmail history UI" 'id="gmailHistoryBlock"'
check "AI mail UI" 'mail-ai-modal'
check "activity log" 'id="activity" class="view"'
check "activity report navigation" 'data-view="activityReport"'
check "activity report view" 'id="activityReport"'
check "report lazy guard" 'lm-report-lazy-guard-v1'
check "manual mail policy" 'AI sender aldrig selv'

if grep -Fq 'Godkendt – sendes automatisk' "$FILE"; then
  echo 'FAIL: forbidden automatic-send wording is present'
  fail=1
else
  echo 'PASS: forbidden automatic-send wording absent'
fi

exit "$fail"
