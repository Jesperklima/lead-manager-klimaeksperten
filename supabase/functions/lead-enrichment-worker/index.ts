import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type, x-lead-worker-secret',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}
});
const clean=(v:unknown,max=4000)=>String(v??'').trim().slice(0,max);

function usablePhone(value:unknown){
  const v=clean(value,120),digits=v.replace(/\D/g,'');
  return digits.length>=6?v:'';
}
function usableEmail(value:unknown){
  const v=clean(value,320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?v:'';
}
function cleanDomain(value:unknown){
  return clean(value,500).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].split(':')[0].trim();
}
function sourceMatchesDomain(source:unknown,domain:unknown){
  const d=cleanDomain(domain);
  const src=clean(source,1800);
  if(!d)return /^https?:\/\//i.test(src);
  try{
    const h=new URL(src).hostname.toLowerCase().replace(/^www\./,'');
    return h===d||h.endsWith('.'+d);
  }catch{return false}
}
function emailMatchesDomain(email:unknown,domain:unknown){
  const e=usableEmail(email),d=cleanDomain(domain);
  if(!e||!d)return !!e;
  const ed=e.split('@')[1]||'';
  return ed===d||ed.endsWith('.'+d);
}
function parseResponse(data:any){
  let text=clean(data?.output_text,30000);
  if(!text){
    for(const item of data?.output||[]){
      for(const part of item?.content||[]){
        if(typeof part?.text==='string')text+=part.text;
      }
    }
  }
  try{return JSON.parse(text.replace(/^\`\`\`json\s*/i,'').replace(/\`\`\`$/,'').trim()||'{}')}
  catch{return {}}
}
async function queueMinuba(admin:any,clientId:string,companyId:string,leadId:string|null,requestId:string,companyName:string){
  const {data:conn}=await admin.from('crm_oauth_connections').select('provider')
    .eq('client_id',clientId).eq('provider','minuba').maybeSingle();
  if(!conn)return 'not_connected';
  const {error}=await admin.from('crm_agent_requests').insert({
    client_id:clientId,
    company_id:companyId,
    lead_id:leadId,
    request_type:'minuba_history_check',
    status:'queued',
    request_text:'Krydstjek '+companyName+' i kundens egen Minuba før leadet frigives.',
    payload:{
      action:'minuba_history_check',
      company_id:companyId,
      lead_id:leadId,
      source_request_id:requestId,
      gate_before_display:true
    },
    created_by:'lead-enrichment-worker'
  });
  if(error)throw error;
  return 'queued';
}
async function researchContact(admin:any,clientId:string,company:any){
  const {data:apiKey,error:keyError}=await admin.rpc('get_openai_api_secret',{p_client_id:clientId});
  if(keyError||!apiKey)throw new Error('OpenAI API-nøgle mangler til kontaktberigelse');

  const schema={
    type:'object',additionalProperties:false,
    properties:{
      company_phone:{type:'string'},
      general_email:{type:'string'},
      website_url:{type:'string'},
      source_url:{type:'string'},
      contact_name:{type:'string'},
      contact_title:{type:'string'},
      contact_phone:{type:'string'},
      contact_email:{type:'string'},
      contact_source_url:{type:'string'},
      confidence:{type:'string',enum:['high','medium','low']}
    },
    required:[
      'company_phone','general_email','website_url','source_url',
      'contact_name','contact_title','contact_phone','contact_email',
      'contact_source_url','confidence'
    ]
  };

  const input=[
    'Find mindst én brugbar, offentlig kontaktkanal til denne B2B-virksomhed eller myndighed.',
    'Virksomhed: '+clean(company.name,500),
    'Domæne: '+clean(company.domain,500),
    'Hjemmeside: '+clean(company.website_url,1000),
    'CVR: '+clean(company.cvr,100),
    'Adresse: '+clean(company.address,1000),
    'Eksisterende hovedtelefon: '+clean(company.phone,120),
    'Eksisterende standardmail: '+clean(company.email,320),
    '',
    'Prioritet:',
    '1) Find officiel hovedtelefon og generel e-mail fra virksomhedens eller myndighedens egen officielle hjemmeside.',
    '2) Find derefter, hvis muligt, én relevant navngiven beslutningstager med offentlig arbejdstelefon eller arbejdsmail.',
    '3) Brug kun oplysninger der står eksplicit i en officiel kilde. Udled eller gæt aldrig e-mail eller telefon.',
    '4) Returnér tom streng for alt, der ikke kan dokumenteres sikkert.',
    '5) source_url/contact_source_url skal være den præcise officielle side, hvor kontaktoplysningen står.'
  ].join('\n');

  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{Authorization:'Bearer '+String(apiKey),'Content-Type':'application/json'},
    body:JSON.stringify({
      model:'gpt-5.6-luna',
      instructions:'Du er en kildekritisk dansk B2B research-agent. Gem aldrig gættede kontaktdata. Brug virksomhedens eller myndighedens egen officielle hjemmeside som primær kilde.',
      input,
      tools:[{type:'web_search',search_context_size:'medium',user_location:{type:'approximate',country:'DK'}}],
      reasoning:{effort:'low'},
      max_output_tokens:1800,
      text:{format:{type:'json_schema',name:'contact_enrichment',strict:true,schema}},
      store:false,
      prompt_cache_key:'lm-contact-enrichment-'+String(clientId).slice(0,8)
    })
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(clean(data?.error?.message||('OpenAI '+response.status),2000));

  const result=parseResponse(data);
  const confidence=clean(result.confidence,30);
  const companyDomain=cleanDomain(company.domain||company.website_url);
  const companySource=clean(result.source_url,1800);
  const personSource=clean(result.contact_source_url,1800);
  const officialCompany=confidence==='high'&&sourceMatchesDomain(companySource,companyDomain);
  const officialPerson=confidence==='high'&&sourceMatchesDomain(personSource||companySource,companyDomain);

  return {
    confidence,
    companySource,
    personSource,
    companyPhone:officialCompany?usablePhone(result.company_phone):'',
    generalEmail:officialCompany&&emailMatchesDomain(result.general_email,companyDomain)?usableEmail(result.general_email):'',
    websiteUrl:officialCompany?clean(result.website_url,1000):'',
    contactName:officialPerson?clean(result.contact_name,500):'',
    contactTitle:officialPerson?clean(result.contact_title,500):'',
    contactPhone:officialPerson?usablePhone(result.contact_phone):'',
    contactEmail:officialPerson&&emailMatchesDomain(result.contact_email,companyDomain)?usableEmail(result.contact_email):''
  };
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);

  const url=Deno.env.get('SUPABASE_URL')!;
  const admin=createClient(
    url,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {auth:{persistSession:false,autoRefreshToken:false}}
  );

  const {data:expected}=await admin.rpc('get_lead_enrichment_worker_secret_for_service');
  if(!expected||req.headers.get('x-lead-worker-secret')!==expected)return json({error:'Unauthorized'},401);

  const body=await req.json().catch(()=>({}));
  const requestId=clean((body as any).request_id,100);
  if(!requestId)return json({error:'Mangler request_id'},400);

  const {data:r,error}=await admin.from('crm_agent_requests').select('*').eq('id',requestId).single();
  if(error||!r)return json({error:'Anmodning ikke fundet'},404);
  if(r.payload?.action!=='contact_enrichment')return json({error:'Forkert request-type'},400);
  if(r.status==='done')return json({ok:true,request_id:requestId,already_done:true});

  const clientId=r.client_id,companyId=r.company_id,leadId=r.lead_id;

  try{
    const startedAt=new Date().toISOString();
    await admin.from('crm_agent_requests').update({
      status:'running',started_at:startedAt,error_text:null
    }).eq('id',requestId).in('status',['queued','error']);

    const {data:company}=await admin.from('crm_companies').select('*')
      .eq('id',companyId).eq('client_id',clientId).single();
    if(!company)throw new Error('Virksomhed mangler');

    const {data:contacts,error:contactsError}=await admin.from('crm_contacts').select('*')
      .eq('client_id',clientId).eq('company_id',companyId);
    if(contactsError)throw contactsError;

    let lead:any=null;
    if(leadId){
      const {data}=await admin.from('crm_leads').select('id,status,next_action,manual_lock')
        .eq('id',leadId).eq('client_id',clientId).maybeSingle();
      lead=data||null;
    }

    const existingContacts=contacts||[];
    const hasExistingContact=existingContacts.some((x:any)=>usablePhone(x.phone)||usableEmail(x.email));
    const currentPhone=usablePhone(company.phone);
    const currentEmail=usableEmail(company.email);
    const needsResearch=!(currentPhone||currentEmail||hasExistingContact);

    let research:any=null;
    let aiUsed=false;

    if(needsResearch){
      research=await researchContact(admin,clientId,company);
      aiUsed=true;

      const companyPatch:any={research_updated_at:new Date().toISOString()};
      if(research.companyPhone)companyPatch.phone=research.companyPhone;
      if(research.generalEmail)companyPatch.email=research.generalEmail;
      if(research.websiteUrl)companyPatch.website_url=research.websiteUrl;

      const {error:companyUpdateError}=await admin.from('crm_companies').update(companyPatch)
        .eq('id',companyId).eq('client_id',clientId);
      if(companyUpdateError)throw companyUpdateError;

      if(research.contactName&&(research.contactPhone||research.contactEmail)){
        const duplicate=existingContacts.some((x:any)=>{
          const sameEmail=research.contactEmail&&usableEmail(x.email)===research.contactEmail;
          const samePhone=research.contactPhone&&usablePhone(x.phone).replace(/\D/g,'')===research.contactPhone.replace(/\D/g,'');
          return sameEmail||samePhone;
        });
        if(!duplicate){
          const now=new Date().toISOString();
          const payload:any={
            client_id:clientId,
            company_id:companyId,
            full_name:research.contactName,
            title:research.contactTitle||null,
            phone:research.contactPhone||null,
            email:research.contactEmail||null,
            source_url:research.personSource||research.companySource||null,
            verified:true,
            source_type:'official_website',
            verified_at:now,
            confidence:'high',
            role_relevance:'Relevant kontaktperson',
            is_decision_maker:true,
            email_is_inferred:false,
            provenance_status:'documented',
            provenance_review_required:false,
            provenance_note:'Kontaktdata verificeret mod officiel offentlig kilde af Lead Enricher.',
            source_obtained_at:now,
            collection_method:'indirect'
          };
          if(research.contactEmail){
            payload.email_verification_method='exact_source_text';
            payload.email_source_url=research.personSource||research.companySource||null;
            payload.email_verified_at=now;
          }
          const {error:insertError}=await admin.from('crm_contacts').insert(payload);
          if(insertError)throw insertError;
        }
      }

      await admin.from('crm_usage_events').insert({
        client_id:clientId,
        event_type:'lead_enrichment',
        quantity:1,
        metadata:{request_id:requestId,company_id:companyId,worker:'lead-enrichment-worker-v5'}
      });
    }

    const finalPhone=research?.companyPhone||currentPhone;
    const finalEmail=research?.generalEmail||currentEmail;
    const finalNamed=hasExistingContact||!!(research?.contactPhone||research?.contactEmail);
    const usable=!!(finalPhone||finalEmail||finalNamed);

    if(lead&&!lead.manual_lock){
      if(!usable&&!['TABT','IKKE RELEVANT','VUNDET'].includes(lead.status)){
        const {error:leadError}=await admin.from('crm_leads').update({
          status:'UNDER VURDERING',
          next_action:'Mangler verificeret standardmail eller telefon – kræver manuel kontaktresearch',
          next_at:null
        }).eq('id',lead.id).eq('client_id',clientId);
        if(leadError)throw leadError;
      }else if(
        usable&&lead.status==='UNDER VURDERING'&&
        /^Mangler verificeret standardmail eller telefon/.test(clean(lead.next_action,500))
      ){
        const {error:leadError}=await admin.from('crm_leads').update({
          status:'NY',
          next_action:'Vurder lead og kontakt via verificeret kanal'
        }).eq('id',lead.id).eq('client_id',clientId);
        if(leadError)throw leadError;
      }
    }

    const minubaStatus=await queueMinuba(admin,clientId,companyId,leadId,requestId,company.name);
    const now=new Date().toISOString();
    const contactSummary=usable
      ? 'Kontaktberigelse gennemført. Der er mindst én brugbar kontaktkanal.'
      : 'Ingen verificeret standardmail eller telefon blev fundet. Leadet er sat UNDER VURDERING.';
    const responseText=contactSummary+(minubaStatus==='queued'
      ? ' Minuba-krydstjek er sat i kø.'
      : ' Ingen Minuba-forbindelse på dette workspace.');

    const resultPayload={
      ...(r.payload||{}),
      worker:'lead-enrichment-worker-v5',
      worker_finished_at:now,
      contact_channel:{
        usable,
        company_phone:finalPhone||null,
        company_email:finalEmail||null,
        named_contact:finalNamed,
        ai_used:aiUsed,
        source_url:research?.companySource||research?.personSource||null
      },
      minuba_check:minubaStatus
    };

    await admin.from('crm_agent_requests').update({
      status:'done',
      response_text:responseText,
      completed_at:now,
      error_text:null,
      payload:resultPayload
    }).eq('id',requestId);

    await admin.from('crm_activities').insert({
      client_id:clientId,
      company_id:companyId,
      lead_id:leadId,
      type:'Lead enrichment',
      actor_type:'agent',
      actor_name:'Lead Enricher',
      summary:responseText,
      metadata:{
        request_id:requestId,
        minuba_check:minubaStatus,
        contact_usable:usable,
        ai_used:aiUsed
      }
    });

    return json({
      ok:true,
      request_id:requestId,
      contact_usable:usable,
      ai_used:aiUsed,
      minuba_check:minubaStatus
    });
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    await admin.from('crm_agent_requests').update({
      status:'error',
      error_text:msg,
      completed_at:new Date().toISOString()
    }).eq('id',requestId);
    return json({error:msg},500);
  }
});
