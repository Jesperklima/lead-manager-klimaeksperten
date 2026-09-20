(()=>{
'use strict';

const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
const STORAGE='lm_supabase_session_v1';
let busy=false;

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function decodePayload(token){
  try{
    const part=String(token||'').split('.')[1]||'';
    const base=part.replace(/-/g,'+').replace(/_/g,'/');
    const pad='='.repeat((4-base.length%4)%4);
    return JSON.parse(decodeURIComponent(Array.from(atob(base+pad)).map(c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join('')));
  }catch{return {}}
}

async function currentSession(){
  const {data}=await supabase.auth.getSession();
  return data?.session||null;
}

async function authRequest(path,{method='GET',body}={}){
  const session=await currentSession();
  if(!session?.access_token)throw new Error('Login-session mangler');
  const res=await fetch(API+'/auth/v1/'+path.replace(/^\//,''),{
    method,
    headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const raw=await res.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}}
  if(!res.ok)throw new Error(data?.msg||data?.message||data?.error_description||data?.error||('HTTP '+res.status));
  return data;
}

async function listFactors(){
  const user=await authRequest('user');
  const all=Array.isArray(user?.factors)?user.factors:[];
  return {
    all,
    totp:all.filter(f=>(f.factor_type||f.type)==='totp'),
    verifiedTotp:all.filter(f=>(f.factor_type||f.type)==='totp'&&f.status==='verified')
  };
}

async function aal(){
  const session=await currentSession();
  const payload=decodePayload(session?.access_token);
  return payload?.aal||'aal1';
}

function required(access){
  if(access?.mfa_required===true)return true;
  return access?.platform_admin===true||['platform_admin','workspace_owner','workspace_admin'].includes(access?.role);
}

function hideApp(){
  $('appShell')?.classList.add('hidden');
  $('authScreen')?.classList.add('hidden');
  $('loading')?.classList.add('hidden');
}

function ensureStyle(){
  if($('lmMfaStyle'))return;
  const style=document.createElement('style');
  style.id='lmMfaStyle';
  style.textContent=`
    #lmMfaGate{position:fixed;inset:0;z-index:25000;background:linear-gradient(145deg,#eef2f7 0%,#f8fafc 52%,#e8eef7 100%);display:grid;place-items:center;padding:22px}
    #lmMfaGate .lm-mfa-card{width:min(520px,96vw);max-height:94vh;overflow:auto;background:#fff;border:1px solid #e1e7ee;border-radius:20px;padding:26px;box-shadow:0 28px 80px rgba(15,23,42,.18)}
    #lmMfaGate h1{font-size:22px;margin:0 0 6px;letter-spacing:-.02em}
    #lmMfaGate .lm-mfa-sub{color:#64748b;line-height:1.5;margin-bottom:18px}
    #lmMfaGate .lm-mfa-qr{display:grid;place-items:center;padding:14px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;margin:12px 0}
    #lmMfaGate .lm-mfa-qr img{width:220px;height:220px;max-width:70vw}
    #lmMfaGate .lm-mfa-secret{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;padding:10px;border:1px solid #dbe3ea;border-radius:10px;background:#f8fafc;overflow-wrap:anywhere}
    #lmMfaGate .lm-mfa-code{width:100%;box-sizing:border-box;font-size:22px;letter-spacing:.22em;text-align:center;padding:12px;border:1px solid #cbd5e1;border-radius:11px;margin-top:12px}
    #lmMfaGate .lm-mfa-actions{display:flex;gap:9px;margin-top:12px}
    #lmMfaGate .lm-mfa-actions .btn{flex:1}
    #lmMfaGate .lm-mfa-msg{min-height:20px;margin-top:10px;font-size:12px;color:#475569}
    #lmMfaGate .lm-mfa-msg.bad{color:#b42318}
    #lmMfaGate .lm-mfa-shield{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:#eef3ff;color:#2451d6;font-size:22px;margin-bottom:13px}
  `;
  document.head.appendChild(style);
}

function gateShell(mode,email){
  ensureStyle();
  $('lmMfaGate')?.remove();
  const gate=document.createElement('div');
  gate.id='lmMfaGate';
  gate.innerHTML=`<div class="lm-mfa-card">
    <div class="lm-mfa-shield">⌾</div>
    <h1>${mode==='enroll'?'Aktivér 2-faktor-login':'2-faktor-login'}</h1>
    <div class="lm-mfa-sub">${mode==='enroll'
      ?'Ejer- og administratorkonti kræver ekstra beskyttelse. Scan QR-koden med Microsoft Authenticator, Google Authenticator, 1Password eller en anden TOTP-app.'
      :'Åbn din authenticator-app og indtast den 6-cifrede kode for at fortsætte.'}</div>
    <div id="lmMfaSetup"></div>
    <input id="lmMfaCode" class="lm-mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="Authenticator-kode">
    <div class="lm-mfa-actions">
      <button id="lmMfaVerify" class="btn primary" type="button">${mode==='enroll'?'Aktivér og fortsæt':'Bekræft og fortsæt'}</button>
      <button id="lmMfaSignOut" class="btn" type="button">Log ud</button>
    </div>
    <div id="lmMfaMsg" class="lm-mfa-msg"></div>
    <div class="sub" style="margin-top:14px">Logget ind som ${esc(email||'')}</div>
  </div>`;
  document.body.appendChild(gate);
  $('lmMfaSignOut').onclick=()=>supabase.auth.signOut().then(()=>location.replace('/'));
  return gate;
}

function setMsg(text,bad=false){
  const msg=$('lmMfaMsg');if(!msg)return;
  msg.textContent=text||'';msg.classList.toggle('bad',!!bad);
}

function normalizedQr(qr){
  const raw=String(qr||'');
  if(!raw)return '';
  return raw.startsWith('data:')?raw:'data:image/svg+xml;utf-8,'+raw;
}

async function clearUnverified(factors){
  for(const f of factors.filter(x=>x.status!=='verified')){
    try{await authRequest('factors/'+encodeURIComponent(f.id),{method:'DELETE'})}catch(e){console.warn('MFA cleanup',e)}
  }
}

async function enrollFactor(){
  const factors=await listFactors();
  await clearUnverified(factors.all);
  return await authRequest('factors',{
    method:'POST',
    body:{factor_type:'totp',friendly_name:'Lead Manager'}
  });
}

async function challengeAndVerify(factorId,code){
  const challenge=await authRequest('factors/'+encodeURIComponent(factorId)+'/challenge',{
    method:'POST',
    body:{}
  });
  const verified=await authRequest('factors/'+encodeURIComponent(factorId)+'/verify',{
    method:'POST',
    body:{factor_id:factorId,challenge_id:challenge.id,code}
  });
  const old=await currentSession();
  if(!verified?.access_token)throw new Error('MFA blev godkendt, men den nye session mangler');
  const next={
    access_token:verified.access_token,
    refresh_token:verified.refresh_token||old?.refresh_token,
    expires_in:verified.expires_in,
    expires_at:verified.expires_at||Math.floor(Date.now()/1000)+(verified.expires_in||3600),
    token_type:verified.token_type||'bearer',
    user:verified.user||old?.user
  };
  localStorage.setItem(STORAGE,JSON.stringify(next));
  return next;
}

async function renderEnrollment(access){
  hideApp();
  const session=await currentSession();
  gateShell('enroll',session?.user?.email);
  setMsg('Opretter sikker QR-kode…');
  try{
    const factor=await enrollFactor();
    const setup=$('lmMfaSetup');
    if(!setup)return;
    const qr=normalizedQr(factor?.totp?.qr_code);
    const secret=String(factor?.totp?.secret||'');
    setup.innerHTML='<div class="lm-mfa-qr"><img id="lmMfaQr" alt="QR-kode til authenticator"></div><div class="sub" style="margin:8px 0 5px">Kan du ikke scanne QR-koden, kan nøglen indtastes manuelt:</div><div id="lmMfaSecret" class="lm-mfa-secret"></div>';
    $('lmMfaQr').src=qr;
    $('lmMfaSecret').textContent=secret;
    setMsg('');
    bindVerify(factor.id,access);
  }catch(e){
    setMsg('2-faktor-login kunne ikke klargøres: '+(e?.message||e),true);
  }
}

function bindVerify(factorId,access){
  const button=$('lmMfaVerify'),input=$('lmMfaCode');
  if(!button||!input)return;
  const submit=async()=>{
    if(busy)return;
    const code=String(input.value||'').replace(/\D/g,'').slice(0,6);
    if(code.length!==6){setMsg('Indtast den 6-cifrede kode fra authenticator-appen.',true);return}
    busy=true;button.disabled=true;input.disabled=true;setMsg('Kontrollerer koden…');
    try{
      await challengeAndVerify(factorId,code);
      setMsg('✓ 2-faktor-login er godkendt. Åbner Lead Manager…');
      setTimeout(()=>location.reload(),120);
    }catch(e){
      setMsg('Koden kunne ikke godkendes: '+(e?.message||e),true);
      button.disabled=false;input.disabled=false;input.select();
    }finally{busy=false}
  };
  button.onclick=submit;
  input.onkeydown=e=>{if(e.key==='Enter')submit()};
  setTimeout(()=>input.focus(),0);
}

async function renderChallenge(access,factor){
  hideApp();
  const session=await currentSession();
  gateShell('challenge',session?.user?.email);
  bindVerify(factor.id,access);
  setMsg('');
}

async function show(access){
  if(!required(access)){ $('lmMfaGate')?.remove(); return true; }
  hideApp();
  try{
    const level=await aal();
    if(level==='aal2'){ $('lmMfaGate')?.remove(); return true; }
    const factors=await listFactors();
    const verified=factors.verifiedTotp[0];
    if(verified)await renderChallenge(access,verified);
    else await renderEnrollment(access);
    return false;
  }catch(e){
    gateShell('challenge',(await currentSession())?.user?.email);
    $('lmMfaVerify').disabled=true;
    $('lmMfaCode').disabled=true;
    setMsg('2-faktor-login kunne ikke startes: '+(e?.message||e),true);
    return false;
  }
}

window.LMMfaGate={show,required,aal,listFactors};
})();