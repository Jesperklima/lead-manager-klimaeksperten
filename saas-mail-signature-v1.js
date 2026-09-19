(()=>{
'use strict';
const VERSION='2026-09-17.4';
const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
const $=s=>document.querySelector(s);
let discovering=false;
let discoverPromise=null;
function settings(){try{return state?.client?.settings||{}}catch{return{}}}
function html(){return String(settings().mail_signature_html||settings().mail_signature||'').trim()}
function signaturePresent(){return !!html()}
function verified(){return signaturePresent()}
async function session(){if(typeof supabase==='undefined')return null;const {data}=await supabase.auth.getSession();return data?.session||null}
async function call(payload){const s=await session();if(!s?.access_token)throw new Error('Login-session mangler');const r=await fetch(`${API}/functions/v1/mail-provider-auth`,{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Authorization:'Bearer '+s.access_token},body:JSON.stringify(payload)});const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d}
function msg(t,bad=false){const e=$('#lmMailSignatureMessage');if(e){e.textContent=t;e.style.color=bad?'#9f1239':'#166534'}}
function render(){const p=$('#lmMailSignaturePreview'),pill=$('#lmMailSignatureStatus');const present=signaturePresent();if(p)p.innerHTML=html()||'<span class="sub">Signaturen findes automatisk efter mailen er forbundet.</span>';if(pill){pill.textContent=present?'✓ Signatur fundet':discovering?'Finder signatur…':'Afventer';pill.style.cssText=present?'background:#dcfce7;color:#166534':discovering?'background:#e0f2fe;color:#075985':'background:#fef3c7;color:#92400e'}if(present){const e=$('#lmMailSignatureMessage');if(e&&/Ukendt handling|Kunne ikke identificere signaturen/i.test(e.textContent||''))msg('✓ Den gemte signatur er fundet og bruges på mails fra Lead Manager.')}}
async function discover(account=''){
 if(signaturePresent()){msg('✓ Den gemte signatur er fundet og bruges på mails fra Lead Manager.');render();return true}
 if(discoverPromise)return discoverPromise;
 discoverPromise=(async()=>{
  if(!state?.client)return false;
  discovering=true;render();msg('Finder din eksisterende mailsignatur automatisk…');
  try{const d=await call({action:'discover_signature',client_id:state.client.id,account:String(account||$('#lmMailAccount')?.value||settings().mail||'').trim().toLowerCase(),preserve_html:true,prefer_provider_signature:true,fallback_to_sent_mail:true,sent_mail_sample_size:20});const sig=String(d.signature_html||d.signature||'').trim();if(!sig)throw new Error('Ingen sikker signatur fundet');state.client.settings={...(state.client.settings||{}),mail_signature_html:sig,mail_signature:sig,mail_signature_source:d.source||'automatic',mail_signature_account:d.account||account,mail_signature_verified_at:d.verified_at||new Date().toISOString(),mail_signature_verified_by:'automatic'};msg('✓ Signaturen er kopieret automatisk og bruges på mails fra Lead Manager.');document.dispatchEvent(new CustomEvent('lm:mail-signature-verified',{detail:{automatic:true,source:d.source||'automatic'}}));return true}catch(e){msg('Kunne ikke identificere signaturen automatisk. '+(e.message||e),true);return false}finally{discovering=false;render()}
 })();
 try{return await discoverPromise}finally{discoverPromise=null}
}
async function ensureVerified(account=''){
 if(signaturePresent())return true;
 const ok=await discover(account);
 return !!ok&&signaturePresent();
}
function inject(){if($('#lmMailSignatureWrap'))return true;const anchor=$('#lmMailSenderNameWrap')||$('#lmMailAccount')?.closest('.field');if(!anchor)return false;const w=document.createElement('div');w.className='field';w.id='lmMailSignatureWrap';w.innerHTML='<div class="split"><label>Mail-signatur <span class="sub">(automatisk)</span></label><span id="lmMailSignatureStatus" class="pill"></span></div><div class="sub" style="margin:5px 0 8px">Lead Manager bruger den signatur, der allerede er gemt på mailkontoen. Kun hvis der ikke findes en signatur, forsøger systemet at hente den automatisk fra mailudbyderen.</div><div id="lmMailSignaturePreview" style="border:1px solid var(--border);border-radius:10px;background:#fff;padding:10px;min-height:52px;overflow:auto"></div><button class="btn" id="lmMailSignatureRetry" type="button" style="margin-top:8px">Find signatur igen</button><div id="lmMailSignatureMessage" class="sub" style="margin-top:8px"></div>';anchor.insertAdjacentElement('afterend',w);$('#lmMailSignatureRetry').onclick=()=>{if(signaturePresent()){msg('✓ Den gemte signatur er fundet og bruges på mails fra Lead Manager.');render();return}discover()};render();return true}
function install(){if(window.__lmSignatureV2)return;window.__lmSignatureV2=true;const original=window.fetch.bind(window);window.fetch=async function(input,init){const url=typeof input==='string'?input:(input?.url||'');let body=null;if(init?.body&&typeof init.body==='string')try{body=JSON.parse(init.body)}catch{};const providerCall=url.includes('/functions/v1/mail-provider-auth');const sending=/mail|gmail|microsoft/i.test(url)&&/(send|send_mail|send-email|mail_send)/i.test(url+' '+String(body?.action||''));if(sending&&!signaturePresent()){const account=String(body?.from||body?.account||settings().mail||'').trim();const ok=await ensureVerified(account);if(!ok)throw new Error('Mail-signaturen mangler. Gå til Mail-indstillinger og kontrollér at mailkontoen er forbundet.')}if(sending&&body&&html()){body.signature_html=html();body.signature=html();body.signature_verified=true;init={...init,body:JSON.stringify(body)}}const r=await original(input,init);if(providerCall&&body?.action==='save'&&r.ok&& !signaturePresent())setTimeout(()=>discover(body.account||''),500);return r}}
function boot(){inject();install();render();if(signaturePresent())msg('✓ Den gemte signatur er fundet og bruges på mails fra Lead Manager.')}
setTimeout(boot,250);window.addEventListener('load',()=>setTimeout(boot,100));window.addEventListener('lm:mail-provider-ready',boot);window.addEventListener('lm:client-data-ready',boot);document.addEventListener('lm:mail-connected',e=>setTimeout(()=>{if(!signaturePresent())discover(e?.detail?.account||'');else{render();msg('✓ Den gemte signatur er fundet og bruges på mails fra Lead Manager.')}},300));
window.LMMailSignature={version:VERSION,discover,verified,ensureVerified,signaturePresent};
})();
