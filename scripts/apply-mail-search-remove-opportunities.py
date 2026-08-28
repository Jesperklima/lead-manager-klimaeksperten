from pathlib import Path
import hashlib, json, re

root = Path('.')
index = root / 'index.html'
text = index.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'ERROR: {label}: expected exactly 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    '<button class="active" data-view="dashboard">Dashboard</button><button data-view="leads">Alle leads</button><button data-view="pipeline">Pipeline</button><button data-view="offers">Tilbud</button><button data-view="offerpipeline">Tilbudspipeline</button><button data-view="calendar">Kalender</button><button data-view="mail">Mail</button><button data-view="opportunities">Muligheder</button><button data-view="activity">Aktivitetslog</button><button data-view="activityReport">Aktivitetsrapport</button><button data-view="approvals">Godkendelser</button><button data-view="leadmanager">Lead Manager</button><button data-view="agents">Agenter</button>',
    '<button class="active" data-view="dashboard">Dashboard</button><button data-view="leads">Alle leads</button><button data-view="pipeline">Pipeline</button><button data-view="offers">Tilbud</button><button data-view="offerpipeline">Tilbudspipeline</button><button data-view="calendar">Kalender</button><button data-view="mail">Mail</button><button data-view="activity">Aktivitetslog</button><button data-view="activityReport">Aktivitetsrapport</button><button data-view="approvals">Godkendelser</button><button data-view="leadmanager">Lead Manager</button><button data-view="agents">Agenter</button>',
    'remove opportunities navigation'
)

replace_once(
    '<div class="grid3"><div class="card section"><h2>Nye mails</h2><div id="dashMail"></div></div><div class="card section"><h2>Muligheder</h2><div id="dashOpps"></div></div><div class="card section"><h2>Kræver handling</h2><div id="dashApprovals"></div></div></div>',
    '<div class="grid2"><div class="card section"><h2>Nye mails</h2><div id="dashMail"></div></div><div class="card section"><h2>Kræver handling</h2><div id="dashApprovals"></div></div></div>',
    'remove dashboard opportunities card'
)

replace_once(
    '<section id="mail" class="view"><div class="card"><div class="section"><h2>CRM-mailjournal</h2><div class="sub">Synkroniserede mails fra js@klimaeksperten.dk. Pilotens Gmail-sync kører via den forbundne konto.</div></div><div id="mailFeed" style="margin-top:10px"></div></div></section>',
    '<section id="mail" class="view"><div class="card"><div class="section"><h2>CRM-mailjournal</h2><div class="sub">Synkroniserede mails fra js@klimaeksperten.dk. Pilotens Gmail-sync kører via den forbundne konto.</div></div><div class="card" style="margin:12px 0;padding:10px"><input id="mailSearch" placeholder="Søg i emne, mailtekst, afsender, modtager eller virksomhed…" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:9px"></div><div id="mailFeed" style="margin-top:10px"></div></div></section>',
    'add mail search input'
)

replace_once(
    '<section id="opportunities" class="view"><div class="tablewrap"><table><thead><tr><th>Virksomhed</th><th>Mulighed</th><th>Status</th><th>Værdi</th><th>Deadline</th><th>Kilde</th></tr></thead><tbody id="oppRows"></tbody></table></div></section>\n',
    '',
    'remove opportunities view'
)

replace_once(
    'function render(){renderMetrics();renderTasks();renderRows();renderKanban();renderOffers();renderCalendar();renderActivity();renderMail();renderOpps();renderApprovals();renderAgents();renderLeadManager();renderIntegrations();renderDashCards();}',
    'function render(){renderMetrics();renderTasks();renderRows();renderKanban();renderOffers();renderCalendar();renderActivity();renderMail();renderApprovals();renderAgents();renderLeadManager();renderIntegrations();renderDashCards();}',
    'remove renderOpps call'
)

old_mail = "function renderMail(){const arr=state.mail.slice(0,150);$('mailFeed').innerHTML=arr.length?arr.map(m=>`<div class=\"mailrow\"><div><span class=\"badge mail\">${m.direction==='inbound'?'Ind':'Ud'}</span><div class=\"sub\" style=\"margin-top:5px\">${fmt(m.message_at)}</div></div><div><strong>${esc(m.subject||'(uden emne)')}</strong><div class=\"sub\">${esc(company(m.company_id).name||'Ikke koblet')} · ${esc(m.from_email||'')}</div><div class=\"mailbody\">${esc(m.body_text||'')}</div></div><div><button class=\"btn small\" ${m.lead_id?`data-open-lead=\"${m.lead_id}\"`:''}>${m.lead_id?'Åbn lead':'Ikke koblet'}</button></div></div>`).join(''):'<div class=\"empty\">Ingen mails er synkroniseret endnu.</div>';wireLeadButtons();}"
new_mail = "function renderMail(){const q=($('mailSearch')?.value||'').trim().toLowerCase();const arr=state.mail.filter(m=>{const hay=[m.subject,m.body_text,m.from_email,m.to_email,company(m.company_id).name].filter(Boolean).join(' ').toLowerCase();return !q||hay.includes(q)}).slice(0,150);$('mailFeed').innerHTML=arr.length?arr.map(m=>`<div class=\"mailrow\"><div><span class=\"badge mail\">${m.direction==='inbound'?'Ind':'Ud'}</span><div class=\"sub\" style=\"margin-top:5px\">${fmt(m.message_at)}</div></div><div><strong>${esc(m.subject||'(uden emne)')}</strong><div class=\"sub\">${esc(company(m.company_id).name||'Ikke koblet')} · ${esc(m.from_email||'')}</div><div class=\"mailbody\">${esc(m.body_text||'')}</div></div><div><button class=\"btn small\" ${m.lead_id?`data-open-lead=\"${m.lead_id}\"`:''}>${m.lead_id?'Åbn lead':'Ikke koblet'}</button></div></div>`).join(''):`<div class=\"empty\">${q?'Ingen mails matcher søgningen.':'Ingen mails er synkroniseret endnu.'}</div>`;wireLeadButtons();}"
replace_once(old_mail, new_mail, 'replace mail renderer with searchable renderer')

opp_fn = re.compile(r"\nfunction renderOpps\(\)\{.*?\}\nfunction renderApprovals\(\)", re.S)
m = opp_fn.search(text)
if not m:
    raise SystemExit('ERROR: renderOpps function not found exactly before renderApprovals')
text = text[:m.start()] + '\nfunction renderApprovals()' + text[m.end():]

old_dash = "function renderDashCards(){$('dashMail').innerHTML=state.mail.slice(0,3).map(m=>`<div class=\"task\"><div><strong>${esc(m.subject||'(uden emne)')}</strong><div class=\"sub\">${esc(company(m.company_id).name||m.from_email||'')}</div></div></div>`).join('')||'<div class=\"sub\">Ingen nye mails.</div>';$('dashOpps').innerHTML=state.opps.slice(0,3).map(o=>`<div class=\"task\"><div><strong>${esc(o.title)}</strong><div class=\"sub\">${esc(company(o.company_id).name||'')} · ${esc(o.status)}</div></div></div>`).join('')||'<div class=\"sub\">Ingen muligheder endnu.</div>';$('dashApprovals').innerHTML=state.approvals.filter(a=>a.status==='pending').slice(0,3).map(a=>`<div class=\"task\"><div><strong>${esc(a.action_type)}</strong><div class=\"sub\">${fmt(a.created_at)}</div></div></div>`).join('')||'<div class=\"sub\">Intet afventer.</div>'; }"
new_dash = "function renderDashCards(){$('dashMail').innerHTML=state.mail.slice(0,3).map(m=>`<div class=\"task\"><div><strong>${esc(m.subject||'(uden emne)')}</strong><div class=\"sub\">${esc(company(m.company_id).name||m.from_email||'')}</div></div></div>`).join('')||'<div class=\"sub\">Ingen nye mails.</div>';$('dashApprovals').innerHTML=state.approvals.filter(a=>a.status==='pending').slice(0,3).map(a=>`<div class=\"task\"><div><strong>${esc(a.action_type)}</strong><div class=\"sub\">${fmt(a.created_at)}</div></div></div>`).join('')||'<div class=\"sub\">Intet afventer.</div>'; }"
replace_once(old_dash, new_dash, 'remove dashboard opportunities renderer')

replace_once(
    "$('offerSearch').oninput=renderOffers;$('offerStatusFilter').onchange=renderOffers;",
    "$('offerSearch').oninput=renderOffers;$('offerStatusFilter').onchange=renderOffers;$('mailSearch').oninput=renderMail;",
    'wire mail search input'
)

text = text.replace(",opportunities:'◇'", "")
text = text.replace(",opportunities:'Dokumenterede muligheder og projekter.'", "")

for forbidden in ['data-view="opportunities"', 'id="opportunities"', 'id="dashOpps"', 'function renderOpps()']:
    if forbidden in text:
        raise SystemExit(f'ERROR: forbidden opportunities UI marker remains: {forbidden}')
for required in ['id="mailSearch"', "$('mailSearch').oninput=renderMail", "const q=($('mailSearch')?.value||'').trim().toLowerCase()"]:
    if required not in text:
        raise SystemExit(f'ERROR: required mail search marker missing: {required}')

index.write_text(text, encoding='utf-8', newline='')
raw = index.read_bytes()
new_bytes = len(raw)
new_md5 = hashlib.md5(raw).hexdigest()

manifest_path = root / 'baseline' / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['previous_repository'] = {
    'bytes': manifest.get('repository_bytes'),
    'md5': manifest.get('repository_md5'),
    'change': manifest.get('change')
}
manifest['repository_bytes'] = new_bytes
manifest['repository_md5'] = new_md5
manifest['change'] = 'add mail search and remove opportunities UI'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

verify_path = root / 'scripts' / 'verify-repository-baseline.sh'
verify = verify_path.read_text(encoding='utf-8')
verify, n1 = re.subn(r'EXPECTED_BYTES="\d+"', f'EXPECTED_BYTES="{new_bytes}"', verify, count=1)
verify, n2 = re.subn(r'EXPECTED_MD5="[0-9a-f]{32}"', f'EXPECTED_MD5="{new_md5}"', verify, count=1)
verify, n3 = re.subn(r"assert m\['repository_bytes'\]==\d+", f"assert m['repository_bytes']=={new_bytes}", verify, count=1)
verify, n4 = re.subn(r"assert m\['repository_md5'\]=='[0-9a-f]{32}'", f"assert m['repository_md5']=='{new_md5}'", verify, count=1)
verify, n5 = re.subn(r'echo "Repository source verified: \d+ bytes / [0-9a-f]{32}"', f'echo "Repository source verified: {new_bytes} bytes / {new_md5}"', verify, count=1)
if (n1,n2,n3,n4,n5) != (1,1,1,1,1):
    raise SystemExit(f'ERROR: verifier replacements failed: {(n1,n2,n3,n4,n5)}')
verify_path.write_text(verify, encoding='utf-8')

smoke_path = root / 'scripts' / 'smoke-required-features.sh'
smoke = smoke_path.read_text(encoding='utf-8')
smoke = smoke.replace("'mail','activity','activityReport'", "'mail','mailSearch','activity','activityReport'", 1)
needle = "assert 'Godkendt – sendes automatisk' not in html, 'automatic-send wording returned'"
insert = """assert 'data-view=\"opportunities\"' not in html, 'opportunities navigation returned'\nassert 'id=\"opportunities\"' not in html, 'opportunities view returned'\nassert 'id=\"dashOpps\"' not in html, 'dashboard opportunities card returned'\nassert 'function renderOpps()' not in html, 'opportunities renderer returned'\nassert 'id=\"mailSearch\"' in html, 'mail search input missing'\nassert \"$('mailSearch').oninput=renderMail\" in html, 'mail search handler missing'\n""" + needle
if needle not in smoke:
    raise SystemExit('ERROR: smoke insertion point missing')
smoke = smoke.replace(needle, insert, 1)
smoke_path.write_text(smoke, encoding='utf-8')

print(f'PATCHED: {new_bytes} bytes / {new_md5}')
