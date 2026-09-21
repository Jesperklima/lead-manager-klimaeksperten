import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const json=(value:any,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
});
const clean=(value:any,max=5000)=>String(value??'').trim().slice(0,max);
const norm=(value:any)=>clean(value,300).toLowerCase().replace(/[^a-z0-9æøå]+/g,'');
function errorMessage(error:any,max=3000){
  if(error instanceof Error)return clean(error.message||error.name||'Ukendt fejl',max);
  if(typeof error==='string')return clean(error,max);
  if(error&&typeof error==='object'){
    const parts=[error.message,error.details,error.hint,error.code].map((v:any)=>clean(v,1200)).filter(Boolean);
    if(parts.length)return clean(parts.join(' | '),max);
    try{return clean(JSON.stringify(error),max)}catch{}
  }
  return clean(String(error),max)||'Ukendt fejl';
}
function hasTerminalWords(value:any){
  return /(færdig|udført|installeret|monteret|leveret|afsluttet|ibrugtaget|tildelt|completed|installed|delivered|awarded|closed|contract[^a-zæøå]*(signed|awarded)|kontrakt[^a-zæøå]*(tildelt|indgået))/i.test(clean(value,2400));
}
function saysClosed(value:any){
  const text=clean(value,2400).toLowerCase();
  if(!text||!hasTerminalWords(text))return false;
  const term='(?:færdig|udført|installeret|monteret|leveret|afsluttet|ibrugtaget|tildelt|completed|installed|delivered|awarded|closed)';
  const negated=[
    new RegExp('(?:ikke|ej|ingen|uden|mangler|manglende)[^.;]{0,120}'+term,'i'),
    new RegExp('(?:dokumenterer|viser|bekræfter)[^.;]{0,50}(?:ikke|ingen)[^.;]{0,120}'+term,'i'),
    /(?:ingen|ikke fundet|ikke dokumenteret)[^.;]{0,120}(?:afslutning|tildeling|udførelse|færdiggørelse|ibrugtagning)/i
  ].some(re=>re.test(text));
  return !negated;
}
const supported=new Set(['import_offers_from_mail','reconcile_offers_from_mail','scan_mail_sales_signals','source_freshness_check','contact_enrichment']);

function offerRefs(job:any){
  return [...new Set([
    ...(Array.isArray(job?.payload?.offer_refs)?job.payload.offer_refs:[]),
    ...(clean(job?.request_text,12000).match(/\b\d{3,8}\b/g)||[])
  ].map((v:any)=>clean(v,40)).filter(Boolean))].slice(0,30);
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
async function markDone(sb:any,job:any,responseText:string,result:any){
  const done=new Date().toISOString();
  const {error}=await sb.from('crm_agent_requests').update({
    status:'done',completed_at:done,error_text:null,response_text:clean(responseText,12000),
    payload:{...(job.payload||{}),worker:'lead-manager-command-worker-v2',worker_finished_at:done,worker_result:result}
  }).eq('id',job.id);
  if(error)throw error;
}
async function markError(sb:any,job:any,error:any){
  const message=errorMessage(error,3000);
  const done=new Date().toISOString();
  await sb.from('crm_agent_requests').update({
    status:'error',completed_at:done,error_text:message,
    payload:{...(job.payload||{}),worker:'lead-manager-command-worker-v2',worker_finished_at:done,worker_error:message}
  }).eq('id',job.id);
  return message;
}
async function mailSync(sb:any,url:string,clientId:string){
  const {data:syncSecret,error:secretError}=await sb.rpc('crm_get_mail_offer_sync_secret');
  if(secretError||!syncSecret)throw new Error('Mail/tilbud sync-secret mangler');
  const res=await fetch(url+'/functions/v1/mail-offer-sync-runner',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-mail-offer-sync-secret':String(syncSecret)},
    body:JSON.stringify({client_id:clientId,backfill_days:30,dry_run:false})
  });
  const text=await res.text();
  let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!res.ok)throw new Error(errorMessage(data?.error||text||('Mail sync HTTP '+res.status),2000));
  return data;
}

async function handleOfferSync(sb:any,url:string,job:any){
  const run=await mailSync(sb,url,job.client_id);
  const refs=offerRefs(job);
  if(job.payload?.action==='reconcile_offers_from_mail'||!refs.length){
    const result={sync_ok:run?.ok!==false,requested_offer_refs:refs,sync_result:run};
    await markDone(sb,job,'Mail- og tilbudsafstemning er gennemført.',result);
    return result;
  }

  const {data:offers,error:offerError}=await sb.from('crm_offers')
    .select('id,offer_ref,status,customer_name,follow_up_date')
    .eq('client_id',job.client_id)
    .in('offer_ref',refs);
  if(offerError)throw offerError;
  const found=new Map((offers||[]).map((o:any)=>[norm(o.offer_ref),o]));
  const missing=refs.filter((x:any)=>!found.has(norm(x)));
  const {data:approvals}=await sb.from('crm_approvals')
    .select('id,payload').eq('client_id',job.client_id)
    .eq('action_type','offer_mail_update').eq('status','pending');
  const review=(approvals||[]).filter((a:any)=>refs.some((x:any)=>norm(a?.payload?.offer_ref)===norm(x)))
    .map((a:any)=>({id:a.id,offer_ref:a.payload?.offer_ref,explanation:a.payload?.explanation||null}));
  const result={requested:refs,found:[...found.values()],missing,review,sync_ok:run?.ok!==false,needs_review:missing.length>0};
  await markDone(
    sb,job,
    missing.length?'Mailgennemgang færdig. Mangler kontrol: '+missing.join(', '):'Tilbud '+refs.join(', ')+' er hentet og behandlet.',
    result
  );
  return result;
}

function classifyMail(message:any){
  const text=(clean(message.subject,1000)+' '+clean(message.body_text,12000)).toLowerCase();
  const tests=[
    {type:'no_followup',re:/(følg\s+ikke\s+op|skal\s+ikke\s+følges\s+op|ikke\s+følge\s+op|ingen\s+opfølgning)/i,confidence:'high',action:'Kontrollér og fasthold ingen-opfølgning/suppression.'},
    {type:'offer_accepted',re:/(accepterer\s+(?:jeres\s+)?tilbud|tilbud(?:det)?\s+er\s+godkendt|vi\s+godkender\s+tilbud|vi\s+tager\s+imod\s+tilbud)/i,confidence:'high',action:'Kontrollér om tilbuddet skal markeres VUNDET.'},
    {type:'offer_rejected',re:/(takker\s+nej|afslår\s+(?:jeres\s+)?tilbud|ikke\s+gå\s+videre|går\s+ikke\s+videre|ikke\s+interesseret)/i,confidence:'high',action:'Kontrollér om tilbud/lead skal markeres TABT.'},
    {type:'offer_request',re:/(send(?:e)?\s+(?:os\s+)?(?:en\s+)?(?:pris|tilbud)|kan\s+i\s+sende\s+(?:en\s+)?(?:pris|tilbud)|hvad\s+koster|pris\s+på|tilbud\s+på)/i,confidence:'medium',action:'Følg op på tilbuds-/prisforespørgslen.'},
    {type:'callback_request',re:/(ring\s+(?:mig|os)|kontakt\s+(?:mig|os)|vend\s+tilbage|følg\s+op)/i,confidence:'medium',action:'Planlæg opfølgning ud fra mailens konkrete tidspunkt.'},
    {type:'postponed',re:/(afventer\s+(?:godkendelse|svar|beslutning)|næste\s+måned|efter\s+ferien|senere\s+på\s+året|hører\s+fra\s+os)/i,confidence:'medium',action:'Sæt leadet i AFVENTER og kontrollér næste opfølgningsdato.'}
  ];
  return tests.find(x=>x.re.test(text))||null;
}
async function handleMailSignals(sb:any,job:any){
  const lookback=Math.max(1,Math.min(30,Number(job.payload?.lookback_days||14)));
  const since=new Date(Date.now()-lookback*86400000).toISOString();
  const {data:messages,error:mailError}=await sb.from('crm_mail_messages')
    .select('id,client_id,company_id,lead_id,offer_id,subject,body_text,message_at,direction,from_email')
    .eq('client_id',job.client_id).gte('message_at',since).order('message_at',{ascending:false}).limit(300);
  if(mailError)throw mailError;

  const [{data:intel},{data:pending}]=await Promise.all([
    sb.from('crm_sales_intelligence').select('metadata').eq('client_id',job.client_id).eq('source_type','CRM mail').limit(2000),
    sb.from('crm_approvals').select('payload').eq('client_id',job.client_id).eq('action_type','mail_sales_signal_review').eq('status','pending').limit(1000)
  ]);
  const seenIntel=new Set((intel||[]).map((x:any)=>clean(x?.metadata?.mail_message_id,100)).filter(Boolean));
  const seenApproval=new Set((pending||[]).map((x:any)=>clean(x?.payload?.mail_message_id,100)).filter(Boolean));
  const signals:any[]=[];

  for(const message of messages||[]){
    if(!message.company_id||seenIntel.has(message.id))continue;
    const signal=classifyMail(message);
    if(!signal)continue;
    const summary=(message.subject?message.subject+' — ':'')+clean(message.body_text,700);
    const row={
      client_id:job.client_id,
      company_id:message.company_id,
      lead_id:message.lead_id||null,
      signal_type:signal.type,
      title:'Mailsignal: '+signal.type.replaceAll('_',' '),
      summary:clean(summary,1800)||'Relevant mailsignal registreret.',
      recommended_action:signal.action,
      relevance_score:signal.confidence==='high'?90:72,
      confidence:signal.confidence,
      source_type:'CRM mail',
      source_label:clean(message.subject,300)||'Mail',
      observed_at:message.message_at,
      verified:false,
      metadata:{
        mail_message_id:message.id,
        direction:message.direction,
        from_email:message.from_email||null,
        offer_id:message.offer_id||null,
        classifier:'deterministic-v1'
      }
    };
    const {data:inserted,error:insertError}=await sb.from('crm_sales_intelligence').insert(row).select('id').single();
    if(insertError)throw insertError;
    signals.push({id:inserted?.id,type:signal.type,mail_message_id:message.id,lead_id:message.lead_id||null});
    seenIntel.add(message.id);

    if(message.lead_id&&!seenApproval.has(message.id)){
      const {error:approvalError}=await sb.from('crm_approvals').insert({
        client_id:job.client_id,
        lead_id:message.lead_id,
        action_type:'mail_sales_signal_review',
        payload:{
          mail_message_id:message.id,
          signal_type:signal.type,
          confidence:signal.confidence,
          recommended_action:signal.action,
          subject:message.subject||'',
          offer_id:message.offer_id||null,
          source:'mail-sales-signal-worker-v1'
        },
        ai_generated:false
      });
      if(approvalError)throw approvalError;
      seenApproval.add(message.id);
    }
  }
  const result={lookback_days:lookback,messages_scanned:(messages||[]).length,signals_created:signals.length,signals};
  await markDone(sb,job,'Mailsignaler er scannet. '+signals.length+' nye signaler blev registreret.',result);
  return result;
}


function usablePhone(value:any){
  const v=clean(value,120),digits=v.replace(/\D/g,'');
  return digits.length>=6?v:'';
}
function usableEmail(value:any){
  const v=clean(value,320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?v:'';
}
function cleanDomain(value:any){
  const v=clean(value,500).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].split(':')[0];
  return v.trim();
}
function sourceMatchesDomain(source:any,domain:any){
  const d=cleanDomain(domain);
  if(!d)return /^https?:\/\//i.test(clean(source,1800));
  try{
    const h=new URL(clean(source,1800)).hostname.toLowerCase().replace(/^www\./,'');
    return h===d||h.endsWith('.'+d);
  }catch{return false}
}
function emailMatchesDomain(email:any,domain:any){
  const e=usableEmail(email),d=cleanDomain(domain);
  if(!e||!d)return !!e;
  const ed=e.split('@')[1]||'';
  return ed===d||ed.endsWith('.'+d);
}
async function handleContactEnrichment(sb:any,job:any){
  if(!job.company_id)throw new Error('Kontaktberigelse mangler company_id');
  const {data:company,error:companyError}=await sb.from('crm_companies').select('*')
    .eq('id',job.company_id).eq('client_id',job.client_id).single();
  if(companyError||!company)throw new Error('Virksomheden til kontaktberigelse blev ikke fundet');

  const {data:existing,error:contactError}=await sb.from('crm_contacts').select('*')
    .eq('company_id',company.id).eq('client_id',job.client_id);
  if(contactError)throw contactError;
  const currentContacts=existing||[];
  const currentPhone=usablePhone(company.phone);
  const currentUsable=currentContacts.some((x:any)=>usablePhone(x.phone)||usableEmail(x.email));

  let lead:any=null;
  if(job.lead_id){
    const {data}=await sb.from('crm_leads').select('id,status,next_action,manual_lock')
      .eq('id',job.lead_id).eq('client_id',job.client_id).maybeSingle();
    lead=data||null;
  }

  const automatic=clean(job.payload?.requested_from,100)==='automatic_missing_contact';
  if(automatic&&(currentPhone||currentUsable)){
    const result={company_id:company.id,already_usable:true,company_phone:currentPhone||null,contact_count:currentContacts.length};
    await markDone(sb,job,'Virksomheden har allerede en brugbar kontaktkanal.',result);
    return result;
  }

  const {data:apiKey,error:keyError}=await sb.rpc('get_openai_api_secret',{p_client_id:job.client_id});
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
    required:['company_phone','general_email','website_url','source_url','contact_name','contact_title','contact_phone','contact_email','contact_source_url','confidence']
  };
  const input=[
    'Find en brugbar, offentlig kontaktkanal til denne B2B-virksomhed eller myndighed.',
    'Virksomhed: '+clean(company.name,500),
    'Domæne: '+clean(company.domain,500),
    'Hjemmeside: '+clean(company.website_url,1000),
    'CVR: '+clean(company.cvr,100),
    'Adresse: '+clean(company.address,1000),
    'Eksisterende hovedtelefon: '+clean(company.phone,120),
    '',
    'Prioritet:',
    '1) Find virksomhedens officielle hovedtelefon og generelle e-mail fra virksomhedens/myndighedens egen officielle hjemmeside.',
    '2) Find derefter, hvis muligt, én relevant navngiven beslutningstager med offentlig arbejdstelefon eller arbejdsmail.',
    '3) Brug kun oplysninger, der står eksplicit i en officiel kilde. Udled eller gæt aldrig e-mailadresser eller telefonnumre.',
    '4) Hvis en værdi ikke kan dokumenteres sikkert, returnér tom streng for den værdi.',
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
      prompt_cache_key:'lm-contact-enrichment-'+String(job.client_id).slice(0,8)
    })
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(clean(data?.error?.message||('OpenAI '+response.status),2000));
  const result=parseResponse(data);
  const confidence=clean(result.confidence,30);
  const companyDomain=cleanDomain(company.domain||company.website_url);
  const companySource=clean(result.source_url,1800);
  const personSource=clean(result.contact_source_url,1800);
  const officialCompanySource=confidence==='high'&&sourceMatchesDomain(companySource,companyDomain);
  const officialPersonSource=confidence==='high'&&sourceMatchesDomain(personSource||companySource,companyDomain);

  const foundPhone=officialCompanySource?usablePhone(result.company_phone):'';
  const generalEmail=officialCompanySource&&emailMatchesDomain(result.general_email,companyDomain)?usableEmail(result.general_email):'';
  const contactPhone=officialPersonSource?usablePhone(result.contact_phone):'';
  const contactEmail=officialPersonSource&&emailMatchesDomain(result.contact_email,companyDomain)?usableEmail(result.contact_email):'';
  const contactName=officialPersonSource?clean(result.contact_name,500):'';
  const contactTitle=officialPersonSource?clean(result.contact_title,500):'';
  const now=new Date().toISOString();

  const companyPatch:any={research_updated_at:now};
  if(foundPhone)companyPatch.phone=foundPhone;
  const foundWebsite=clean(result.website_url,1000);
  if(foundWebsite&&sourceMatchesDomain(foundWebsite,companyDomain||foundWebsite))companyPatch.website_url=foundWebsite;
  const {error:companyUpdateError}=await sb.from('crm_companies').update(companyPatch)
    .eq('id',company.id).eq('client_id',job.client_id);
  if(companyUpdateError)throw companyUpdateError;

  const normPhone=(v:any)=>usablePhone(v).replace(/\D/g,'');
  const seenEmail=new Set(currentContacts.map((x:any)=>usableEmail(x.email)).filter(Boolean));
  const seenPhone=new Set(currentContacts.map((x:any)=>normPhone(x.phone)).filter(Boolean));
  const inserted:any[]=[];

  async function insertContact(row:any){
    const email=usableEmail(row.email),phone=usablePhone(row.phone),phoneKey=normPhone(phone);
    if(!email&&!phone)return;
    if((email&&seenEmail.has(email))||(phoneKey&&seenPhone.has(phoneKey)))return;
    const source=clean(row.source_url,1800);
    const payload:any={
      client_id:job.client_id,company_id:company.id,
      full_name:clean(row.full_name,500)||null,title:clean(row.title,500)||null,
      phone:phone||null,email:email||null,source_url:source||null,
      verified:true,source_type:'official_website',verified_at:now,confidence:'high',
      role_relevance:clean(row.role_relevance,500)||null,is_decision_maker:row.is_decision_maker===true,
      email_is_inferred:false,provenance_status:'documented',provenance_review_required:false,
      provenance_note:'Kontaktdata verificeret mod officiel offentlig kilde af Lead Manager.',
      source_obtained_at:now,collection_method:'indirect'
    };
    if(email){
      payload.email_verification_method='exact_source_text';
      payload.email_source_url=source||null;
      payload.email_verified_at=now;
    }
    const {data:created,error}=await sb.from('crm_contacts').insert(payload).select('id,full_name,phone,email').single();
    if(error)throw error;
    inserted.push(created);
    if(email)seenEmail.add(email);
    if(phoneKey)seenPhone.add(phoneKey);
  }

  if(contactName&&(contactPhone||contactEmail)){
    await insertContact({
      full_name:contactName,title:contactTitle,phone:contactPhone,email:contactEmail,
      source_url:personSource||companySource,role_relevance:'Relevant kontaktperson',is_decision_maker:true
    });
  }
  if(generalEmail||foundPhone){
    await insertContact({
      full_name:clean(company.name,500)+' · hovedkontakt',title:'Generel kontakt',
      phone:foundPhone||currentPhone,email:generalEmail,source_url:companySource,
      role_relevance:'Standardkontakt',is_decision_maker:false
    });
  }

  const usableCompanyPhone=foundPhone||currentPhone;
  const usableAfter=!!usableCompanyPhone||currentUsable||inserted.some((x:any)=>usablePhone(x.phone)||usableEmail(x.email));
  if(lead&&!lead.manual_lock){
    if(!usableAfter&&!['TABT','IKKE RELEVANT','VUNDET'].includes(lead.status)){
      const {error}=await sb.from('crm_leads').update({
        status:'UNDER VURDERING',
        next_action:'Mangler verificeret standardmail eller telefon – kræver manuel kontaktresearch',
        next_at:null
      }).eq('id',lead.id).eq('client_id',job.client_id);
      if(error)throw error;
    }else if(usableAfter&&lead.status==='UNDER VURDERING'&&/^Mangler verificeret standardmail eller telefon/.test(clean(lead.next_action,500))){
      const {error}=await sb.from('crm_leads').update({
        status:'NY',next_action:'Vurder lead og kontakt via verificeret kanal'
      }).eq('id',lead.id).eq('client_id',job.client_id);
      if(error)throw error;
    }
  }

  const summary={
    company_id:company.id,
    usable:usableAfter,
    company_phone:usableCompanyPhone||null,
    general_email:generalEmail||null,
    named_contact:contactName||null,
    inserted_contacts:inserted,
    source_url:companySource||personSource||null,
    confidence
  };
  await markDone(
    sb,job,
    usableAfter?'Kontaktberigelse færdig. Der er nu mindst én brugbar kontaktkanal.':'Ingen verificeret standardmail eller telefon blev fundet. Leadet kræver manuel kontrol.',
    summary
  );
  return summary;
}

async function handleFreshness(sb:any,job:any){
  if(!job.lead_id)throw new Error('Kildefriskhedskontrol mangler lead_id');
  const {data:lead,error:leadError}=await sb.from('crm_leads').select('*')
    .eq('id',job.lead_id).eq('client_id',job.client_id).single();
  if(leadError||!lead)throw new Error('Lead til kildefriskhedskontrol blev ikke fundet');
  const sourceUrl=clean(job.payload?.source_url||lead.source_url||lead.source_reference,1800);
  if(!sourceUrl)throw new Error('Kildefriskhedskontrol mangler officiel kilde-URL');
  const {data:apiKey,error:keyError}=await sb.rpc('get_openai_api_secret',{p_client_id:job.client_id});
  if(keyError||!apiKey)throw new Error('OpenAI API-nøgle mangler til kildefriskhedskontrol');

  const schema={
    type:'object',additionalProperties:false,
    properties:{
      active:{type:'boolean'},
      closed:{type:'boolean'},
      confidence:{type:'string',enum:['high','medium','low']},
      latest_official_status:{type:'string'},
      deadline:{type:'string'},
      next_milestone_date:{type:'string'},
      evidence:{type:'string'},
      verified_source_url:{type:'string'}
    },
    required:['active','closed','confidence','latest_official_status','deadline','next_milestone_date','evidence','verified_source_url']
  };
  const input=`Kontrollér den dokumenterede B2B-mulighed mod den aktuelle officielle kilde.
Kilde: ${sourceUrl}
Reference: ${clean(job.payload?.source_reference||lead.source_reference,1400)}
Nuværende status i CRM: ${clean(lead.status,100)}
Eksisterende kildeevidens: ${JSON.stringify(lead.source_verification_evidence||{}).slice(0,7000)}

Brug den officielle kilde først. Afgør om muligheden stadig er aktiv, eller om projektet/udbuddet er afsluttet, tildelt, udført eller fristen er udløbet. Hvis den oprindelige URL er død, flyttet eller redirecter, søg på projektreferencen og organisationen efter den nye officielle kilde og returnér den i verified_source_url. Gæt ikke. Hvis ingen aktuel officiel kilde kan verificeres sikkert, sæt confidence=low og active=false, closed=false.`;
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{Authorization:'Bearer '+String(apiKey),'Content-Type':'application/json'},
    body:JSON.stringify({
      model:'gpt-5.6-luna',
      instructions:'Du er en kildekritisk dansk research-agent. Returnér kun information, der kan underbygges af aktuelle officielle kilder. Ingen gæt.',
      input,
      tools:[{type:'web_search',search_context_size:'medium',user_location:{type:'approximate',country:'DK'}}],
      reasoning:{effort:'low'},
      max_output_tokens:1800,
      text:{format:{type:'json_schema',name:'source_freshness_check',strict:true,schema}},
      store:false,
      prompt_cache_key:'lm-source-freshness-'+String(job.client_id).slice(0,8)
    })
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(clean(data?.error?.message||('OpenAI '+response.status),2000));
  const result=parseResponse(data);
  if(typeof result.active!=='boolean'||typeof result.closed!=='boolean')throw new Error('Kildefriskhedskontrol returnerede ugyldigt resultat');

  if(result.confidence!=='low'&&saysClosed(result.latest_official_status)){
    result.closed=true;
    result.active=false;
  }
  const deadlineText=clean(result.deadline,100);
  const deadlineMatch=deadlineText.match(/^(\d{4}-\d{2}-\d{2})/);
  const sourceType=clean(lead.source_verification_evidence?.source_type||lead.source,100).toLowerCase();
  if(result.confidence!=='low'&&deadlineMatch&&/(udbud|tender)/i.test(sourceType)){
    const deadlineDate=new Date(deadlineMatch[1]+'T00:00:00Z');
    const today=new Date(); today.setUTCHours(0,0,0,0);
    if(!Number.isNaN(deadlineDate.getTime())&&deadlineDate<today){
      result.closed=true;
      result.active=false;
    }
  }

  const checkedAt=new Date().toISOString();
  const inconclusive=result.confidence==='low'||(!result.active&&!result.closed);
  if(inconclusive){
    const safeResult={...result,verification_state:'inconclusive',checked_at:checkedAt,original_source_url:sourceUrl};
    await markDone(
      sb,job,
      'Kilden kunne ikke verificeres sikkert. Leadet forbliver UNDER VURDERING og må ikke kontaktes, før en officiel kilde er bekræftet.',
      safeResult
    );
    return safeResult;
  }

  let latestStatus=clean(result.latest_official_status,1000);
  if(!result.closed&&hasTerminalWords(latestStatus)&&!saysClosed(latestStatus)){
    latestStatus='Ikke afsluttet, tildelt eller udført ifølge den seneste officielle kilde. '+latestStatus;
  }
  const evidence={
    ...(lead.source_verification_evidence||{}),
    latest_official_status:latestStatus,
    status_checked_at:checkedAt,
    freshness_evidence:clean(result.evidence,2400),
    freshness_confidence:clean(result.confidence,30),
    verified_source_url:clean(result.verified_source_url||sourceUrl,1800)
  };
  if(clean(result.deadline,50))evidence.deadline=clean(result.deadline,50);
  if(clean(result.next_milestone_date,50))evidence.next_milestone_date=clean(result.next_milestone_date,50);
  const patch:any={
    source_verification_evidence:evidence,
    source_scope_verified:true,
    updated_at:checkedAt
  };
  const verifiedUrl=clean(result.verified_source_url,1800);
  if(/^https?:\/\//i.test(verifiedUrl))patch.source_url=verifiedUrl;
  if(result.closed&&!['VUNDET','TABT','IKKE RELEVANT'].includes(lead.status)){
    patch.status='IKKE RELEVANT';
    patch.next_action='Sagen er afsluttet/tildelt/udført eller fristen er udløbet – kræver en ny officiel mulighed før kontakt';
    patch.next_at=null;
  }
  const {error:updateError}=await sb.from('crm_leads').update(patch)
    .eq('id',lead.id).eq('client_id',job.client_id);
  if(updateError)throw updateError;
  await markDone(
    sb,job,
    result.confidence==='low'?'Kilden kunne ikke verificeres sikkert og kræver manuel kontrol.':'Officiel kilde er genverificeret: '+latestStatus,
    result
  );
  return result;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type,x-lead-manager-command-secret'}});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const url=Deno.env.get('SUPABASE_URL')!;
  const sb=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const {data:expected,error:secretError}=await sb.rpc('crm_get_lead_manager_command_worker_secret_for_service');
    if(secretError)throw secretError;
    if(!expected||req.headers.get('x-lead-manager-command-secret')!==String(expected))return json({error:'Unauthorized'},401);

    const body=await req.json().catch(()=>({}));
    const requestId=clean((body as any).request_id,100);
    let jobs:any[]=[];
    if(requestId){
      const {data,error}=await sb.from('crm_agent_requests').select('*').eq('id',requestId).maybeSingle();
      if(error)throw error;
      if(data)jobs=[data];
    }else{
      const {data,error}=await sb.from('crm_agent_requests').select('*')
        .eq('request_type','lead_manager_command').eq('status','queued')
        .order('created_at',{ascending:true}).limit(25);
      if(error)throw error;
      jobs=(data||[]).filter((x:any)=>supported.has(clean(x?.payload?.action,100))).slice(0,12);
    }

    const results:any[]=[];
    for(const job of jobs){
      const action=clean(job?.payload?.action,100);
      if(job.status!=='queued'||!supported.has(action))continue;
      const started=new Date().toISOString();
      const {data:claim,error:claimError}=await sb.from('crm_agent_requests').update({
        status:'running',started_at:started,error_text:null,
        payload:{...(job.payload||{}),worker:'lead-manager-command-worker-v2',worker_started_at:started}
      }).eq('id',job.id).eq('status','queued').select('id').maybeSingle();
      if(claimError)throw claimError;
      if(!claim)continue;
      try{
        let result:any;
        if(action==='import_offers_from_mail'||action==='reconcile_offers_from_mail')result=await handleOfferSync(sb,url,job);
        else if(action==='scan_mail_sales_signals')result=await handleMailSignals(sb,job);
        else if(action==='source_freshness_check')result=await handleFreshness(sb,job);
        else if(action==='contact_enrichment')result=await handleContactEnrichment(sb,job);
        results.push({id:job.id,action,status:'done',result});
      }catch(error){
        const message=await markError(sb,job,error);
        results.push({id:job.id,action,status:'error',error:message});
      }
    }
    return json({ok:true,processed:results.length,results});
  }catch(error){
    return json({error:errorMessage(error,3000)},500);
  }
});
