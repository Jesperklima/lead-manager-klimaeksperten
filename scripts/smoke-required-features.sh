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

required_ids=['authScreen','leads','pipeline','offers','offerpipeline','offerPipelineBoard','mail','activity','activityReport','reportLoad','contactBlock']
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
]:
    assert marker in html, f'missing required marker: {marker}'

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

bash scripts/verify-repository-baseline.sh

echo 'Required feature smoke passed.'
