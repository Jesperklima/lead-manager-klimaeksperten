(()=>{
'use strict';
const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
const CALLBACK='https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/microsoft-oauth-callback';
let msReady=false,lastStatus=null,lastStatusAt=0,lastHistoryLead='',historyBusy=false,platformBusy=false;
const $=id=>document.getElementById(id);
const text=v=>String(v??'').trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const client=()=>{try{return typeof state!=='undefined'?state?.client:null}catch{return null}};
const session=()=>{try{return typeof state!=='undefined'?state?.session:null}catch{return null}};
const plan=()=>window.__LM_SAAS_PLAN||null;
const provider=()=>text(client()?.settings?.mail_provider).toLowerCase();
const isMicrosoft=()=>provider()==='microsoft';
const mailMonitor=()=>plan()?.plan_code==='internal'||!!plan()?.allow_mail_monitor;
const mailSend=()=>plan()?.plan_code==='internal'||!!plan()?.allow_mail_send;

async function edge(name,payload){
  const {data:{session:s}}=await supabase.auth.getSession();if(!s?.access_token)throw new Error('Login-session mangler');
  const r=await fetch(`${API}/functions/v1/${name}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY,'Authorization':'Bearer '+s.access_token},body:JSON.stringify(payload)});
  const raw=await r.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}}
  if(!r.ok)throw Object.assign(new Error(data?.error||`HTTP ${r.status}`),{code:data?.code||null,status:r.status});return data;
}
function onboardingAccount(){
  const c=client();if(!c?.id)return text(c?.settings?.mail)||text(session()?.user?.email).toLowerCase();
  try{const local=JSON.parse(localStorage.getItem('lm_ob_v2_'+c.id)||'{}');return text(local.business_email||c.settings?.mail||session()?.user?.email).toLowerCase()}catch{return text(c.settings?.mail||session()?.user?.email).toLowerCase()}
}
async function microsoftStatus(force=false){
  const c=client();if(!c?.id)return null;if(!force&&lastStatus&&Date.now()-lastStatusAt<10000)return lastStatus;
  try{lastStatus=await edge('microsoft-oauth-auth',{action:'status',client_id:c.id});msReady=!!lastStatus.ready;lastStatusAt=Date.now();return lastStatus}catch(e){lastStatus={ready:false,error:e.message,code:e.code};msReady=false;lastStatusAt=Date.now();return lastStatus}
}
async function platformStatus(){
  const c=client();if(!c?.id)return null;try{return await edge('microsoft-oauth-auth',{action:'platform_status',client_id:c.id})}catch(e){return {configured:false,error:e.message}}
}

async function renderOnboardingMicrosoft(){
  const card=document.querySelector('#lmOnboardingBack [data-mail="microsoft"]'),box=$('obMailState');if(!card||!box||!card.classList.contains('on'))return;
  if(box.dataset.msLoading==='1')return;box.dataset.msLoading='1';
  box.innerHTML='<div class="ob-note">Kontrollerer Microsoft 365-forbindelsen…</div>';
  const s=await microsoftStatus(true);box.dataset.msLoading='';
  if(s?.ready){box.innerHTML=`<div class="ob-ok">✓ Microsoft 365 / Outlook er forbundet til ${esc(s.account||onboardingAccount())} og klar.</div>`;return}
  if(s?.platform_app_stored===false||s?.code==='MICROSOFT_PLATFORM_APP_MISSING'){
    box.innerHTML='<div class="ob-warn"><strong>Microsoft-platformappen mangler endnu.</strong><br>Den interne administrator skal indsætte Microsoft Application ID og Client Secret én gang. Derefter kan alle kunder forbinde deres egen konto.</div>';return;
  }
  const read=s?.read_scope_required?' Aftalen giver også læseadgang til relevante mails, fordi denne pakke har mailovervågning.':'';
  box.innerHTML=`<div class="ob-note">Forbind ${esc(onboardingAccount())} til Microsoft 365 / Outlook.${esc(read)}</div><button class="btn primary" id="obConnectMicrosoft" style="margin-top:10px">Forbind Microsoft 365 / Outlook</button>${s?.error?`<div class="ob-warn" style="margin-top:10px">${esc(s.error)}</div>`:''}`;
  $('obConnectMicrosoft')?.addEventListener('click',connectMicrosoft);
}
async function connectMicrosoft(){
  const c=client(),box=$('obMailState'),btn=$('obConnectMicrosoft');if(!c?.id)return;if(btn)btn.disabled=true;if(box)box.innerHTML='<div class="ob-note">Åbner Microsoft-godkendelse…</div>';
  try{const d=await edge('microsoft-oauth-auth',{action:'start',client_id:c.id,account:onboardingAccount(),return_url:location.origin+'/'});location.href=d.authorize_url}catch(e){if(box)box.innerHTML=`<div class="ob-warn">${esc(e.message||e)}</div>`;if(btn)btn.disabled=false}
}
function selectedMicrosoft(){return !!document.querySelector('#lmOnboardingBack [data-mail="microsoft"].on')}
document.addEventListener('click',e=>{
  const next=e.target?.closest?.('#obNext');if(!next||!selectedMicrosoft())return;
  const heading=text(document.querySelector('#lmOnboardingBack .ob-body h2')?.textContent);if(!/^7\./.test(heading))return;
  if(!msReady){e.preventDefault();e.stopImmediatePropagation();renderOnboardingMicrosoft();const msg=$('obMsg');if(msg)msg.textContent='Forbind Microsoft 365 / Outlook, før du fortsætter.'}
},true);

function ensurePlatformCard(){
  if(plan()?.plan_code!=='internal')return;const view=$('leadmanager');if(!view||$('microsoftPlatformCard'))return;
  const card=document.createElement('div');card.className='card section';card.id='microsoftPlatformCard';card.style.marginTop='14px';
  card.innerHTML=`<div class="split" style="align-items:flex-start"><div><h2 style="margin:0 0 4px">Microsoft OAuth · platform</h2><div class="sub">Opsættes én gang. Alle Microsoft 365 / Outlook-kunder bruger derefter samme Lead Manager-app, men får egne tenant-isolerede tokens.</div></div><div id="microsoftPlatformBadge" class="pill">Kontrollerer…</div></div><div class="row" style="margin-top:12px"><div class="field"><label>Application (client) ID</label><input id="microsoftPlatformClientId" autocomplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div><div class="field"><label>Client Secret · VALUE</label><input id="microsoftPlatformSecret" type="password" autocomplete="new-password" placeholder="Indsæt secret VALUE, ikke Secret ID"></div></div><div class="notice"><strong>Redirect URI i Microsoft Entra:</strong><br><code>${CALLBACK}</code><br><span class="sub">Kontotype: Accounts in any organizational directory and personal Microsoft accounts. Web redirect.</span></div><div class="split" style="margin-top:10px"><button class="btn primary" id="saveMicrosoftPlatform">Gem Microsoft-app sikkert</button><button class="btn" id="checkMicrosoftPlatform">Kontrollér status</button></div><div id="microsoftPlatformMessage" class="sub" style="margin-top:9px"></div>`;
  view.appendChild(card);$('saveMicrosoftPlatform').onclick=savePlatform;$('checkMicrosoftPlatform').onclick=()=>updatePlatformCard(true);updatePlatformCard(true);
}
async function updatePlatformCard(force=false){
  const badge=$('microsoftPlatformBadge'),msg=$('microsoftPlatformMessage');if(!badge)return;const s=await platformStatus();
  badge.textContent=s?.configured?'✓ Platform-app klar':'Mangler opsætning';badge.className='pill'+(s?.configured?' status VUNDET':'');
  if(msg)msg.textContent=s?.configured?`Microsoft OAuth er klar. Client ID: ${s.client_id_hint||'gemt'} · Redirect: ${s.redirect_uri||CALLBACK}`:(s?.error||'Indsæt Microsoft Application ID og Client Secret én gang.');
}
async function savePlatform(){
  if(platformBusy)return;const id=text($('microsoftPlatformClientId')?.value),secret=text($('microsoftPlatformSecret')?.value),msg=$('microsoftPlatformMessage'),btn=$('saveMicrosoftPlatform');if(!id||!secret){if(msg)msg.textContent='Indsæt både Application ID og Client Secret VALUE.';return}
  platformBusy=true;if(btn)btn.disabled=true;if(msg)msg.textContent='Validerer hos Microsoft og gemmer sikkert…';
  try{const d=await edge('microsoft-oauth-auth',{action:'save_platform',client_id:client().id,microsoft_client_id:id,microsoft_client_secret:secret});$('microsoftPlatformSecret').value='';if(msg)msg.textContent=d.validated_by_microsoft?'✓ Microsoft-app gemt og valideret.':'✓ Microsoft-app gemt.';lastStatus=null;await updatePlatformCard(true)}catch(e){if(msg)msg.textContent=e.message||String(e)}finally{platformBusy=false;if(btn)btn.disabled=false}
}

async function ensureMicrosoftMailCard(){
  if(!isMicrosoft()||!mailSend())return;const view=$('leadmanager');if(!view)return;let card=$('gmailDirectCard');if(!card){card=document.createElement('div');card.className='card';card.id='gmailDirectCard';view.appendChild(card)}
  if(card.dataset.microsoftCard!=='1'){
    card.dataset.microsoftCard='1';card.innerHTML=`<div class="gmail-direct-head"><div><strong>Microsoft 365 / Outlook</strong><div class="sub">Send direkte fra din forbundne Microsoft-konto via Microsoft Graph.</div></div><span class="gmail-direct-status" id="microsoftDirectBadge">Kontrollerer…</span></div><div class="gmail-direct-note">Lead Manager bruger kun den adgang, din pakke kræver. Start: send. Pro/Business: send + læs relevante mails.</div><div class="split" style="margin-top:10px"><button class="btn primary" id="connectMicrosoftDirect">Forbind / forbind igen Microsoft</button><button class="btn" id="checkMicrosoftDirect">Kontrollér forbindelse</button></div><div id="microsoftDirectMessage" class="sub" style="margin-top:8px"></div>`;
    $('connectMicrosoftDirect').onclick=async()=>{const b=$('connectMicrosoftDirect'),m=$('microsoftDirectMessage');if(b)b.disabled=true;if(m)m.textContent='Åbner Microsoft-godkendelse…';try{const d=await edge('microsoft-oauth-auth',{action:'start',client_id:client().id,account:text(client()?.settings?.mail),return_url:location.origin+'/'});location.href=d.authorize_url}catch(e){if(m)m.textContent=e.message||String(e);if(b)b.disabled=false}};
    $('checkMicrosoftDirect').onclick=()=>refreshMicrosoftCard(true);
  }
  await refreshMicrosoftCard(false);
}
async function refreshMicrosoftCard(force=false){
  if(!isMicrosoft())return;const s=await microsoftStatus(force),badge=$('microsoftDirectBadge'),msg=$('microsoftDirectMessage');if(!badge)return;
  badge.className='gmail-direct-status'+(s?.ready?' ok':'');badge.textContent=s?.ready?'Forbundet':'Ikke forbundet';if(msg)msg.textContent=s?.ready?`✓ Microsoft er klar på ${s.account||client()?.settings?.mail}.`:(s?.error||'Klik Forbind Microsoft.');
}

function followUpPayload(){const date=text($('mFollowUpDate')?.value);let at='';if(date){const d=new Date(date+'T09:00:00');if(!Number.isNaN(d.getTime()))at=d.toISOString()}return {follow_up_date:date||undefined,follow_up_at:at||undefined}}
function patchMicrosoftSend(){
  if(!isMicrosoft()||!mailSend())return;const q=$('queueMail');if(!q)return;if(q.dataset.microsoftPatched==='1')return;q.dataset.microsoftPatched='1';
  q.onclick=async()=>{
    const to=text($('mTo')?.value).toLowerCase(),subject=text($('mSubject')?.value),body=text($('mBody')?.value);let lead=null;try{lead=typeof currentLead!=='undefined'?currentLead:null}catch{}
    if(!lead?.id){alert('Leadet kunne ikke findes. Luk mailvinduet og åbn kunden igen.');return}if(!to||!subject||!body){alert('Udfyld modtager, emne og mailtekst først.');return}
    const s=await microsoftStatus(true);if(!s?.ready){alert('Microsoft 365 / Outlook er ikke forbundet endnu.');return}if(!confirm('Send mailen nu fra '+(s.account||client()?.settings?.mail)+' til '+to+'?'))return;
    const old=q.textContent;q.disabled=true;q.textContent='Sender via Microsoft…';
    try{const r=await edge('microsoft-direct-send',{client_id:client().id,lead_id:lead.id,to,subject,body,ai_generated:typeof mailAiUsed!=='undefined'?!!mailAiUsed:false,ai_model:typeof mailAiModel!=='undefined'?mailAiModel:null,...followUpPayload()});q.textContent='Sendt ✓';try{if(typeof toast==='function')toast('Mail sendt via Microsoft 365')}catch{}setTimeout(()=>{$('mailModal')?.classList.remove('open');q.disabled=false;q.textContent=old},650);try{if(typeof loadAll==='function')await loadAll()}catch{}}
    catch(e){q.disabled=false;q.textContent=old;alert('Mailen blev ikke sendt: '+(e.message||e))}
  };
}
function patchSenderLabel(){if(!isMicrosoft())return;const sender=$('lmMailSenderStatus'),q=$('queueMail');if(sender){sender.className='lm-mail-sender'+(msReady?' ok':'');sender.textContent=msReady?`Afsender: ${lastStatus?.account||client()?.settings?.mail} · Microsoft 365 forbundet`:'Microsoft 365 er ikke forbundet endnu'}if(q&&mailSend())q.textContent='Send fra Microsoft 365'}

function fmt(d){try{return new Intl.DateTimeFormat('da-DK',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(d))}catch{return text(d)}}
function openFollow(message){
  try{if(typeof currentLead==='undefined'||!currentLead?.id)return;const leadId=currentLead.id;if(typeof openLead==='function')openLead(leadId)}catch{return}
  setTimeout(()=>{$('openMailComposer')?.click();setTimeout(()=>{const to=$('mTo'),purpose=$('mPurpose'),subj=$('mSubject'),body=$('mBody'),recipient=Array.isArray(message.to)?message.to[0]:'';if(to&&recipient)to.value=recipient;if(purpose)purpose.value='Opfølgning';const base=text(message.subject).replace(/^(sv|re|fw|fwd):\s*/i,'');if(subj&&base)subj.value='Opfølgning: '+base;if(body)body.value='';try{if(typeof runMailAi==='function')runMailAi(`Skriv en kort og naturlig opfølgningsmail. Henvis naturligt til min tidligere mail fra ${fmt(message.message_at)}${base?' med emnet "'+base+'"':''}. Gentag ikke hele mailen. Gør det let at svare.`,'draft')}catch{}},100)},50);
}
async function renderMicrosoftHistory(force=false){
  if(!isMicrosoft())return;const box=$('gmailHistoryBlock');if(!box)return;if(!mailMonitor()){box.classList.add('hidden');return}else box.classList.remove('hidden');let lead=null;try{lead=typeof currentLead!=='undefined'?currentLead:null}catch{}if(!lead?.id)return;if(historyBusy||(!force&&lastHistoryLead===lead.id&&box.dataset.msHistory==='1'))return;historyBusy=true;lastHistoryLead=lead.id;box.dataset.msHistory='1';box.innerHTML='<div class="lm-gh-head"><div><strong>Tidligere mailkontakt</strong><div class="sub">Tjekker sendte mails i Microsoft 365…</div></div><span class="lm-gh-badge">Microsoft</span></div>';
  try{const d=await edge('microsoft-history-check',{client_id:client().id,lead_id:lead.id}),messages=Array.isArray(d.messages)?d.messages:[];if(!messages.length){box.innerHTML='<div class="lm-gh-head"><div><strong>Tidligere mailkontakt</strong><div class="sub">Ingen tidligere sendt Microsoft-mail fundet til denne virksomhed.</div></div><span class="lm-gh-badge">Ingen historik</span></div><div class="lm-gh-actions"><button class="btn small" id="msHistoryRetry">Tjek igen</button></div>';$('msHistoryRetry')?.addEventListener('click',()=>renderMicrosoftHistory(true));return}
    box.innerHTML='<div class="lm-gh-head"><div><strong>Tidligere mailkontakt</strong><div class="sub">Fundet i Microsoft 365 / Outlook.</div></div><span class="lm-gh-badge ok">'+messages.length+' fundet</span></div><div class="lm-gh-list">'+messages.slice(0,4).map((m,i)=>`<div class="lm-gh-item"><strong>${esc(m.subject||'(uden emne)')}</strong><div class="lm-gh-ref">Reference: ${esc(fmt(m.message_at))} · til ${esc((m.to||[]).join(', '))}</div>${m.body_text?`<div class="lm-gh-snippet">${esc(m.body_text)}</div>`:''}<div class="lm-gh-actions"><button class="btn ${i===0?'primary ':''}small" data-ms-follow="${i}">${i===0?'Skriv opfølgning':'Brug som reference'}</button>${m.web_url?`<a class="btn small" target="_blank" rel="noopener" href="${esc(m.web_url)}">Åbn i Outlook</a>`:''}</div></div>`).join('')+'</div><div class="lm-gh-actions"><button class="btn small" id="msHistoryRetry">Tjek Microsoft igen</button></div>';
    box.querySelectorAll('[data-ms-follow]').forEach(b=>b.addEventListener('click',()=>openFollow(messages[Number(b.dataset.msFollow)||0])));$('msHistoryRetry')?.addEventListener('click',()=>renderMicrosoftHistory(true));
  }catch(e){box.innerHTML=`<div class="lm-gh-head"><div><strong>Tidligere mailkontakt</strong><div class="sub">Microsoft-historik kunne ikke hentes.</div></div><span class="lm-gh-badge warn">Fejl</span></div><div class="notice" style="margin-top:8px">${esc(e.message||e)}</div><div class="lm-gh-actions"><button class="btn small" id="msHistoryRetry">Prøv igen</button></div>`;$('msHistoryRetry')?.addEventListener('click',()=>renderMicrosoftHistory(true))}finally{historyBusy=false}
}

function callbackMessage(){const u=new URL(location.href),status=u.searchParams.get('microsoft'),message=u.searchParams.get('microsoft_message');if(!status)return;if(message){try{if(typeof toast==='function')toast(message)}catch{}}u.searchParams.delete('microsoft');u.searchParams.delete('microsoft_message');history.replaceState({},'',u.pathname+(u.search?'?'+u.searchParams.toString():'')+u.hash);lastStatus=null;setTimeout(()=>{renderOnboardingMicrosoft();refreshMicrosoftCard(true)},300)}
async function apply(){
  ensurePlatformCard();
  const card=document.querySelector('#lmOnboardingBack [data-mail="microsoft"]');if(card){card.classList.remove('disabled');card.dataset.microsoftPending='0';const sub=card.querySelector('.sub');if(sub)sub.textContent='Arbejdsmail, Microsoft 365 eller Outlook-konto.';if(card.classList.contains('on'))renderOnboardingMicrosoft()}
  if(isMicrosoft()){await ensureMicrosoftMailCard();patchMicrosoftSend();patchSenderLabel();renderMicrosoftHistory(false)}
}
callbackMessage();document.addEventListener('click',()=>setTimeout(apply,30),true);new MutationObserver(()=>setTimeout(apply,20)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});setInterval(apply,700);setTimeout(apply,120);
})();
