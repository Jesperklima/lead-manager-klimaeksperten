from pathlib import Path
import hashlib, json, re

root = Path('.')
index = root / 'index.html'
text = index.read_text(encoding='utf-8')


def once(old, new, label):
    global text
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'ERROR: {label}: expected 1 match, found {n}')
    text = text.replace(old, new, 1)


def regex_once(pattern, replacement, label, flags=0):
    global text
    text2, n = re.subn(pattern, replacement, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f'ERROR: {label}: expected 1 match, found {n}')
    text = text2

# 1) Remove Opportunities from visible navigation.
once(
    '<button data-view="mail">Mail</button><button data-view="opportunities">Muligheder</button><button data-view="activity">Aktivitetslog</button>',
    '<button data-view="mail">Mail</button><button data-view="activity">Aktivitetslog</button>',
    'remove opportunities navigation',
)

# 2) Remove Opportunities card from dashboard, keeping the two useful cards.
once(
    '<div class="grid3"><div class="card section"><h2>Nye mails</h2><div id="dashMail"></div></div><div class="card section"><h2>Muligheder</h2><div id="dashOpps"></div></div><div class="card section"><h2>Kræver handling</h2><div id="dashApprovals"></div></div></div>',
    '<div class="grid2"><div class="card section"><h2>Nye mails</h2><div id="dashMail"></div></div><div class="card section"><h2>Kræver handling</h2><div id="dashApprovals"></div></div></div>',
    'remove dashboard opportunities card',
)

# 3) Add a dedicated search box to the mail journal.
once(
    '<section id="mail" class="view"><div class="card"><div class="section"><h2>CRM-mailjournal</h2><div class="sub">Synkroniserede mails fra js@klimaeksperten.dk. Pilotens Gmail-sync kører via den forbundne konto.</div></div><div id="mailFeed" style="margin-top:10px"></div></div></section>',
    '<section id="mail" class="view"><div class="card"><div class="section"><h2>CRM-mailjournal</h2><div class="sub">Synkroniserede mails fra js@klimaeksperten.dk. Pilotens Gmail-sync kører via den forbundne konto.</div></div><div class="card" style="margin:12px 0;padding:10px"><input id="mailSearch" placeholder="Søg i emne, mailtekst, afsender, modtager eller virksomhed…" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:9px"></div><div id="mailFeed" style="margin-top:10px"></div></div></section>',
    'add mail search input',
)

# 4) Remove the standalone Opportunities view.
regex_once(
    r'\n<section id="opportunities" class="view">.*?</section>',
    '',
    'remove opportunities view',
    re.S,
)

# 5) Stop rendering Opportunities.
once(
    'function render(){renderMetrics();renderTasks();renderRows();renderKanban();renderOffers();renderCalendar();renderActivity();renderMail();renderOpps();renderApprovals();renderAgents();renderLeadManager();renderIntegrations();renderDashCards();}',
    'function render(){renderMetrics();renderTasks();renderRows();renderKanban();renderOffers();renderCalendar();renderActivity();renderMail();renderApprovals();renderAgents();renderLeadManager();renderIntegrations();renderDashCards();}',
    'remove renderOpps call',
)

# 6) Replace mail renderer and remove Opportunities renderer as one structural block.
new_mail = r'''function renderMail(){const q=($('mailSearch')?.value||'').trim().toLowerCase();const arr=state.mail.filter(m=>{const hay=[m.subject,m.body_text,m.from_email,m.to_email,company(m.company_id).name].filter(Boolean).join(' ').toLowerCase();return !q||hay.includes(q)}).slice(0,150);$('mailFeed').innerHTML=arr.length?arr.map(m=>`<div class="mailrow"><div><span class="badge mail">${m.direction==='inbound'?'Ind':'Ud'}</span><div class="sub" style="margin-top:5px">${fmt(m.message_at)}</div></div><div><strong>${esc(m.subject||'(uden emne)')}</strong><div class="sub">${esc(company(m.company_id).name||'Ikke koblet')} · ${esc(m.from_email||'')}</div><div class="mailbody">${esc(m.body_text||'')}</div></div><div><button class="btn small" ${m.lead_id?`data-open-lead="${m.lead_id}"`:''}>${m.lead_id?'Åbn lead':'Ikke koblet'}</button></div></div>`).join(''):`<div class="empty">${q?'Ingen mails matcher søgningen.':'Ingen mails er synkroniseret endnu.'}</div>`;wireLeadButtons();}
function renderApprovals()'''
regex_once(
    r'function renderMail\(\)\{.*?\}\nfunction renderOpps\(\)\{.*?\}\nfunction renderApprovals\(\)',
    lambda _m: new_mail,
    'replace mail renderer and remove opportunities renderer',
    re.S,
)

# 7) Remove dashboard Opportunities rendering structurally.
new_dash = r'''function renderDashCards(){$('dashMail').innerHTML=state.mail.slice(0,3).map(m=>`<div class="task"><div><strong>${esc(m.subject||'(uden emne)')}</strong><div class="sub">${esc(company(m.company_id).name||m.from_email||'')}</div></div></div>`).join('')||'<div class="sub">Ingen nye mails.</div>';$('dashApprovals').innerHTML=state.approvals.filter(a=>a.status==='pending').slice(0,3).map(a=>`<div class="task"><div><strong>${esc(a.action_type)}</strong><div class="sub">${fmt(a.created_at)}</div></div></div>`).join('')||'<div class="sub">Intet afventer.</div>';}
function wireLeadButtons'''
regex_once(
    r'function renderDashCards\(\)\{.*?\}\nfunction wireLeadButtons',
    lambda _m: new_dash,
    'remove dashboard opportunities renderer',
    re.S,
)

# 8) Live filtering while typing.
once(
    "$('offerSearch').oninput=renderOffers;$('offerStatusFilter').onchange=renderOffers;",
    "$('offerSearch').oninput=renderOffers;$('offerStatusFilter').onchange=renderOffers;$('mailSearch').oninput=renderMail;",
    'wire mail search',
)

# 9) Remove dead visual metadata for the removed view.
text = text.replace(",opportunities:'◇'", '')
text = text.replace(",opportunities:'Dokumenterede muligheder og projekter.'", '')

for forbidden in [
    'data-view="opportunities"',
    'id="opportunities"',
    'id="dashOpps"',
    'function renderOpps()',
]:
    if forbidden in text:
        raise SystemExit(f'ERROR: forbidden Opportunities UI remains: {forbidden}')

for required in [
    'id="mailSearch"',
    "$('mailSearch').oninput=renderMail",
    "const q=($('mailSearch')?.value||'').trim().toLowerCase()",
    'Ingen mails matcher søgningen.',
    'AI sender aldrig selv',
]:
    if required not in text:
        raise SystemExit(f'ERROR: required marker missing: {required}')

index.write_text(text, encoding='utf-8')
raw = index.read_bytes()
new_bytes = len(raw)
new_md5 = hashlib.md5(raw).hexdigest()

# Record provenance/checksum without overwriting the original canonical baseline.
manifest_path = root / 'baseline' / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['previous_repository'] = {
    'bytes': manifest.get('repository_bytes'),
    'md5': manifest.get('repository_md5'),
    'change': manifest.get('change'),
}
manifest['repository_bytes'] = new_bytes
manifest['repository_md5'] = new_md5
manifest['change'] = 'add mail search and remove opportunities UI'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

verify_path = root / 'scripts' / 'verify-repository-baseline.sh'
verify = verify_path.read_text(encoding='utf-8')
repls = [
    (r'EXPECTED_BYTES="\d+"', f'EXPECTED_BYTES="{new_bytes}"'),
    (r'EXPECTED_MD5="[0-9a-f]{{32}}"', f'EXPECTED_MD5="{new_md5}"'),
    (r"assert m\['repository_bytes'\]==\d+", f"assert m['repository_bytes']=={new_bytes}"),
    (r"assert m\['repository_md5'\]=='[0-9a-f]{{32}}'", f"assert m['repository_md5']=='{new_md5}'"),
    (r'echo "Repository source verified: \d+ bytes / [0-9a-f]{{32}}"', f'echo "Repository source verified: {new_bytes} bytes / {new_md5}"'),
]
for pat, rep in repls:
    verify, n = re.subn(pat, rep, verify, count=1)
    if n != 1:
        raise SystemExit(f'ERROR: verifier update failed: {pat}')
verify_path.write_text(verify, encoding='utf-8')

smoke_path = root / 'scripts' / 'smoke-required-features.sh'
smoke = smoke_path.read_text(encoding='utf-8')
old_ids = "'mail','activity','activityReport'"
new_ids = "'mail','mailSearch','activity','activityReport'"
if old_ids not in smoke:
    raise SystemExit('ERROR: smoke required-id insertion point missing')
smoke = smoke.replace(old_ids, new_ids, 1)
needle = "assert 'Godkendt – sendes automatisk' not in html, 'automatic-send wording returned'"
if needle not in smoke:
    raise SystemExit('ERROR: smoke assertion insertion point missing')
extra = """assert 'data-view=\"opportunities\"' not in html, 'opportunities navigation returned'\nassert 'id=\"opportunities\"' not in html, 'opportunities view returned'\nassert 'id=\"dashOpps\"' not in html, 'dashboard opportunities card returned'\nassert 'function renderOpps()' not in html, 'opportunities renderer returned'\nassert 'id=\"mailSearch\"' in html, 'mail search input missing'\nassert \"$('mailSearch').oninput=renderMail\" in html, 'mail search handler missing'\n"""
smoke = smoke.replace(needle, extra + needle, 1)
smoke_path.write_text(smoke, encoding='utf-8')

print(f'PATCHED: {new_bytes} bytes / {new_md5}')
