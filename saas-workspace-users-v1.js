(()=>{
'use strict';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let loading=false;
let snapshot=null;
let mountedClientId='';

async function session(){
  if(typeof supabase==='undefined')return null;
  const result=await supabase.auth.getSession();
  return result?.data?.session||null;
}

async function edge(payload){
  const current=await session();
  if(!current?.access_token)throw new Error('Login-session mangler');
  const response=await fetch(SUPABASE_URL+'/functions/v1/saas-workspace-users',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_KEY,
      Authorization:'Bearer '+current.access_token
    },
    body:JSON.stringify(payload)
  });
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}}
  if(!response.ok){
    const error=new Error(data.error||('HTTP '+response.status));
    error.code=data.code;
    error.status=response.status;
    throw error;
  }
  return data;
}

function style(){
  if($('lmWorkspaceUsersStyle'))return;
  const node=document.createElement('style');
  node.id='lmWorkspaceUsersStyle';
  node.textContent=
    '#lmWorkspaceUsers{margin-top:20px;padding-top:18px;border-top:1px solid var(--border,#dbe3e8)}'+
    '#lmWorkspaceUsers .lmwu-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}'+
    '#lmWorkspaceUsers .lmwu-head h3{margin:0 0 4px;font-size:16px}'+
    '#lmWorkspaceUsers .lmwu-list{display:grid;gap:8px}'+
    '#lmWorkspaceUsers .lmwu-row{display:grid;grid-template-columns:minmax(180px,1.5fr) 120px 120px auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid var(--border,#dbe3e8);border-radius:12px;background:var(--panel,#fff)}'+
    '#lmWorkspaceUsers .lmwu-email{font-weight:800;overflow-wrap:anywhere;color:var(--text,#14202a)}'+
    '#lmWorkspaceUsers .lmwu-meta{font-size:11px;color:var(--muted,#66737d);margin-top:2px}'+
    '#lmWorkspaceUsers .lmwu-status{font-size:11px;font-weight:800;color:var(--muted,#66737d)}'+
    '#lmWorkspaceUsers .lmwu-status.ok{color:var(--ok,#2d6a4f)}'+
    '#lmWorkspaceUsers .lmwu-status.wait{color:var(--warn,#8a5a12)}'+
    '#lmWorkspaceUsers .lmwu-actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}'+
    '#lmWorkspaceUsers select{min-height:38px;padding:7px 9px;border-radius:9px;border:1px solid var(--border,#dbe3e8);background:var(--panel,#fff);color:var(--text,#14202a)}'+
    '#lmWorkspaceUsers .lmwu-empty{padding:12px;border:1px dashed var(--border,#dbe3e8);border-radius:12px;color:var(--muted,#66737d)}'+
    '#lmWorkspaceUsersModal{position:fixed;inset:0;z-index:19000;background:rgba(3,12,18,.72);display:grid;place-items:center;padding:18px}'+
    '#lmWorkspaceUsersModal .lmwu-modal-card{width:min(520px,96vw);background:var(--panel,#fff);color:var(--text,#14202a);border:1px solid var(--border,#dbe3e8);border-radius:18px;padding:20px;box-shadow:0 26px 80px rgba(0,0,0,.32)}'+
    '#lmWorkspaceUsersModal h3{margin:0 0 6px}'+
    '#lmWorkspaceUsersModal .field{margin:12px 0}'+
    '#lmWorkspaceUsersModal label{display:block;font-size:12px;font-weight:800;margin-bottom:5px;color:var(--muted,#66737d)}'+
    '#lmWorkspaceUsersModal input,#lmWorkspaceUsersModal select{width:100%;min-height:42px;padding:9px 10px;border:1px solid var(--border,#dbe3e8);border-radius:10px;background:var(--panel,#fff);color:var(--text,#14202a)}'+
    '#lmWorkspaceUsersModal .lmwu-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}'+
    '#lmWorkspaceUsersModal .lmwu-msg{min-height:20px;margin-top:9px;font-size:12px;color:var(--muted,#66737d)}'+
    '@media(max-width:760px){#lmWorkspaceUsers .lmwu-row{grid-template-columns:1fr 1fr}#lmWorkspaceUsers .lmwu-actions{justify-content:flex-start}}';
  document.head.appendChild(node);
}

function clientId(){
  try{return state?.client?.id||''}catch{return ''}
}

function roleLabel(role){
  return ({owner:'Owner',admin:'Admin',user:'Bruger'})[role]||role||'Bruger';
}

function statusLabel(user){
  if(!user.active)return 'Inaktiv';
  if(user.pending||!user.activated)return 'Afventer aktivering';
  return 'Aktiv';
}

function render(){
  const host=$('lmWorkspaceUsers');
  if(!host||!snapshot)return;
  const canManage=snapshot.can_manage===true;
  const users=Array.isArray(snapshot.users)?snapshot.users:[];
  let rows='';
  for(const user of users){
    const status=statusLabel(user);
    const statusClass=!user.active?'':((user.pending||!user.activated)?'wait':'ok');
    let roleControl='<strong>'+esc(roleLabel(user.role))+'</strong>';
    if(canManage&&user.role!=='owner'){
      roleControl=
        '<select class="lmwu-role" data-email="'+esc(user.email)+'" aria-label="Rolle for '+esc(user.email)+'">'+
        '<option value="user" '+(user.role==='user'?'selected':'')+'>Bruger</option>'+
        '<option value="admin" '+(user.role==='admin'?'selected':'')+'>Admin</option>'+
        '</select>';
    }
    let actions='';
    if(canManage&&user.active&&user.role!=='owner'&&!user.activated){
      actions+='<button type="button" class="btn lmwu-resend" data-email="'+esc(user.email)+'">Gensend</button>';
    }
    if(canManage&&user.active&&user.role!=='owner'&&!user.is_self){
      actions+='<button type="button" class="btn lmwu-deactivate" data-email="'+esc(user.email)+'">Deaktivér</button>';
    }
    rows+=
      '<div class="lmwu-row">'+
        '<div><div class="lmwu-email">'+esc(user.email)+'</div><div class="lmwu-meta">'+(user.is_self?'Din konto':'Workspace-bruger')+'</div></div>'+
        '<div>'+roleControl+'</div>'+
        '<div class="lmwu-status '+statusClass+'">'+esc(status)+'</div>'+
        '<div class="lmwu-actions">'+actions+'</div>'+
      '</div>';
  }

  host.innerHTML=
    '<div class="lmwu-head">'+
      '<div><h3>Brugere</h3><div class="sub">Administrér hvem der har adgang til dette workspace.</div></div>'+
      (canManage?'<button type="button" class="btn primary" id="lmWorkspaceInviteOpen">+ Invitér bruger</button>':'')+
    '</div>'+
    '<div class="lmwu-list">'+(rows||'<div class="lmwu-empty">Ingen brugere fundet.</div>')+'</div>'+
    '<div class="lm-settings-note" style="margin-top:10px">En e-mail kan i øjeblikket kun være knyttet til ét Lead Manager-workspace.</div>';

  $('lmWorkspaceInviteOpen')?.addEventListener('click',openInvite);
  host.querySelectorAll('.lmwu-role').forEach(select=>{
    select.addEventListener('change',async()=>{
      const previous=select.dataset.previous||'';
      try{
        select.disabled=true;
        await run({action:'change_role',email:select.dataset.email,role:select.value});
        select.dataset.previous=select.value;
        if(typeof toast==='function')toast('Brugerrollen er opdateret');
      }catch(error){
        if(previous)select.value=previous;
        if(typeof toast==='function')toast(error.message||String(error));
      }finally{
        select.disabled=false;
      }
    });
    select.dataset.previous=select.value;
  });
  host.querySelectorAll('.lmwu-resend').forEach(button=>button.addEventListener('click',()=>resend(button)));
  host.querySelectorAll('.lmwu-deactivate').forEach(button=>button.addEventListener('click',()=>deactivate(button)));
}

async function load(force=false){
  const id=clientId();
  if(!id||loading)return;
  if(!force&&snapshot&&mountedClientId===id){render();return}
  loading=true;
  try{
    snapshot=await edge({action:'list',client_id:id});
    mountedClientId=id;
    render();
  }catch(error){
    const host=$('lmWorkspaceUsers');
    if(host)host.innerHTML='<div class="lmwu-empty">Kunne ikke hente brugere: '+esc(error.message||String(error))+'</div>';
  }finally{
    loading=false;
  }
}

async function run(payload){
  const id=clientId();
  if(!id)throw new Error('Workspace mangler');
  const result=await edge({...payload,client_id:id});
  if(Array.isArray(result.users)){
    snapshot={...(snapshot||{}),users:result.users};
    render();
  }else{
    await load(true);
  }
  return result;
}

function openInvite(){
  if($('lmWorkspaceUsersModal'))return;
  const modal=document.createElement('div');
  modal.id='lmWorkspaceUsersModal';
  modal.innerHTML=
    '<div class="lmwu-modal-card">'+
      '<h3>Invitér bruger</h3>'+
      '<div class="sub">Brugeren bliver koblet til '+esc(state?.client?.name||'det aktuelle workspace')+'.</div>'+
      '<div class="field"><label>E-mail</label><input id="lmwuInviteEmail" type="email" autocomplete="email" placeholder="navn@firma.dk"></div>'+
      '<div class="field"><label>Rolle</label><select id="lmwuInviteRole"><option value="user">Bruger</option><option value="admin">Admin</option></select></div>'+
      '<div id="lmwuInviteMsg" class="lmwu-msg"></div>'+
      '<div class="lmwu-modal-actions"><button type="button" class="btn" id="lmwuInviteCancel">Annullér</button><button type="button" class="btn primary" id="lmwuInviteSend">Send invitation</button></div>'+
    '</div>';
  document.body.appendChild(modal);
  $('lmwuInviteCancel').onclick=()=>modal.remove();
  $('lmwuInviteSend').onclick=async()=>{
    const email=String($('lmwuInviteEmail').value||'').trim().toLowerCase();
    const role=$('lmwuInviteRole').value;
    const msg=$('lmwuInviteMsg');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      msg.textContent='Indtast en gyldig e-mail.';
      return;
    }
    const button=$('lmwuInviteSend');
    button.disabled=true;
    msg.textContent='Sender invitation…';
    try{
      await run({action:'invite',email,role});
      msg.textContent='✓ Invitation sendt til '+email;
      if(typeof toast==='function')toast('Invitation sendt til '+email);
      setTimeout(()=>modal.remove(),650);
    }catch(error){
      msg.textContent=error.message||String(error);
      button.disabled=false;
    }
  };
  setTimeout(()=>$('lmwuInviteEmail')?.focus(),0);
}

async function resend(button){
  const email=button.dataset.email;
  if(!email)return;
  button.disabled=true;
  const old=button.textContent;
  button.textContent='Sender…';
  try{
    await run({action:'resend',email});
    if(typeof toast==='function')toast('Invitation gensendt til '+email);
  }catch(error){
    if(typeof toast==='function')toast(error.message||String(error));
  }finally{
    button.disabled=false;
    button.textContent=old;
  }
}

async function deactivate(button){
  const email=button.dataset.email;
  if(!email)return;
  if(!window.confirm('Deaktivér adgangen for '+email+'?'))return;
  button.disabled=true;
  try{
    await run({action:'deactivate',email});
    if(typeof toast==='function')toast(email+' er deaktiveret');
  }catch(error){
    if(typeof toast==='function')toast(error.message||String(error));
    button.disabled=false;
  }
}

function mount(){
  style();
  const card=$('lmSettingsAccountCard');
  const id=clientId();
  if(!card||!id)return;
  let host=$('lmWorkspaceUsers');
  if(!host){
    host=document.createElement('section');
    host.id='lmWorkspaceUsers';
    card.appendChild(host);
  }else if(host.parentElement!==card){
    card.appendChild(host);
  }
  if(!snapshot||mountedClientId!==id){
    host.innerHTML='<div class="lmwu-empty">Henter brugere…</div>';
    load(true);
  }else{
    render();
  }
}

window.LMWorkspaceUsers={mount,refresh:()=>load(true)};
window.addEventListener('lm:client-switched',()=>{snapshot=null;mountedClientId='';setTimeout(mount,0)});
window.addEventListener('lm:data-refreshed',()=>{if($('lmWorkspaceUsers'))setTimeout(()=>load(true),0)});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,0),{once:true});
else setTimeout(mount,0);
})();
