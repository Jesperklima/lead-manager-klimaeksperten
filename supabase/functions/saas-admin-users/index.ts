import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const text=(v:unknown,n=320)=>String(v??'').trim().slice(0,n);

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return json({error:'Method not allowed'},405);
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token) return json({error:'Mangler login'},401);

    const url=Deno.env.get('SUPABASE_URL')!;
    const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:ud,error:ue}=await admin.auth.getUser(token);
    const actor=ud?.user;
    if(ue||!actor?.id||!actor.email) return json({error:'Ugyldigt login'},401);

    // Platform admin is deliberately stricter than being owner/admin of a customer workspace.
    // A valid platform admin must have cross-client access to at least one INTERNAL workspace.
    const {data:access,error:ae}=await admin.from('crm_admin_client_access').select('client_id,source').eq('auth_user_id',actor.id);
    if(ae) throw ae;
    const accessClientIds=[...new Set((access||[]).map((x:any)=>x.client_id).filter(Boolean))];
    if(!accessClientIds.length) return json({error:'Kun platform-admin kan administrere kunder og brugere',code:'ADMIN_ONLY'},403);
    const {data:anchors,error:le}=await admin.from('crm_usage_limits').select('client_id,plan_code').in('client_id',accessClientIds);
    if(le) throw le;
    const internalAnchor=(anchors||[]).find((x:any)=>x.plan_code==='internal');
    if(!internalAnchor) return json({error:'Kun platform-admin kan administrere kunder og brugere',code:'ADMIN_ONLY'},403);

    const body=await req.json().catch(()=>({}));
    const action=text(body.action||'list',40).toLowerCase();

    async function isPlatformAdminUser(authUserId:string|null){
      if(!authUserId) return false;
      const {data:a}=await admin.from('crm_admin_client_access').select('client_id').eq('auth_user_id',authUserId);
      const ids=[...new Set((a||[]).map((x:any)=>x.client_id).filter(Boolean))];
      if(!ids.length) return false;
      const {data:l}=await admin.from('crm_usage_limits').select('client_id,plan_code').in('client_id',ids);
      return !!(l||[]).some((x:any)=>x.plan_code==='internal');
    }

    async function listAll(){
      const [{data:clients,error:ce},{data:users,error:use},{data:limits,error:lie},{data:invites,error:ie}]=await Promise.all([
        admin.from('crm_clients').select('id,name,created_at,settings').order('created_at',{ascending:true}),
        admin.from('crm_users').select('email,client_id,role,active,created_at,auth_user_id').order('created_at',{ascending:true}),
        admin.from('crm_usage_limits').select('client_id,plan_code,monthly_lead_limit,daily_search_run_limit,monthly_enrichment_limit,monthly_ai_draft_limit,allow_minuba,updated_at'),
        admin.from('crm_onboarding_invites').select('client_id,email,status,sent_at,used_at,expires_at,created_at').order('created_at',{ascending:false})
      ]);
      if(ce) throw ce;if(use) throw use;if(lie) throw lie;if(ie) throw ie;
      const authIds=[...new Set((users||[]).map((u:any)=>u.auth_user_id).filter(Boolean))];
      const authMap:Record<string,any>={};
      if(authIds.length){
        const {data:authList}=await admin.auth.admin.listUsers({page:1,perPage:1000});
        for(const u of authList?.users||[]) authMap[u.id]=u;
      }
      const latestInvite:Record<string,any>={};
      for(const i of invites||[]) if(!latestInvite[i.client_id]) latestInvite[i.client_id]=i;
      const limitMap=Object.fromEntries((limits||[]).map((l:any)=>[l.client_id,l]));
      const grouped=(clients||[]).map((c:any)=>({
        id:c.id,
        name:c.name,
        created_at:c.created_at,
        plan:limitMap[c.id]||null,
        invitation:latestInvite[c.id]||null,
        users:(users||[]).filter((u:any)=>u.client_id===c.id).map((u:any)=>({
          email:u.email,
          role:u.role,
          active:u.active,
          created_at:u.created_at,
          auth_user_id:u.auth_user_id,
          activated:!!u.auth_user_id,
          last_sign_in_at:u.auth_user_id?authMap[u.auth_user_id]?.last_sign_in_at||null:null
        }))
      }));
      return {ok:true,is_platform_admin:true,actor_email:actor.email,clients:grouped};
    }

    if(action==='list') return json(await listAll());

    const clientId=text(body.client_id,80);
    if(!clientId) return json({error:'client_id mangler'},400);
    const {data:target,error:te}=await admin.from('crm_clients').select('id,name').eq('id',clientId).maybeSingle();
    if(te) throw te;if(!target) return json({error:'Kunden findes ikke'},404);
    const {data:currentLimit,error:cle}=await admin.from('crm_usage_limits').select('plan_code').eq('client_id',clientId).maybeSingle();
    if(cle) throw cle;

    if(action==='update_plan'){
      const plan=text(body.plan_code,20).toLowerCase();
      if(!['start','pro','business'].includes(plan)) return json({error:'Ugyldig pakke'},400);
      if(currentLimit?.plan_code==='internal') return json({error:'Den interne platformpakke kan ikke ændres her'},409);
      const {error:pe}=await admin.rpc('crm_apply_plan',{p_client_id:clientId,p_plan_code:plan});
      if(pe) throw pe;
      await admin.from('crm_activities').insert({
        client_id:internalAnchor.client_id,type:'Admin ændring',actor_type:'user',actor_name:actor.email,
        summary:`Pakke ændret for ${target.name}: ${currentLimit?.plan_code||'ukendt'} → ${plan}`,
        metadata:{target_client_id:clientId,action:'update_plan',previous_plan:currentLimit?.plan_code||null,new_plan:plan}
      });
      return json({ok:true,client_id:clientId,plan_code:plan});
    }

    if(action==='update_user'){
      const email=text(body.email,320).toLowerCase();
      if(!email) return json({error:'E-mail mangler'},400);
      const {data:member,error:me}=await admin.from('crm_users').select('email,client_id,role,active,auth_user_id').eq('client_id',clientId).ilike('email',email).maybeSingle();
      if(me) throw me;if(!member) return json({error:'Brugeren findes ikke hos kunden'},404);
      const protectedAdmin=await isPlatformAdminUser(member.auth_user_id);
      const patch:any={};
      if(Object.prototype.hasOwnProperty.call(body,'active')){
        const nextActive=!!body.active;
        if(protectedAdmin&&!nextActive) return json({error:'En platform-admin kan ikke deaktiveres fra kundeadministrationen'},409);
        patch.active=nextActive;
      }
      if(Object.prototype.hasOwnProperty.call(body,'role')){
        const role=text(body.role,30).toLowerCase();
        if(!['owner','admin','user'].includes(role)) return json({error:'Ugyldig rolle'},400);
        if(protectedAdmin&&role!=='owner') return json({error:'En platform-admins hjemmerolle kan ikke nedgraderes her'},409);
        patch.role=role;
      }
      if(!Object.keys(patch).length) return json({error:'Ingen ændringer angivet'},400);
      const {error:up}=await admin.from('crm_users').update(patch).eq('client_id',clientId).ilike('email',email);
      if(up) throw up;
      await admin.from('crm_activities').insert({
        client_id:internalAnchor.client_id,type:'Admin ændring',actor_type:'user',actor_name:actor.email,
        summary:`Bruger ændret hos ${target.name}: ${email}`,
        metadata:{target_client_id:clientId,target_email:email,action:'update_user',previous:{role:member.role,active:member.active},next:patch}
      });
      return json({ok:true,client_id:clientId,email,...patch});
    }

    return json({error:'Ukendt handling'},400);
  }catch(err){
    console.error(err);
    return json({error:err instanceof Error?err.message:String(err),code:'ADMIN_USERS_FAILED'},500);
  }
});
