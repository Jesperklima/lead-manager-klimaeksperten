(()=>{
'use strict';
const API='https://ouqhostcsvdyrkjefiya.supabase.co';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
const C={partners:[],connections:[],freshKeys:new Map(),busy:false};
const label={generic:'Partner API / webhook',website:'Hjemmeside / formular',google:'Google Ads Lead Forms',meta:'Meta / Facebook / Instagram',linkedin:'LinkedIn Lead Sync'};
const ready=()=>typeof state!=='undefined'&&state?.client?.id&&typeof supabase!=='undefined';
const hook=id=>`${API}/functions/v1/marketing-webhook?connection_id=${encodeURIComponent(id)}`;
function msg(t){const e=$('mkConnMsg');if(e)e.textContent=t||'';if(t&&typeof toast==='function')toast(t)}
async function copy(v){try{await navigator.clipboard.writeText(v);msg('Kopieret.')}catch{msg('Kunne ikke kopiere automatisk.')}}
function contractHtml(){return `<details style="margin-top:12px"><summary><strong>Standard webhook format</strong></summary><div class="sub" style="margin-top:8px">Skarp Studio sender rå signaler. Lead Manager kvalificerer dem. JSON kroppen signeres præcis som den sendes.</div><div class="sub" style="margin-top:8px"><strong>Headers</strong></div><pre style="white-space:pre-wrap;font-size:11px">Content-Type: application/json
X-Skarp-Signature: sha256=&lt;HMAC-SHA256 af rå JSON body med webhook nøglen&gt;
X-Skarp-Timestamp: &lt;unix sekunder ved hvert sendeforsøg&gt;
X-Skarp-Signal-Id: &lt;samme UUID som body.id&gt;</pre><div class="sub"><strong>Fælles konvolut</strong></div><pre style="white-space:pre-wrap;font-size:11px">{
  "event": "post.published | engagement.snapshot | comment.received | connection.test",
  "id": "uuid",
  "occurred_at": "ISO-8601 UTC",
  "partner": "skarp_studio",
  "workspace_id": "Skarp Studio workspace UUID",
  "data": { }
}</pre><div class="sub"><strong>post.published data</strong></div><pre style="white-space:pre-wrap;font-size:11px">{
  "post_id": "Skarp Studio post UUID",
  "lead_campaign_id": "Lead Manager campaign UUID eller null",
  "platform": "facebook | instagram | linkedin",
  "published_at": "ISO-8601 UTC",
  "permalink": "https://... eller null",
  "text_preview": "første 200 tegn"
}</pre><div class="sub"><strong>engagement.snapshot data</strong></div><pre style="white-space:pre-wrap;font-size:11px">{
  "post_id": "Skarp Studio post UUID",
  "lead_campaign_id": "Lead Manager campaign UUID eller null",
  "platform": "facebook | instagram | linkedin",
  "permalink": "https://... eller null",
  "date": "YYYY-MM-DD",
  "impressions": 0,
  "reach": 0,
  "reactions": 0,
  "comments": 0,
  "shares": 0,
  "saves": 0,
  "clicks": 0
}</pre><div class="sub"><strong>comment.received data</strong></div><pre style="white-space:pre-wrap;font-size:11px">{
  "post_id": "Skarp Studio post UUID",
  "lead_campaign_id": "Lead Manager campaign UUID eller null",
  "platform": "facebook | instagram | linkedin",
  "permalink": "https://... eller null",
  "external_comment_id": "platform kommentar id",
  "author_name": "offentligt navn",
  "text": "kommentartekst",
  "commented_at": "ISO-8601 UTC"
}</pre><div class="sub">Lead Manager accepterer maksimalt 10 minutters forskel på X-Skarp-Timestamp. Gentagne signal id'er behandles idempotent.</div></details>`}
function ensure(){const root=$('marketingLeads');if(!root||$('mkConnectionsCard'))return false;const s=document.createElement('style');s.textContent=`#mkConnectionsCard{margin:12px 0}.mkconn-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:12px}.mkconn{border:1px solid var(--border);border-radius:12px;padding:11px;margin-top:8px;background:#fff}.mkconn-head{display:flex;justify-content:space-between;gap:10px}.mkconn-url{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;overflow-wrap:anywhere;padding:8px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;margin-top:7px}.mkconn-secret{padding:9px;border:1px solid #bbf7d0;background:#ecfdf5;border-radius:9px;margin-top:8px}.mkconn-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.mkconn-cred{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.mkconn-status{font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:#eef2f7}.mkconn-status.connected{background:#dcfce7;color:#166534}.mkconn-status.needs_credentials{background:#fff3dd;color:#9a6100}@media(max-width:900px){.mkconn-grid{grid-template-columns:1fr}.mkconn-cred{grid-template-columns:1fr}}`;document.head.appendChild(s);
 const card=document.createElement('div');card.id='mkConnectionsCard';card.className='card';card.innerHTML=`<div class="mkconn-head"><div><strong>Marketingforbindelser</strong><div class="sub">Forbind partnerens kampagner og formularer til Lead Manager. Webhook nøgler vises kun ved oprettelse eller rotation.</div></div><button class="btn small" id="mkConnRefresh">Opdatér</button></div><div class="mkconn-grid"><div id="mkConnList"></div><div><div class="field"><label>Partner</label><select id="mkConnPartner"></select></div><div class="field"><label>Platform</label><select id="mkConnPlatform"><option value="generic">Partner API / webhook</option><option value="website">Hjemmeside / formular</option><option value="google">Google Ads Lead Forms</option><option value="meta">Meta / Facebook / Instagram</option><option value="linkedin">LinkedIn Lead Sync</option></select></div><div class="field"><label>Navn</label><input id="mkConnLabel" placeholder="Fx Skarp Studio forbindelse"></div><button class="btn primary" id="mkConnCreate">Opret forbindelse</button><div class="sub" id="mkConnMsg" style="margin-top:8px"></div>${contractHtml()}</div></div>`;
 const layout=root.querySelector('.mklayout');root.insertBefore(card,layout||root.firstChild);wire();return true}
async function load(){if(!ready()||C.busy)return;C.busy=true;try{const cid=state.client.id,[p,c]=await Promise.all([supabase.from('crm_marketing_partners').select('*').eq('client_id',cid).order('name'),supabase.from('crm_marketing_connections').select('*').eq('client_id',cid).order('created_at',{ascending:false})]);if(p.error)throw p.error;if(c.error)throw c.error;C.partners=p.data||[];C.connections=c.data||[];render()}catch(e){msg(e?.message||e)}finally{C.busy=false}}
function render(){if(!$('mkConnPartner'))return;$('mkConnPartner').innerHTML=C.partners.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');$('mkConnList').innerHTML=C.connections.length?C.connections.map(conn=>{const fresh=C.freshKeys.get(conn.id),last=conn.last_event_at?new Intl.DateTimeFormat('da-DK',{dateStyle:'short',timeStyle:'short'}).format(new Date(conn.last_event_at)):'Ingen events endnu';const creds=conn.platform==='meta'||conn.platform==='linkedin';return `<div class="mkconn"><div class="mkconn-head"><div><strong>${esc(conn.label)}</strong><div class="sub">${esc(label[conn.platform]||conn.platform)} · ${esc(last)}</div></div><span class="mkconn-status ${esc(conn.status)}">${esc(conn.status==='needs_credentials'?'Mangler adgang':conn.status)}</span></div><div class="mkconn-url">${esc(hook(conn.id))}</div>${fresh?`<div class="mkconn-secret"><strong>Webhook nøgle · gem den nu</strong><div class="mkconn-url">${esc(fresh)}</div></div>`:''}${conn.last_error?`<div class="notice" style="margin-top:8px">${esc(conn.last_error)}</div>`:''}<div class="mkconn-actions"><button class="btn small" data-copy-url="${conn.id}">Kopiér URL</button><button class="btn small" data-rotate="${conn.id}">Rotér nøgle</button>${(conn.platform==='generic'||conn.platform==='website')?'<span class="sub">Skarp Studio bruger HMAC signering med denne nøgle.</span>':''}${conn.platform==='google'?'<span class="sub">Nøglen bruges som Google key.</span>':''}${conn.platform==='meta'?'<span class="sub">Nøglen bruges som Meta verify token.</span>':''}</div>${creds?credentialBox(conn):''}${(conn.platform==='generic'||conn.platform==='website')?`<details style="margin-top:8px"><summary class="sub">Direkte lead webhook</summary><pre style="white-space:pre-wrap;font-size:11px">{"event_id":"unik-id","lead_type":"business","full_name":"Navn","company_name":"Firma A/S","cvr":"12345678","email":"mail@firma.dk","phone":"12345678","message":"Vi ønsker et tilbud","campaign_name":"Kampagne","consent_to_contact":true}</pre><div class="sub">Dette simple format bruger headeren <code>x-lead-manager-key</code>. Skarp Studio forbindelsen bruger i stedet den signerede kontrakt ovenfor.</div></details>`:''}</div>`}).join(''):'<div class="empty">Ingen marketingforbindelser endnu.</div>';bindRows()}
function credentialBox(c){if(c.platform==='meta')return `<div class="mkconn-cred"><div class="field"><label>Meta Page Access Token</label><input type="password" data-access="${c.id}" autocomplete="off" placeholder="Gemmes sikkert"></div><div class="field"><label>Meta App Secret</label><input type="password" data-appsecret="${c.id}" autocomplete="off" placeholder="Gemmes sikkert"></div></div><div class="mkconn-actions"><button class="btn small" data-save-creds="${c.id}">Gem Meta adgang</button></div>`;return `<div class="mkconn-cred"><div class="field"><label>LinkedIn Access Token</label><input type="password" data-access="${c.id}" autocomplete="off" placeholder="r_marketing_leadgen_automation"></div><div class="field"><label>LinkedIn Client Secret</label><input type="password" data-appsecret="${c.id}" autocomplete="off" placeholder="Bruges til HMAC validering"></div></div><div class="mkconn-actions"><button class="btn small" data-save-creds="${c.id}">Gem LinkedIn adgang</button></div>`}
function bindRows(){document.querySelectorAll('[data-copy-url]').forEach(b=>b.onclick=()=>copy(hook(b.dataset.copyUrl)));document.querySelectorAll('[data-rotate]').forEach(b=>b.onclick=()=>rotate(b.dataset.rotate));document.querySelectorAll('[data-save-creds]').forEach(b=>b.onclick=()=>saveCreds(b.dataset.saveCreds))}
async function createConn(){const partner=$('mkConnPartner').value,platform=$('mkConnPlatform').value,labelText=$('mkConnLabel').value.trim()||label[platform];if(!partner)return msg('Vælg en marketingpartner.');const {data,error}=await supabase.rpc('crm_marketing_create_connection',{p_partner_id:partner,p_platform:platform,p_label:labelText,p_default_campaign_id:null});if(error)return msg(error.message);if(data?.id&&data?.webhook_key)C.freshKeys.set(data.id,data.webhook_key);$('mkConnLabel').value='';await load();msg('Forbindelsen er oprettet. Kopiér URL og nøgle.')}
async function rotate(id){if(!confirm('Den gamle webhook nøgle stopper med at virke. Fortsæt?'))return;const {data,error}=await supabase.rpc('crm_marketing_rotate_webhook_key',{p_connection_id:id});if(error)return msg(error.message);C.freshKeys.set(id,data);render();msg('Ny webhook nøgle oprettet. Gem den nu.')}
async function saveCreds(id){const a=document.querySelector(`[data-access="${id}"]`),s=document.querySelector(`[data-appsecret="${id}"]`);const access=a?.value.trim(),secret=s?.value.trim();if(!access&&!secret)return msg('Indsæt mindst én credential.');if(access){const r=await supabase.rpc('crm_marketing_store_secret',{p_connection_id:id,p_kind:'access_token',p_value:access});if(r.error)return msg(r.error.message)}if(secret){const r=await supabase.rpc('crm_marketing_store_secret',{p_connection_id:id,p_kind:'app_secret',p_value:secret});if(r.error)return msg(r.error.message)}if(a)a.value='';if(s)s.value='';await load();msg('Platform adgangen er gemt sikkert.')}
function wire(){$('mkConnRefresh').onclick=load;$('mkConnCreate').onclick=createConn}
function init(){if(!ensure()){setTimeout(init,400);return}load()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();setTimeout(init,1000);setInterval(()=>{$('marketingLeads')?.classList.contains('active')&&load()},15000);
})();