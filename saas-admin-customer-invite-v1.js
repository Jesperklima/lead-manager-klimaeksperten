(()=>{
'use strict';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let busy=false;
let statusBusy=false;
const resendBusy=new Set();

function isPlatformAdmin(){
  return window.LM_ACCESS?.platform_admin===true;
}

async function edge(payload){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error('Login-session mangler');
  const response=await fetch(SUPABASE_URL+'/functions/v1/saas-admin-invite',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_KEY,
      Authorization:'Bearer '+session.access_token
    },
    body:JSON.stringify(payload)
  });
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}}
  if(!response.ok){
    const error=new Error(data.error||('HTTP '+response.status));
    error.code=data.code;
    throw error;
  }
  return data;
}

function fmtDate(value){
  if(!value)return '—';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '—';
  try{
    return new Intl.DateTimeFormat('da-DK',{
      day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
    }).format(d);
  }catch{
    return d.toLocaleString('da-DK');
  }
}

function pill(label,tone='neutral'){
  return '<span class="lmaci-pill '+esc(tone)+'">'+esc(label)+'</span>';
}

function inviteLabel(row){
  const s=String(row?.invite?.status||'none');
  if(s==='sent')return pill('Sendt','info');
  if(s==='claimed')return pill('Brugt','success');
  if(s==='send_failed')return pill('Afsendelse fejlede','danger');
  if(s==='created')return pill('Ikke sendt','danger');
  if(s==='expired')return pill('Udløbet','warning');
  if(s==='revoked')return pill('Tilbagekaldt','neutral');
  return pill('Ingen invitation','neutral');
}

function loginLabel(row){
  if(!row?.login?.created)return pill('Ikke oprettet','neutral');
  return pill('Login oprettet','success');
}

function mfaLabel(row){
  const s=String(row?.mfa_status||'not_started');
  if(s==='verified')return pill('2FA klar','success');
  if(s==='pending')return pill('Afventer 2FA','warning');
  return pill('Ikke startet','neutral');
}

function lifecycleLabel(row){
  const s=String(row?.lifecycle||'INVITED');
  if(s==='ACTIVE')return pill('Aktiv','success');
  if(s==='ONBOARDING')return pill('Onboarding','info');
  return pill('Inviteret','warning');
}

function onboardingLabel(row){
  if(row?.onboarding_completed)return '<strong>4/4</strong><div class="lmaci-small">Færdig</div>';
  const step=Math.max(0,Math.min(4,Number(row?.onboarding_step||0)));
  if(step===0)return '<strong>0/4</strong><div class="lmaci-small">Ikke startet</div>';
  const names={1:'Virksomhed',2:'Leadprofil',3:'Integrationer',4:'Gennemgang'};
  return '<strong>'+step+'/4</strong><div class="lmaci-small">'+esc(names[step]||'I gang')+'</div>';
}

function style(){
  if($('#lmAdminCustomerInviteStyle'))return;
  const node=document.createElement('style');
  node.id='lmAdminCustomerInviteStyle';
  node.textContent=`
    #lmAdminCustomerInvite{margin-top:20px;padding-top:18px;border-top:1px solid var(--border,#334155)}
    #lmAdminCustomerInvite .lmaci-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}
    #lmAdminCustomerInvite .lmaci-head h3{margin:0 0 4px;font-size:16px}
    #lmAdminCustomerInvite .lmaci-badge{display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;background:rgba(49,87,232,.14);color:var(--accent,#6f8cff);font-size:11px;font-weight:850;white-space:nowrap}
    #lmAdminCustomerInvite .lmaci-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    #lmAdminCustomerInvite .field{margin:0}
    #lmAdminCustomerInvite label{display:block;font-size:12px;font-weight:800;color:var(--muted,#94a3b8);margin-bottom:5px}
    #lmAdminCustomerInvite input,#lmAdminCustomerInvite select{width:100%;min-height:42px;padding:9px 10px;border:1px solid var(--border,#334155);border-radius:10px;background:var(--soft,#eef2ff);color:var(--text,#10203a)}
    #lmAdminCustomerInvite .lmaci-plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:6px}
    #lmAdminCustomerInvite .lmaci-plan{border:1px solid var(--border,#334155);background:var(--soft,#eef2ff);color:var(--text,#10203a);border-radius:10px;padding:10px;cursor:pointer;text-align:left}
    #lmAdminCustomerInvite .lmaci-plan strong{display:block;font-size:13px}
    #lmAdminCustomerInvite .lmaci-plan span{display:block;font-size:11px;color:var(--muted,#94a3b8);margin-top:2px}
    #lmAdminCustomerInvite .lmaci-plan.active{border-color:#5b7cfa;background:rgba(49,87,232,.12);box-shadow:0 0 0 1px rgba(49,87,232,.16)}
    #lmAdminCustomerInvite .lmaci-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}
    #lmAdminCustomerInvite .lmaci-msg{font-size:12px;color:var(--muted,#94a3b8);min-height:18px}
    #lmAdminCustomerInvite .lmaci-success{margin-top:12px;padding:11px 13px;border-radius:11px;background:rgba(16,185,129,.10);border:1px solid rgba(16,185,129,.32);color:var(--text,#e2e8f0);font-size:12px}
    #lmAdminCustomerInvite .lmaci-status{margin-top:24px;padding-top:18px;border-top:1px solid var(--border,#334155)}
    #lmAdminCustomerInvite .lmaci-status-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}
    #lmAdminCustomerInvite .lmaci-status-head h3{margin:0 0 3px;font-size:16px}
    #lmAdminCustomerInvite .lmaci-status-note{font-size:12px;color:var(--muted,#94a3b8)}
    #lmAdminCustomerInvite .lmaci-table{display:grid;gap:8px}\n    #lmAdminCustomerInvite #lmaciStatusBody{display:grid;gap:8px}
    #lmAdminCustomerInvite .lmaci-row{display:grid;grid-template-columns:minmax(150px,1.35fr) minmax(115px,.8fr) minmax(145px,1fr) minmax(105px,.75fr) minmax(90px,.7fr) auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid var(--border,#334155);border-radius:12px;background:var(--soft,#eef2ff)}
    #lmAdminCustomerInvite .lmaci-row.head{padding:4px 12px 2px;border:0;background:transparent;color:var(--muted,#94a3b8);font-size:11px;font-weight:800}
    #lmAdminCustomerInvite .lmaci-company strong{display:block;font-size:13px}
    #lmAdminCustomerInvite .lmaci-small{font-size:11px;color:var(--muted,#94a3b8);margin-top:2px;overflow-wrap:anywhere}
    #lmAdminCustomerInvite .lmaci-pill{display:inline-flex;align-items:center;border-radius:999px;padding:4px 7px;font-size:10px;font-weight:850;line-height:1.1}
    #lmAdminCustomerInvite .lmaci-pill.success{background:rgba(16,185,129,.12);color:#34d399}
    #lmAdminCustomerInvite .lmaci-pill.info{background:rgba(59,130,246,.12);color:#60a5fa}
    #lmAdminCustomerInvite .lmaci-pill.warning{background:rgba(245,158,11,.12);color:#fbbf24}
    #lmAdminCustomerInvite .lmaci-pill.danger{background:rgba(239,68,68,.12);color:#f87171}
    #lmAdminCustomerInvite .lmaci-pill.neutral{background:rgba(148,163,184,.12);color:var(--muted,#94a3b8)}
    #lmAdminCustomerInvite .lmaci-stack{display:flex;gap:5px;flex-wrap:wrap}
    #lmAdminCustomerInvite .lmaci-empty{padding:14px;border:1px dashed var(--border,#334155);border-radius:12px;color:var(--muted,#94a3b8);font-size:12px}
    #lmAdminCustomerInvite .lmaci-status-error{padding:11px 12px;border-radius:10px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.08);font-size:12px}
    #lmAdminCustomerInvite .lmaci-mini-btn{min-height:32px;padding:6px 9px;border-radius:8px;font-size:11px;white-space:nowrap}
    @media(max-width:980px){
      #lmAdminCustomerInvite .lmaci-row{grid-template-columns:1fr 1fr}
      #lmAdminCustomerInvite .lmaci-row.head{display:none}
      #lmAdminCustomerInvite .lmaci-cell:before{display:block;font-size:10px;font-weight:800;color:var(--muted,#94a3b8);margin-bottom:4px;content:attr(data-label)}
    }
    @media(max-width:720px){
      #lmAdminCustomerInvite .lmaci-grid{grid-template-columns:1fr}
      #lmAdminCustomerInvite .lmaci-plans{grid-template-columns:1fr}
      #lmAdminCustomerInvite .lmaci-row{grid-template-columns:1fr}
    }
  `;
  document.head.appendChild(node);
}

function card(){
  if(!isPlatformAdmin())return null;
  const account=$('#lmSettingsAccountCard');
  if(!account)return null;

  let host=$('#lmAdminCustomerInvite');
  if(!host){
    host=document.createElement('section');
    host.id='lmAdminCustomerInvite';
  }
  if(host.parentElement!==account){
    const users=$('#lmWorkspaceUsers');
    if(users?.parentElement===account)account.insertBefore(host,users);
    else account.appendChild(host);
  }
  return host;
}

function bindPlans(host){
  host.querySelectorAll('[data-lmaci-plan]').forEach(button=>{
    button.addEventListener('click',()=>{
      const value=button.dataset.lmaciPlan;
      const hidden=host.querySelector('#lmaciPlan');
      if(hidden)hidden.value=value;
      host.querySelectorAll('[data-lmaci-plan]').forEach(item=>{
        const active=item.dataset.lmaciPlan===value;
        item.classList.toggle('active',active);
        item.setAttribute('aria-pressed',active?'true':'false');
      });
    });
  });
}

async function loadStatus(host){
  if(statusBusy)return;
  const body=host.querySelector('#lmaciStatusBody');
  const refresh=host.querySelector('#lmaciRefresh');
  if(!body)return;

  statusBusy=true;
  if(refresh)refresh.disabled=true;
  body.innerHTML='<div class="lmaci-empty">Henter onboarding-status…</div>';

  try{
    const result=await edge({action:'status'});
    const rows=Array.isArray(result.customers)?result.customers:[];
    if(!rows.length){
      body.innerHTML='<div class="lmaci-empty">Der er endnu ingen SaaS-kunder i onboarding.</div>';
      return;
    }

    body.innerHTML=rows.map(row=>{
      const active=row.lifecycle==='ACTIVE';
      const inviteDate=row?.invite?.sent_at||row?.invite?.created_at;
      const expiry=row?.invite?.expires_at;
      const lastLogin=row?.login?.last_sign_in_at;
      const button=active?'':`<button type="button" class="btn lmaci-mini-btn" data-lmaci-resend="${esc(row.client_id)}" data-lmaci-email="${esc(row.email||'')}" ${resendBusy.has(row.client_id)?'disabled':''}>${resendBusy.has(row.client_id)?'Sender…':'Send nyt link'}</button>`;
      return `
        <div class="lmaci-row" data-client-id="${esc(row.client_id)}">
          <div class="lmaci-cell lmaci-company" data-label="Kunde">
            <strong>${esc(row.company_name||'Ukendt kunde')}</strong>
            <div class="lmaci-small">${esc(row.email||'Ingen owner-mail')} · ${esc(String(row.plan_code||'—').toUpperCase())}</div>
          </div>
          <div class="lmaci-cell" data-label="Invitation">
            <div class="lmaci-stack">${inviteLabel(row)}</div>
            <div class="lmaci-small">${inviteDate?'Sendt/oprettet '+esc(fmtDate(inviteDate)):'Ingen dato'}${expiry?'<br>Udløber '+esc(fmtDate(expiry)):''}</div>
          </div>
          <div class="lmaci-cell" data-label="Login / 2FA">
            <div class="lmaci-stack">${loginLabel(row)} ${mfaLabel(row)}</div>
            <div class="lmaci-small">${lastLogin?'Sidste login '+esc(fmtDate(lastLogin)):'Intet registreret login'}</div>
          </div>
          <div class="lmaci-cell" data-label="Onboarding">
            ${onboardingLabel(row)}
          </div>
          <div class="lmaci-cell" data-label="Status">
            ${lifecycleLabel(row)}
          </div>
          <div class="lmaci-cell" data-label="Handling">
            ${button}
          </div>
        </div>
      `;
    }).join('');
  }catch(error){
    body.innerHTML='<div class="lmaci-status-error">'+esc(error.message||String(error))+'</div>';
  }finally{
    statusBusy=false;
    if(refresh)refresh.disabled=false;
  }
}

async function resend(host,clientId,email){
  if(!clientId||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||resendBusy.has(clientId))return;
  resendBusy.add(clientId);
  await loadStatus(host);
  try{
    const result=await edge({action:'reissue',client_id:clientId,email});
    if(result.sent!==true)throw new Error('Invitationen blev oprettet, men mailen blev ikke bekræftet sendt.');
    if(typeof toast==='function')toast('Nyt onboarding-link sendt til '+email);
  }catch(error){
    if(typeof toast==='function')toast(error.message||String(error));
    const msg=host.querySelector('#lmaciStatusMsg');
    if(msg)msg.textContent=error.message||String(error);
  }finally{
    resendBusy.delete(clientId);
    await loadStatus(host);
  }
}

async function submit(host){
  if(busy)return;
  const company=String(host.querySelector('#lmaciCompany')?.value||'').trim();
  const name=String(host.querySelector('#lmaciName')?.value||'').trim();
  const email=String(host.querySelector('#lmaciEmail')?.value||'').trim().toLowerCase();
  const plan=String(host.querySelector('#lmaciPlan')?.value||'start');
  const msg=host.querySelector('#lmaciMsg');
  const button=host.querySelector('#lmaciSend');

  if(company.length<2){
    msg.textContent='Indtast virksomhedens navn.';
    return;
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    msg.textContent='Indtast en gyldig e-mail.';
    return;
  }

  busy=true;
  button.disabled=true;
  msg.textContent='Opretter nyt workspace og sender invitation…';
  host.querySelector('#lmaciSuccess')?.remove();

  try{
    const result=await edge({
      action:'create',
      company_name:company,
      recipient_name:name,
      email,
      plan_code:plan
    });
    if(result.sent!==true)throw new Error('Kunden blev oprettet, men invitationen blev ikke bekræftet sendt.');

    const days=Number(result.invite_validity_days||14);
    const success=document.createElement('div');
    success.id='lmaciSuccess';
    success.className='lmaci-success';
    success.innerHTML='<strong>✓ Kunden er oprettet, og invitationen er sendt.</strong><br>'+
      esc(result.company_name||company)+' har fået sit eget workspace på '+esc(plan.toUpperCase())+
      '. Mailen er sendt til '+esc(result.email||email)+', og linket er gyldigt i '+days+' dage.';
    host.querySelector('#lmaciCreateArea')?.appendChild(success);

    host.querySelector('#lmaciCompany').value='';
    host.querySelector('#lmaciName').value='';
    host.querySelector('#lmaciEmail').value='';
    msg.textContent='';

    if(typeof toast==='function')toast('Ny kunde oprettet og invitation sendt');
    window.dispatchEvent(new CustomEvent('lm:admin-customer-created',{detail:{
      client_id:result.client_id||null,
      company_name:result.company_name||company,
      email:result.email||email,
      plan_code:plan
    }}));
    await loadStatus(host);
  }catch(error){
    msg.textContent=error.message||String(error);
  }finally{
    busy=false;
    button.disabled=false;
  }
}

function mount(){
  if(!isPlatformAdmin())return;
  style();
  const host=card();
  if(!host)return;

  if(host.dataset.ready==='1'){
    loadStatus(host);
    return;
  }
  host.dataset.ready='1';
  host.innerHTML=`
    <div id="lmaciCreateArea">
      <div class="lmaci-head">
        <div>
          <h3>Invitér ny kunde</h3>
          <div class="sub">Opret et separat Lead Manager-workspace og send kunden direkte ind i den nye onboarding.</div>
        </div>
        <span class="lmaci-badge">Platform-admin</span>
      </div>
      <div class="lmaci-grid">
        <div class="field">
          <label for="lmaciCompany">Virksomhedsnavn</label>
          <input id="lmaciCompany" autocomplete="organization" placeholder="Fx Firma ApS">
        </div>
        <div class="field">
          <label for="lmaciName">Kontaktperson</label>
          <input id="lmaciName" autocomplete="name" placeholder="Fx Peter Jensen">
        </div>
        <div class="field">
          <label for="lmaciEmail">Kundens e-mail</label>
          <input id="lmaciEmail" type="email" autocomplete="email" placeholder="peter@firma.dk">
        </div>
        <div class="field">
          <label>Pakke</label>
          <input id="lmaciPlan" type="hidden" value="start">
          <div class="lmaci-plans">
            <button type="button" class="lmaci-plan active" data-lmaci-plan="start" aria-pressed="true"><strong>Start</strong><span>149 kr./md.</span></button>
            <button type="button" class="lmaci-plan" data-lmaci-plan="pro" aria-pressed="false"><strong>Pro</strong><span>199 kr./md.</span></button>
            <button type="button" class="lmaci-plan" data-lmaci-plan="business" aria-pressed="false"><strong>Business</strong><span>249 kr./md.</span></button>
          </div>
        </div>
      </div>
      <div class="lmaci-actions">
        <button type="button" class="btn primary" id="lmaciSend">Opret kunde og send invitation</button>
        <div id="lmaciMsg" class="lmaci-msg" role="status" aria-live="polite"></div>
      </div>
      <div class="lm-settings-note" style="margin-top:12px">Invitationen fører kunden gennem password, 2-faktor-login og de 4 onboarding-trin. Brug <strong>+ Invitér bruger</strong> længere nede til ekstra brugere på en eksisterende kundekonto.</div>
    </div>

    <div class="lmaci-status">
      <div class="lmaci-status-head">
        <div>
          <h3>Onboarding-status</h3>
          <div class="lmaci-status-note">Se om invitationen er sendt, login og 2FA er oprettet, hvilket trin kunden er på, og om kunden er aktiv.</div>
        </div>
        <button type="button" class="btn lmaci-mini-btn" id="lmaciRefresh">Opdater</button>
      </div>
      <div id="lmaciStatusMsg" class="lmaci-msg" role="status" aria-live="polite"></div>
      <div class="lmaci-table">
        <div class="lmaci-row head">
          <div>Kunde</div><div>Invitation</div><div>Login / 2FA</div><div>Onboarding</div><div>Status</div><div>Handling</div>
        </div>
        <div id="lmaciStatusBody"><div class="lmaci-empty">Henter onboarding-status…</div></div>
      </div>
    </div>
  `;

  bindPlans(host);
  host.querySelector('#lmaciSend')?.addEventListener('click',()=>submit(host));
  host.querySelector('#lmaciRefresh')?.addEventListener('click',()=>loadStatus(host));
  host.querySelector('#lmaciStatusBody')?.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-lmaci-resend]');
    if(!button)return;
    resend(host,String(button.dataset.lmaciResend||''),String(button.dataset.lmaciEmail||''));
  });
  loadStatus(host);
}

window.LMAdminCustomerInvite={mount,refresh:()=>{const host=$('#lmAdminCustomerInvite');if(host)loadStatus(host)}};
window.addEventListener('lm:client-switched',()=>setTimeout(mount,0));
window.addEventListener('lm:settings-open-request',()=>setTimeout(mount,0));
window.addEventListener('lm:admin-customer-created',()=>setTimeout(()=>{const host=$('#lmAdminCustomerInvite');if(host)loadStatus(host)},0));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,0),{once:true});
else setTimeout(mount,0);
})();