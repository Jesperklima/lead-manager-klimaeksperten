(()=>{
'use strict';
const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const PROVIDERS={
  microsoft:{label:'Microsoft 365 / Outlook',kind:'oauth',description:'Forbind sikkert med Microsoft-login. Ingen mailadgangskode gemmes i Lead Manager.'},
  google:{label:'Google Workspace / Gmail',kind:'oauth',description:'Forbind sikkert med Google-login. Ingen mailadgangskode gemmes i Lead Manager.'},
  one:{label:'One.com',kind:'imap_smtp',description:'Lead Manager udfylder One.com-serverne automatisk.',imap_host:'imap.one.com',imap_port:993,imap_security:'SSL/TLS',smtp_host:'send.one.com',smtp_port:587,smtp_security:'STARTTLS'},
  simply:{label:'Simply.com',kind:'imap_smtp',description:'Lead Manager udfylder Simply.com-serverne automatisk.',imap_host:'mail.simply.com',imap_port:143,imap_security:'STARTTLS',smtp_host:'smtp.simply.com',smtp_port:587,smtp_security:'STARTTLS'},
  dandomain:{label:'DanDomain',kind:'imap_smtp',description:'Lead Manager udfylder DanDomain-serverne automatisk.',imap_host:'post.dandomain.dk',imap_port:993,imap_security:'SSL/TLS',smtp_host:'asmtp.dandomain.dk',smtp_port:587,smtp_security:'STARTTLS'},
  manual:{label:'Anden mailudbyder',kind:'imap_smtp',description:'Indtast serveroplysningerne fra din mailudbyder.'}
};
let busy=false;

async function session(){if(typeof supabase==='undefined')return null;const {data}=await supabase.auth.getSession();return data?.session||null}
async function edge(name,payload){const s=await session();if(!s?.access_token)throw new Error('Login-session mangler');const r=await fetch(`${API}/functions/v1/${name}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Authorization:'Bearer '+s.access_token},body:JSON.stringify(payload)}),raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw Object.assign(new Error(d.error||`HTTP ${r.status}`),{code:d.code,status:r.status});return d}
function accountDefault(){try{return String(state?.client?.settings?.mail||state?.client?.settings?.microsoft_mail||state?.session?.user?.email||'').trim().toLowerCase()}catch{return''}}
function provider(){return PROVIDERS[$('#lmMailProvider')?.value]||PROVIDERS.one}
function setMessage(text,bad=false,ok=false){const el=$('#lmMailProviderMessage');if(!el)return;el.textContent=text;el.style.color=bad?'#9f1239':ok?'#166534':''}
function setBusy(on,label='Arbejder…'){busy=on;['#lmMailProviderConnect','#lmMailProviderCheck'].forEach(sel=>{const b=$(sel);if(b)b.disabled=on});const b=$('#lmMailProviderConnect');if(b){if(!b.dataset.idle)b.dataset.idle=b.textContent;b.textContent=on?label:(b.dataset.idle||'Forbind')}}
function securityValue(v){return String(v||'').toLowerCase()==='ssl/tls'?'ssl':String(v||'').toLowerCase()}

function renderProviderFields(){
  const key=$('#lmMailProvider')?.value||'one',p=PROVIDERS[key];
  const oauth=$('#lmMailOAuthFields'),smtp=$('#lmMailSmtpFields'),manual=$('#lmMailManualFields'),summary=$('#lmMailPresetSummary'),pass=$('#lmMailPasswordWrap'),user=$('#lmMailUsernameWrap');
  if(!p)return;
  $('#lmMailProviderHelp').textContent=p.description||'';
  oauth.hidden=p.kind!=='oauth';smtp.hidden=p.kind==='oauth';manual.hidden=key!=='manual';pass.hidden=p.kind==='oauth';user.hidden=p.kind==='oauth';
  const account=$('#lmMailAccount');if(account&&!account.value)account.value=accountDefault();
  if(p.kind==='oauth'){
    summary.hidden=true;
    $('#lmMailProviderConnect').textContent=key==='microsoft'?'Forbind Microsoft-konto':'Forbind Google-konto';
    $('#lmMailProviderConnect').dataset.idle=$('#lmMailProviderConnect').textContent;
    return;
  }
  $('#lmMailProviderConnect').textContent='Test og forbind mail';$('#lmMailProviderConnect').dataset.idle='Test og forbind mail';
  if(key==='manual'){summary.hidden=true;return}
  summary.hidden=false;
  summary.innerHTML=`<div class="lm-mail-server"><strong>Indgående mail</strong><span>${esc(p.imap_host)} · port ${p.imap_port} · ${esc(p.imap_security)}</span></div><div class="lm-mail-server"><strong>Udgående mail</strong><span>${esc(p.smtp_host)} · port ${p.smtp_port} · ${esc(p.smtp_security)}</span></div><div class="sub" style="margin-top:7px">Serveroplysningerne udfyldes automatisk. Du skal normalt kun bruge mailadresse og adgangskode.</div>`;
}

function cardCss(){if($('#lmMailProviderCss'))return;const s=document.createElement('style');s.id='lmMailProviderCss';s.textContent=`
#lmMailProviderCard{margin-top:14px}.lm-mail-provider-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.95fr);gap:14px}.lm-mail-provider-box{border:1px solid var(--border);border-radius:12px;padding:12px;background:#f8fafc}.lm-mail-provider-box h3{font-size:14px;margin:0 0 8px}.lm-mail-server{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--border);font-size:12px}.lm-mail-server:first-child{border-top:0}.lm-mail-server span{color:var(--muted);text-align:right}.lm-mail-options{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.lm-mail-options label{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:#fff;border-radius:999px;padding:6px 9px;font-size:12px}.lm-mail-list{display:grid;gap:8px}.lm-mail-account{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;border:1px solid var(--border);border-radius:10px;padding:10px;background:#fff}.lm-mail-account strong{display:block}.lm-mail-account .sub{font-size:11px}.lm-mail-connected{color:#166534;font-weight:800}.lm-mail-manual-grid{display:grid;grid-template-columns:1fr 110px 135px;gap:8px}.lm-mail-manual-grid+.lm-mail-manual-grid{margin-top:8px}@media(max-width:800px){.lm-mail-provider-grid{grid-template-columns:1fr}.lm-mail-manual-grid{grid-template-columns:1fr}}
`;document.head.appendChild(s)}

function inject(){
  if($('#lmMailProviderCard')||typeof state==='undefined'||!state?.client)return false;
  const host=$('#leadmanager');if(!host)return false;cardCss();
  const card=document.createElement('div');card.id='lmMailProviderCard';card.className='card section';
  card.innerHTML=`
    <div class="split" style="align-items:flex-start;justify-content:space-between"><div><h2 style="margin:0 0 4px">Mailkonti</h2><div class="sub">Vælg mailudbyder. Lead Manager udfylder kendte serverindstillinger automatisk og tester forbindelsen, før den gemmes.</div></div><div id="lmMailProviderStatus" class="pill">Kontrollerer…</div></div>
    <div class="lm-mail-provider-grid" style="margin-top:14px">
      <div class="lm-mail-provider-box">
        <div class="field" style="margin-top:0"><label>Mailudbyder</label><select id="lmMailProvider"><option value="microsoft">Microsoft 365 / Outlook</option><option value="google">Google Workspace / Gmail</option><option value="one" selected>One.com</option><option value="simply">Simply.com</option><option value="dandomain">DanDomain</option><option value="manual">Anden mailudbyder</option></select></div>
        <div id="lmMailProviderHelp" class="sub"></div>
        <div class="field"><label>Mailadresse</label><input id="lmMailAccount" type="email" autocomplete="off" placeholder="navn@virksomhed.dk" value="${esc(accountDefault())}"></div>
        <div id="lmMailUsernameWrap" class="field"><label>Brugernavn <span class="sub">(normalt samme som mailadressen)</span></label><input id="lmMailUsername" autocomplete="username" placeholder="navn@virksomhed.dk"></div>
        <div id="lmMailPasswordWrap" class="field"><label>Mailadgangskode</label><input id="lmMailPassword" type="password" autocomplete="new-password" placeholder="Gemmes krypteret"></div>
        <div id="lmMailOAuthFields" hidden><div class="oknotice">Du sendes videre til mailudbyderen og godkender forbindelsen dér. Lead Manager får ikke din almindelige adgangskode.</div></div>
        <div id="lmMailSmtpFields">
          <div id="lmMailPresetSummary" class="lm-mail-provider-box" style="margin-top:10px;padding:9px"></div>
          <div id="lmMailManualFields" hidden style="margin-top:10px">
            <div class="lm-mail-manual-grid"><input id="lmMailImapHost" placeholder="IMAP-server"><input id="lmMailImapPort" type="number" placeholder="Port"><select id="lmMailImapSecurity"><option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">Ingen</option></select></div>
            <div class="lm-mail-manual-grid"><input id="lmMailSmtpHost" placeholder="SMTP-server"><input id="lmMailSmtpPort" type="number" placeholder="Port"><select id="lmMailSmtpSecurity"><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">Ingen</option></select></div>
          </div>
          <div class="lm-mail-options"><label><input id="lmMailRead" type="checkbox" checked> Læs indgående mails</label><label><input id="lmMailSend" type="checkbox" checked> Send mails</label><label><input id="lmMailSaveSent" type="checkbox" checked> Gem i Sendt</label></div>
        </div>
        <div class="split"><button class="btn primary" id="lmMailProviderConnect" type="button">Test og forbind mail</button><button class="btn" id="lmMailProviderCheck" type="button">Opdatér status</button></div>
        <div id="lmMailProviderMessage" class="sub" style="margin-top:10px"></div>
      </div>
      <div class="lm-mail-provider-box"><h3>Forbundne mailkonti</h3><div id="lmMailProviderAccounts" class="lm-mail-list"><div class="sub">Henter forbindelser…</div></div><div class="sub" style="margin-top:10px">Du kan have flere mailkonti tilknyttet samme kunde. SMTP/IMAP-adgangskoder opbevares i Supabase Vault og vises ikke igen.</div></div>
    </div>`;
  const firstIntegration=[...host.querySelectorAll('.card.section')][0];if(firstIntegration)host.insertBefore(card,firstIntegration);else host.appendChild(card);
  $('#lmMailProvider').addEventListener('change',renderProviderFields);$('#lmMailAccount').addEventListener('input',()=>{if(!$('#lmMailUsername').value)$('#lmMailUsername').placeholder=$('#lmMailAccount').value||'navn@virksomhed.dk'});$('#lmMailProviderConnect').addEventListener('click',connect);$('#lmMailProviderCheck').addEventListener('click',check);
  handleOAuthCallback();renderProviderFields();check();setTimeout(()=>{const old=$('#lmMicrosoftCard');if(old)old.style.display='none'},300);
  return true;
}

function renderAccounts(accounts){
  const box=$('#lmMailProviderAccounts');if(!box)return;
  const rows=(accounts||[]).filter(a=>['imap_smtp','gmail','microsoft'].includes(a.provider));
  if(!rows.length){box.innerHTML='<div class="sub">Ingen mailkonti er forbundet endnu.</div>';return}
  box.innerHTML=rows.map(a=>{const cfg=a.config||{},label=a.provider==='microsoft'?'Microsoft 365 / Outlook':a.provider==='gmail'?'Google / Gmail':cfg.provider_label||'SMTP / IMAP';const connected=a.status==='connected';return `<div class="lm-mail-account"><div><strong>${esc(a.account||'Mailkonto')}</strong><div class="sub">${esc(label)} · <span class="${connected?'lm-mail-connected':''}">${esc(connected?'Forbundet':a.status||'Ikke forbundet')}</span></div>${a.last_error?`<div class="sub" style="color:#9f1239">${esc(a.last_error)}</div>`:''}</div>${a.provider==='imap_smtp'?`<button class="btn small danger" type="button" data-lm-mail-remove="${esc(a.id)}">Fjern</button>`:''}</div>`}).join('');
  box.querySelectorAll('[data-lm-mail-remove]').forEach(b=>b.addEventListener('click',()=>removeAccount(b.dataset.lmMailRemove)));
}

async function check(){if(busy||typeof state==='undefined'||!state?.client)return;const b=$('#lmMailProviderCheck');if(b)b.disabled=true;$('#lmMailProviderStatus').textContent='Kontrollerer…';try{const d=await edge('mail-provider-auth',{action:'status',client_id:state.client.id});renderAccounts(d.accounts||[]);const connected=(d.accounts||[]).filter(x=>x.status==='connected').length;$('#lmMailProviderStatus').textContent=connected?`✓ ${connected} forbundet`:'Ingen forbundet';if(connected)$('#lmMailProviderStatus').style.cssText='background:#dcfce7;color:#166534'}catch(e){$('#lmMailProviderStatus').textContent='Statusfejl';setMessage('Kunne ikke hente mailstatus: '+(e.message||e),true)}finally{if(b)b.disabled=false}}

async function connect(){
  if(busy||typeof state==='undefined'||!state?.client)return;const key=$('#lmMailProvider').value,p=PROVIDERS[key],account=String($('#lmMailAccount').value||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)){setMessage('Indtast en gyldig mailadresse.',true);return}
  if(key==='microsoft')return connectMicrosoft(account);
  if(key==='google')return connectGoogle(account);
  const password=$('#lmMailPassword').value,username=String($('#lmMailUsername').value||account).trim();if(!password){setMessage('Indtast mailadgangskoden først.',true);return}
  const payload={action:'save',client_id:state.client.id,provider_key:key,account,username,password,read_enabled:$('#lmMailRead').checked,send_enabled:$('#lmMailSend').checked,save_sent:$('#lmMailSaveSent').checked};
  if(key==='manual')Object.assign(payload,{provider_label:'Anden mailudbyder',imap_host:$('#lmMailImapHost').value.trim(),imap_port:Number($('#lmMailImapPort').value),imap_security:$('#lmMailImapSecurity').value,smtp_host:$('#lmMailSmtpHost').value.trim(),smtp_port:Number($('#lmMailSmtpPort').value),smtp_security:$('#lmMailSmtpSecurity').value});
  setBusy(true,'Tester forbindelse…');setMessage('Tester login hos mailudbyderen. Intet gemmes, før testen er godkendt.');
  try{const d=await edge('mail-provider-auth',payload);$('#lmMailPassword').value='';setMessage(`✓ ${d.provider||p.label} er forbundet som ${d.account}. Indgående og udgående forbindelse er testet.`,false,true);await check();try{if(typeof loadAll==='function')await loadAll()}catch{}}
  catch(e){setMessage('Forbindelsen blev ikke gemt: '+(e.message||e),true)}finally{setBusy(false)}
}

async function connectMicrosoft(account){setBusy(true,'Åbner Microsoft…');setMessage('Opretter sikker Microsoft-godkendelse…');try{const d=await edge('microsoft-oauth-auth',{action:'start',client_id:state.client.id,account,return_url:location.origin+location.pathname});if(!d?.authorize_url)throw new Error('Microsoft-loginlink blev ikke oprettet');location.assign(d.authorize_url)}catch(e){setBusy(false);setMessage('Microsoft-forbindelsen kunne ikke startes: '+(e.message||e),true)}}
async function connectGoogle(account){
  const configured=accountDefault();if(configured&&configured!==account){setMessage(`Google-forbindelsen bruger kundens nuværende afsendermail (${configured}). Ret kundens afsendermail først, hvis en anden Google-konto skal bruges.`,true);return}
  setBusy(true,'Åbner Google…');setMessage('Opretter sikker Google-godkendelse…');try{const d=await edge('gmail-direct-auth',{action:'start',client_id:state.client.id,return_url:location.origin+location.pathname});if(!d?.authorize_url)throw new Error('Google-loginlink blev ikke oprettet');location.assign(d.authorize_url)}catch(e){setBusy(false);setMessage('Google-forbindelsen kunne ikke startes: '+(e.message||e),true)}
}
async function removeAccount(id){if(!id||busy)return;if(!confirm('Fjern denne mailforbindelse fra Lead Manager?'))return;try{await edge('mail-provider-auth',{action:'remove',client_id:state.client.id,integration_id:id});setMessage('Mailforbindelsen er fjernet.',false,true);await check();try{if(typeof loadAll==='function')await loadAll()}catch{}}catch(e){setMessage('Kunne ikke fjerne forbindelsen: '+(e.message||e),true)}}
function handleOAuthCallback(){const q=new URLSearchParams(location.search);const ms=q.get('microsoft'),gm=q.get('gmail')||q.get('google');if(ms){setMessage(ms==='connected'?'✓ Microsoft-kontoen er forbundet.':q.get('microsoft_message')||'Microsoft-forbindelsen fejlede.',ms!=='connected',ms==='connected');q.delete('microsoft');q.delete('microsoft_message')}if(gm){setMessage(gm==='connected'?'✓ Google-kontoen er forbundet.':q.get('gmail_message')||q.get('google_message')||'Google-forbindelsen fejlede.',gm!=='connected',gm==='connected');q.delete('gmail');q.delete('google');q.delete('gmail_message');q.delete('google_message')}const qs=q.toString();if(ms||gm)history.replaceState({},document.title,location.pathname+(qs?'?'+qs:'')+location.hash)}
function boot(){if(inject())return;if(typeof state!=='undefined'&&state?.client&&!$('#lmMailProviderCard'))inject();const old=$('#lmMicrosoftCard');if(old&&$('#lmMailProviderCard'))old.style.display='none'}
window.addEventListener('load',()=>setTimeout(boot,100));setTimeout(boot,300);let tries=0;const timer=setInterval(()=>{tries++;boot();if($('#lmMailProviderCard')||tries>40)clearInterval(timer)},400);
})();
