import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v:any,n=2000)=>String(v??'').trim().slice(0,n);
const allowedAgreementTypes=new Set(['article_28_dpa','article_28_dpa_managed_instructions']);

function address(parts:any[]){
  return parts.map(x=>clean(x,300)).filter(Boolean).join(', ');
}
async function sha256Hex(input:string){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function missingIdentity(i:any){
  const miss:string[]=[];
  if(!clean(i?.legal_name))miss.push('legal_name');
  if(!clean(i?.cvr))miss.push('cvr');
  if(!clean(i?.street_address))miss.push('street_address');
  if(!clean(i?.postal_code))miss.push('postal_code');
  if(!clean(i?.city))miss.push('city');
  if(!clean(i?.privacy_email))miss.push('privacy_email');
  return miss;
}
function renderTemplate(tpl:string,vars:Record<string,string>){
  let out=tpl;
  for(const [k,v] of Object.entries(vars)) out=out.split('{{'+k+'}}').join(v||'—');
  return out;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return json({error:'Mangler login-token',code:'NO_TOKEN'},401);
    const body=await req.json().catch(()=>({}));
    const action=clean(body.action||'status',40);
    const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:ud,error:ue}=await admin.auth.getUser(token);
    const user=ud?.user;
    if(ue||!user?.id||!user.email)return json({error:'Ugyldigt eller udløbet login',code:'INVALID_LOGIN'},401);

    const {data:platformAdmin,error:pae}=await admin.from('crm_platform_admins')
      .select('auth_user_id').eq('auth_user_id',user.id).eq('active',true).maybeSingle();
    if(pae)throw pae;
    const isPlatformAdmin=!!platformAdmin;

    if(action==='provider_identity_status'||action==='save_provider_identity'){
      if(!isPlatformAdmin)return json({error:'Kun platformadministrator kan ændre juridisk udbyderidentitet',code:'PLATFORM_ADMIN_REQUIRED'},403);
      const {data:currentIdentity,error:cie}=await admin.from('crm_platform_legal_identity').select('*').eq('id',1).maybeSingle();
      if(cie)throw cie;
      if(action==='provider_identity_status'){
        return json({
          ok:true,
          platform_admin:true,
          identity:currentIdentity||{
            id:1,brand_name:'Lead Manager',trading_name:'Lead Manager',country:'Danmark'
          },
          missing:missingIdentity(currentIdentity)
        });
      }

      if(body.confirm_identity!==true)
        return json({error:'Du skal bekræfte, at oplysningerne er korrekte',code:'IDENTITY_CONFIRM_REQUIRED'},400);

      const input=body.identity||{};
      const legalName=clean(input.legal_name,300);
      const cvr=clean(input.cvr,40).replace(/\D/g,'');
      const street=clean(input.street_address,300);
      const postal=clean(input.postal_code,40);
      const city=clean(input.city,160);
      const privacyEmail=clean(input.privacy_email,320).toLowerCase();
      const website=clean(input.website,500);
      if(!legalName||!street||!postal||!city||!privacyEmail)
        return json({error:'Juridisk navn, adresse, postnummer, by og privacy-mail skal udfyldes',code:'IDENTITY_FIELDS_REQUIRED'},400);
      if(!/^\d{8}$/.test(cvr))
        return json({error:'CVR skal være 8 cifre',code:'INVALID_CVR'},400);
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyEmail))
        return json({error:'Privacy-mail er ikke gyldig',code:'INVALID_PRIVACY_EMAIL'},400);
      if(website){
        try{
          const u=new URL(website);
          if(!['https:','http:'].includes(u.protocol))throw new Error('protocol');
        }catch{
          return json({error:'Website skal være en gyldig http/https-adresse',code:'INVALID_WEBSITE'},400);
        }
      }

      const now=new Date().toISOString();
      const payload={
        id:1,
        brand_name:'Lead Manager',
        trading_name:'Lead Manager',
        legal_name:legalName,
        cvr,
        street_address:street,
        postal_code:postal,
        city,
        country:clean(input.country,80)||'Danmark',
        privacy_email:privacyEmail,
        website:website||null,
        evidence_source:'platform_owner_verified_in_app',
        verified_by:user.email,
        verified_at:now,
        updated_at:now
      };
      const {data:saved,error:sie}=await admin.from('crm_platform_legal_identity')
        .upsert(payload,{onConflict:'id'}).select('*').single();
      if(sie)throw sie;
      const check=await admin.rpc('crm_refresh_platform_legal_identity_check');
      if(check.error)throw check.error;
      return json({
        ok:true,
        platform_admin:true,
        identity:saved,
        missing:missingIdentity(saved),
        verified:missingIdentity(saved).length===0,
        legal_check:check.data||null
      });
    }


    const {data:members,error:me}=await admin.from('crm_users')
      .select('client_id,email,role,active,auth_user_id')
      .eq('active',true).eq('auth_user_id',user.id);
    if(me)throw me;
    const member=members?.[0];
    if(!member)return json({error:'Brugeren er ikke knyttet til et Lead Manager-workspace',code:'NO_MEMBERSHIP'},403);
    const clientId=member.client_id;

    const [{data:client,error:ce},{data:profile,error:pe},{data:identity,error:ie},{data:subs,error:se}] = await Promise.all([
      admin.from('crm_clients').select('id,name,cvr,website,settings').eq('id',clientId).single(),
      admin.from('crm_client_legal_profiles').select('*').eq('client_id',clientId).maybeSingle(),
      admin.from('crm_platform_legal_identity').select('*').eq('id',1).maybeSingle(),
      admin.from('crm_subprocessors').select('provider,purpose,dpa_status').eq('active',true).order('provider',{ascending:true})
    ]);
    if(ce||!client)throw ce||new Error('Workspace ikke fundet');
    if(pe)throw pe;if(ie)throw ie;if(se)throw se;

    const agreementType=clean(profile?.agreement_type,120);
    const agreementRequired=allowedAgreementTypes.has(agreementType);
    let template:any=null;
    if(agreementRequired){
      const tr=await admin.from('crm_legal_agreement_templates')
        .select('*').eq('agreement_type',agreementType).eq('active',true)
        .order('effective_at',{ascending:false}).limit(1).maybeSingle();
      if(tr.error)throw tr.error;template=tr.data;
    }

    const identityMissing=missingIdentity(identity);
    const identityComplete=identityMissing.length===0;
    const settings=client.settings||{};
    const controllerAddress=address([settings.company_address,settings.postcode,settings.city]);
    const controllerEmail=clean(settings.mail||member.email||user.email,320);
    const subprocessorList=(subs||[]).map((x:any)=>'- '+clean(x.provider,160)+': '+clean(x.purpose,500)+' (DPA-status: '+clean(x.dpa_status,80)+')').join('\n');

    let rendered:string|null=null,renderedHash:string|null=null;
    if(template&&identityComplete){
      rendered=renderTemplate(template.template_body,{
        CONTROLLER_NAME:clean(client.name,300),
        CONTROLLER_CVR:clean(client.cvr,60)||'Ikke registreret i Lead Manager',
        CONTROLLER_ADDRESS:controllerAddress||'Ikke registreret i Lead Manager',
        CONTROLLER_EMAIL:controllerEmail,
        PROCESSOR_LEGAL_NAME:clean(identity.legal_name,300),
        PROCESSOR_TRADING_NAME:clean(identity.trading_name||identity.brand_name,300),
        PROCESSOR_CVR:clean(identity.cvr,60),
        PROCESSOR_ADDRESS:address([identity.street_address,identity.postal_code,identity.city,identity.country]),
        PROCESSOR_PRIVACY_EMAIL:clean(identity.privacy_email,320),
        SUBPROCESSOR_LIST:subprocessorList||'- Ingen aktive underdatabehandlere registreret'
      });
      renderedHash=await sha256Hex(rendered);
    }

    let acceptance:any=null;
    if(template){
      const ar=await admin.from('crm_legal_agreement_acceptances')
        .select('id,agreement_type,agreement_version,template_hash,rendered_hash,accepted_by_email,accepted_at,evidence')
        .eq('client_id',clientId)
        .eq('agreement_type',agreementType)
        .eq('agreement_version',template.version)
        .maybeSingle();
      if(ar.error)throw ar.error;acceptance=ar.data;
    }

    const statusPayload={
      ok:true,
      client:{id:client.id,name:client.name,cvr:client.cvr||null},
      role:member.role,
      platform_admin:isPlatformAdmin,
      legal_profile:profile||null,
      agreement_required:agreementRequired,
      provider_identity_complete:identityComplete,
      provider_identity_missing:identityMissing,
      provider_identity:identityComplete?{
        legal_name:identity.legal_name,cvr:identity.cvr,
        address:address([identity.street_address,identity.postal_code,identity.city,identity.country]),
        privacy_email:identity.privacy_email,trading_name:identity.trading_name||identity.brand_name
      }:null,
      agreement:template?{
        agreement_type:agreementType,version:template.version,title:template.title,
        template_hash:template.template_hash,effective_at:template.effective_at,
        accepted:!!acceptance,accepted_at:acceptance?.accepted_at||null,
        accepted_by_email:acceptance?.accepted_by_email||null
      }:null
    };

    if(action==='status')return json(statusPayload);
    if(action==='preview'){
      if(!agreementRequired)return json({...statusPayload,rendered_text:null});
      if(!identityComplete)return json({error:'Udbyderens juridiske identitet er ikke færdigregistreret',code:'PROVIDER_IDENTITY_INCOMPLETE',missing:identityMissing},409);
      if(!template||!rendered)return json({error:'Aftaleskabelon mangler',code:'AGREEMENT_TEMPLATE_MISSING'},409);
      return json({...statusPayload,rendered_text:rendered,rendered_hash:renderedHash});
    }
    if(action!=='accept')return json({error:'Ukendt handling'},400);

    if(!['owner','admin'].includes(String(member.role||'').toLowerCase()))
      return json({error:'Kun ejer/admin kan acceptere databehandleraftalen',code:'ROLE_FORBIDDEN'},403);
    if(!agreementRequired)return json({error:'Dette workspace kræver ikke en DPA-accept i dette flow',code:'AGREEMENT_NOT_REQUIRED'},409);
    if(!identityComplete)return json({error:'Udbyderens juridiske identitet er ikke færdigregistreret',code:'PROVIDER_IDENTITY_INCOMPLETE',missing:identityMissing},409);
    if(!template||!rendered||!renderedHash)return json({error:'Aftaleskabelon mangler',code:'AGREEMENT_TEMPLATE_MISSING'},409);
    if(body.accept_ack!==true)return json({error:'Aftalen skal bekræftes aktivt',code:'AGREEMENT_ACK_REQUIRED'},400);
    if(clean(body.version,80)!==template.version||clean(body.template_hash,128)!==template.template_hash)
      return json({error:'Aftalen er ændret. Hent den nyeste version og gennemse den igen.',code:'AGREEMENT_VERSION_STALE'},409);

    const now=new Date().toISOString();
    const evidence={
      mechanism:'in_app_clickwrap',
      user_agent:clean(req.headers.get('user-agent'),600),
      template_effective_at:template.effective_at,
      provider_identity_verified_at:identity.verified_at||null
    };
    const {data:acc,error:ae}=await admin.from('crm_legal_agreement_acceptances').upsert({
      client_id:clientId,
      agreement_type:agreementType,
      agreement_version:template.version,
      template_hash:template.template_hash,
      rendered_hash:renderedHash,
      rendered_snapshot:rendered,
      accepted_by_user_id:user.id,
      accepted_by_email:user.email,
      accepted_at:now,
      evidence
    },{onConflict:'client_id,agreement_type,agreement_version'}).select('id,accepted_at,accepted_by_email').single();
    if(ae)throw ae;

    const nextLegalStatus=profile?.requires_legal_review===true?'review_required':'customer_confirmed';
    const {error:ue2}=await admin.from('crm_client_legal_profiles').update({
      legal_status:nextLegalStatus,
      agreement_status:'accepted',
      agreement_version:template.version,
      agreement_basis:'in_app_acceptance',
      agreement_evidence_url:'db://crm_legal_agreement_acceptances/'+acc.id,
      agreement_accepted_by:user.email,
      agreement_accepted_at:now,
      confirmed_by_email:user.email,
      confirmed_at:profile?.confirmed_at||now,
      updated_at:now
    }).eq('client_id',clientId);
    if(ue2)throw ue2;

    await admin.from('crm_client_legal_profile_audit').insert({
      client_id:clientId,
      actor_email:user.email,
      actor_type:'customer_user',
      event_type:'legal_agreement_accepted',
      old_service_model:profile?.service_model||null,
      new_service_model:profile?.service_model||null,
      old_legal_status:profile?.legal_status||null,
      new_legal_status:nextLegalStatus,
      metadata:{
        agreement_type:agreementType,agreement_version:template.version,
        template_hash:template.template_hash,rendered_hash:renderedHash,
        acceptance_id:acc.id
      }
    });

    return json({ok:true,accepted:true,acceptance_id:acc.id,accepted_at:acc.accepted_at,agreement_version:template.version});
  }catch(err){
    console.error(err);
    const msg=err instanceof Error?err.message:String(err);
    return json({error:msg,code:'INTERNAL_ERROR'},500);
  }
});