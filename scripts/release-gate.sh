#!/usr/bin/env bash
set -euo pipefail

echo "== Lead Manager release gate =="

bash scripts/verify-repository-baseline.sh
bash scripts/smoke-required-features.sh

node --check saas-onboarding-v5.js
node --check saas-microsoft-v1.js
node --check access-bootstrap-v1.js
node --check mfa-gate-v1.js
node --check saas-admin-client-switcher-v1.js
node --check saas-crm-integrations-v1.js
node --check offer-mail-v1.js
node --check saas-mail-providers-v1.js

if grep -nE 'MutationObserver|setInterval\s*\(' saas-onboarding-v5.js; then
  echo "FAIL: onboarding must remain event-driven." >&2
  exit 1
fi

grep -q 'authInit deferred to access-bootstrap-v1.js' api/app.js
grep -q 'access-bootstrap-v1.js' api/app.js
grep -q '/saas-onboarding-v5.js?v=' access-bootstrap-v1.js
grep -q 'saas-mail-providers-v1.js' access-bootstrap-v1.js
grep -q 'saas-crm-integrations-v1.js' access-bootstrap-v1.js

echo "PASS: release gate"
