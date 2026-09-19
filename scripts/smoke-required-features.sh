#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
from collections import Counter

html=Path('index.html').read_text(encoding='utf-8')

class P(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids=[]
        self.views=[]
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if a.get('id'): self.ids.append(a['id'])
        if tag=='button' and a.get('data-view'): self.views.append(a['data-view'])

p=P();p.feed(html)
counts=Counter(p.ids)
dup=[x for x,n in counts.items() if n>1]
assert not dup, f'duplicate DOM ids: {dup}'
missing=[v for v in p.views if v not in counts]
assert not missing, f'navigation targets without DOM views: {missing}'

required_ids=['authScreen','leads','pipeline','offers','offerpipeline','offerPipelineBoard','mail','mailSearch','activity','activityReport','reportLoad','contactBlock']
for x in required_ids:
    assert counts[x]==1, f'missing required DOM id: {x}'

for marker in [
    'lm-required-views-v1',
    'lm-report-lazy-guard-v1',
    'lm-followup-recipient-v9',
    'AI sender aldrig selv',
    "const OFFER_PIPE_STATUSES=['I GANG','PÅ PAUSE','VUNDET','TABT','STATUS UKLAR']",
    "reportFetch('crm_activities','created_at'",
    "reportFetch('crm_mail_messages','message_at'",
    "reportFetch('crm_leads','updated_at'",
    "reportFetch('crm_offers','sent_date'",
    "method:'offer_pipeline_drag_drop'",
    'data-report-range="today"',
    'data-report-range="week"',
    'data-report-range="month"',
    'data-report-range="30"',
    'id="executiveMetrics"',
    'id="executiveAttention"',
    'id="executivePerformance"',
    'id="executivePipeline"',
    'id="executiveActivity"',
    'executive-dashboard-v1.css',
    'executive-dashboard-v1.js',
    'let startAppPromise=null',
    "$('loading').classList.add('hidden')",
]:
    assert marker in html, f'missing required marker: {marker}'

assert 'data-view="opportunities"' not in html, 'opportunities navigation returned'
assert 'id="opportunities"' not in html, 'opportunities view returned'
assert 'id="dashOpps"' not in html, 'dashboard opportunities card returned'
assert 'function renderOpps()' not in html, 'opportunities renderer returned'
assert 'id="mailSearch"' in html, 'mail search input missing'
assert "$('mailSearch').oninput=renderMail" in html, 'mail search handler missing'
assert 'Godkendt – sendes automatisk' not in html, 'automatic-send wording returned'
print('PASS: DOM navigation, offer pipeline, activity report and manual-mail policy')
PY

python3 - <<'PY'
import re
from pathlib import Path
s=Path('index.html').read_text(encoding='utf-8')
m=re.search(r'<script id="lm-required-views-v1">(.*?)</script>',s,re.S)
assert m, 'required views JS missing'
Path('/tmp/required-views.js').write_text(m.group(1),encoding='utf-8')
PY
node --check /tmp/required-views.js
node --check executive-dashboard-v1.js
node --check lead-manager-theme-v2.js
node --check api/app.js
python3 - <<'PY'
import base64, hashlib
from pathlib import Path
parts=[Path(f'assets/lead-manager-logo.webp.b64.{i}').read_text(encoding='utf-8').strip() for i in range(4)]
raw=base64.b64decode(''.join(parts), validate=True)
assert len(raw)==10508, f'official logo byte size changed: {len(raw)}'
assert hashlib.sha256(raw).hexdigest()=='4395d23c3a8dbf5e14d2a98179a4de21ade88ab32190ad0450545489d3d32456', 'official logo hash mismatch'
assert raw[:4]==b'RIFF' and raw[8:12]==b'WEBP', 'official logo is not valid WebP'
js=Path('lead-manager-theme-v2.js').read_text(encoding='utf-8')
assert "data:image/webp;base64," in js, 'sidebar logo data URI missing'
for i in range(4):
    assert f'/assets/lead-manager-logo.webp.b64.{i}' in js, f'logo chunk {i} not loaded'
print('PASS: official Lead Manager sidebar logo assets')
PY
node --check saas-credit-check-v1.js
node --check saas-regression-center-v1.js
node scripts/test-executive-dashboard-clock.js
node scripts/test-layout-overlaps.js
node scripts/test-pipeline-drag.js
node scripts/test-regression-guards.js
test -s executive-dashboard-v1.css
test -s lead-manager-theme-v2.css
grep -q 'lead-manager-theme-v2.css' index.html
grep -q 'lead-manager-theme-v2.js' index.html
for page in login.html microsoft-setup.html minuba-setup.html privacy.html; do
  grep -q 'lead-manager-theme-v2.css' "$page"
done
grep -q "function dashboardNow" executive-dashboard-v1.js
grep -q "method:'HEAD'" executive-dashboard-v1.js
grep -q "serverClockMs" executive-dashboard-v1.js
grep -Eq "saas-credit-check-v1.js\?v=[0-9A-Za-z_-]+" api/app.js
grep -Eq "saas-regression-center-v1.js\?v=[0-9A-Za-z_-]+" api/app.js
grep -q "functions/v1/credit-check" saas-credit-check-v1.js
grep -q "Tjekket opretter ikke et lead" saas-credit-check-v1.js
grep -q "ikke RKI" saas-credit-check-v1.js
grep -q "crm_credit_checks" supabase/migrations/20260902070000_credit_checks.sql
grep -q "enable row level security" supabase/migrations/20260902070000_credit_checks.sql
grep -q "APICVR.dk / CVR" supabase/functions/credit-check/index.ts
grep -q "AbortSignal.timeout" supabase/functions/credit-check/index.ts

bash scripts/verify-repository-baseline.sh

echo 'Required feature smoke passed.'
