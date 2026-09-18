import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type, x-autonomous-lead-hunter-secret','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const S=(x:any,n=3000)=>String(x??'').trim().slice(0,n);
const N=(x:any)=>S(x,8000).toLowerCase().normalize('NFKD').replace(/[^a-z0-9æøå]+/g,' ').replace(/\s+/g,' ').trim();
const A=(x:any)=>Array.isArray(x)?x.map(v=>S(v,500)).filter(Boolean):[];
const H=(u:string)=>{try{return new URL(/^https?:\/\//i.test(u)?u:`https://${u}`).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const registry=(u:string)=>['cvr.dk','virk.dk','proff.dk','ownr.dk','cvrdb.dk','paqle.dk','krak.dk','companydata.dk'].some(h=>H(u)===h||H(u).endsWith('.'+h));
function parsed(d:any){let t=S(d?.output_text,30000);if(!t)for(const o of(d?.output||[]))for(const c of(o?.content||[]))if(typeof c?.text==='string')t+=c.text;try{return JSON.parse(t.replace(/^```json\s*/i,'').replace(/```$/,'').trim()||'{}')}catch{return{candidates:[]}}}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return J({error:'Method not allowed'},405);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:secret}=await db.rpc('get_autonomous_lead_hunter_v2_secret_for_service');
 if(!secret||req.headers.get('x-autonomous-lead-hunter-secret')!==secret)return J({error:'Unauthorized'},401);
 const b=await req.json().catch(()=>({})),cid=S(b.client_id,100),dry=!!b.force_dry_run,target=Math.max(1,Math.min(30,Number(b.target_active||15)));
 if(!cid)return J({error:'Mangler client_id'},400);
 let runId:string|null=null;
 try{
  const staleBefore=new Date(Date.now()-90*60*1000).toISOString();
  await db.from('crm_agent_runs').update({
    status:'error',
    error:'Watchdog: Autonomous Lead Hunter v3-kørsel blev forældet før afslutning',
    finished_at:new Date().toISOString()
  }).eq('client_id',cid).eq('agent_name','Autonomous Lead Hunter v3').eq('status','running').is('finished_at',null).lt('started_at',staleBefore);
  const {data:inflight,error:inflightError}=await db.from('crm_agent_runs')
    .select('id,started_at')
    .eq('client_id',cid)
    .eq('agent_name','Autonomous Lead Hunter v3')
    .eq('status','running')
    .is('finished_at',null)
    .order('started_at',{ascending:false})
    .limit(1);
  if(inflightError)throw inflightError;
  if(inflight?.length)return J({ok:true,already_running:true,run_id:inflight[0].id,started_at:inflight[0].started_at},202);
  const [cq,aq,iq,lq,uq,coq,caq,nq]=await Promise.all([
   db.from('crm_clients').select('*').eq('id',cid).single(),db.rpc('get_openai_api_secret',{p_client_id:cid}),
   db.from('crm_integrations').select('*').eq('client_id',cid).eq('provider','openai').limit(1),
   db.from('crm_usage_limits').select('*').eq('client_id',cid).maybeSingle(),db.rpc('crm_usage_snapshot',{p_client_id:cid}),
   db.from('crm_companies').select('id,name,cvr,domain,website_url,address').eq('client_id',cid),
   db.from('crm_lead_candidates').select('id,candidate_key,name,domain,address,status,metadata').eq('client_id',cid).in('status',['ready','promoted']),
   db.from('crm_leads').select('id',{count:'exact',head:true}).eq('client_id',cid).eq('lead_pool','standard').eq('status','NY')
  ]);
  const client=cq.data,key=S(aq.data,500);if(!client)throw Error('Klient ikke fundet');if(!key)throw Error('OpenAI API-nøgle mangler');
  const profile=client.settings?.capability_profile||{},st=profile.search_strategy||client.settings?.lead_search_profile||{},industries=A(st.industries),exclusions=A(profile.hard_exclusions||st.exclusions),geo=S(st?.geography?.text||client.geography,500),min=Number(st?.employee_range?.min||0),max=Number(st?.employee_range?.max||0),ny=Number(nq.count||0),daily=Number(lq.data?.daily_search_run_limit||4),usage=uq.data||{};
  if(!dry&&Number(usage.search_runs_today||0)>=daily)return J({ok:true,quota_reached:true,quota_type:'daily_search_runs',limit:daily});
  if(!dry&&ny>=target)return J({ok:true,target_reached:true,active:ny,target,pool:'standard',status:'NY'});
  if(!dry)await db.from('crm_usage_events').insert({client_id:cid,event_type:'lead_search_run',quantity:1,metadata:{agent:'Autonomous Lead Hunter v3',target,pool:'standard',status:'NY'}});
  const rr=await db.from('crm_agent_runs').insert({client_id:cid,agent_name:'Autonomous Lead Hunter v3',status:'running',input:{force_dry_run:dry,target_active:target,pool:'standard',status:'NY'},started_at:new Date().toISOString()}).select('id').single();runId=rr.data?.id||null;
  const known=[...(coq.data||[]).map((x:any)=>`${x.name}|${x.cvr||''}|${x.address||''}`),...(caq.data||[]).map((x:any)=>`${x.name}|${x.metadata?.cvr||''}|${x.address||''}`)].slice(0,250);
  const model=S(client.settings?.saas?.lead_hunter_model||iq.data?.[0]?.config?.model,100)||'gpt-5.6-luna';
  const schema={type:'object',additionalProperties:false,properties:{candidates:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},cvr:{type:'string'},address:{type:'string'},industry:{type:'string'},website_url:{type:'string'},identity_source_url:{type:'string'},employee_source_url:{type:'string'},employee_count:{type:'integer',minimum:0},employee_range_min:{type:'integer',minimum:0},employee_range_max:{type:'integer',minimum:0},employee_evidence:{type:'string'},why_relevant:{type:'string'},matched_capability:{type:'string'},candidate_role:{type:'string',enum:['buyer_user','provider_seller']}},required:['name','cvr','address','industry','website_url','identity_source_url','employee_source_url','employee_count','employee_range_min','employee_range_max','employee_evidence','why_relevant','matched_capability','candidate_role']}},summary:{type:'string'}},required:['candidates','summary']};
  const instructions=`Find dokumenterede B2B-målvirksomheder for ${client.name}. Geografi: ${geo}. Brancher: ${industries.join(', ')}. Ydelser: ${A(client.services).join(', ')}. Fravalg: ${exclusions.join(', ')}. Virksomheden skal være køber/bruger, ikke leverandør. Verificér identitet og medarbejderstørrelse i CVR/Virk eller troværdigt virksomhedsregister. Hjemmeside er valgfri. Gæt aldrig data. Medarbejderkrav: min ${min||0}, max ${max||0}. Undgå kendte: ${JSON.stringify(known)}.`;
  const queries=[`Find op til 5 nye virksomheder i ${geo} i brancherne ${industries.join(', ')}. Verificér CVR/adresse og ansatte.`,`Find op til 5 andre B2B-købere i ${geo}, brancher ${industries.join(', ')}. Brug virksomhedsregister som dokumentation.`];
  const results=[] as any[];
  for(let i=0;i<queries.length;i++){
   const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions,input:queries[i],tools:[{type:'web_search',search_context_size:'medium',user_location:{type:'approximate',country:'DK'}}],reasoning:{effort:'low'},max_output_tokens:4200,text:{format:{type:'json_schema',name:'lead_hunter_v3_standard',strict:true,schema}},store:false,prompt_cache_key:`alh-v3-standard-${cid.slice(0,8)}-${i}`})});
   const d=await r.json().catch(()=>({}));results.push(r.ok?parsed(d):{candidates:[],error:d?.error?.message||`OpenAI ${r.status}`});
  }
  const raw=new Map<string,any>();for(const c of results.flatMap(x=>Array.isArray(x.candidates)?x.candidates:[])){const cvr=S(c.cvr,30).replace(/\D/g,''),k=cvr?`cvr:${cvr}`:`${N(c.name)}|${N(c.address)}`;if(k&&!raw.has(k))raw.set(k,c)}
  const accepted:any[]=[],rejected:any[]=[];
  for(const r of raw.values()){
   const name=S(r.name,300),cvr=S(r.cvr,30).replace(/\D/g,''),address=S(r.address,700),industry=S(r.industry,500),site=S(r.website_url,1200),ids=S(r.identity_source_url,1200),es=S(r.employee_source_url,1200),matched=S(r.matched_capability,500),exact=Number(r.employee_count||0),lo=Number(r.employee_range_min||0),hi=Number(r.employee_range_max||0),why=S(r.why_relevant,1600),reasons:string[]=[];
   if(!name||!address||!ids||!es)reasons.push('missing_core_evidence');if(r.candidate_role!=='buyer_user')reasons.push('not_buyer');if(!registry(es))reasons.push('employee_source_not_register');if(industries.length&&!industries.some(x=>N(industry+' '+matched).includes(N(x))))reasons.push('industry_not_selected');if(min&&!(exact>=min||lo>=min))reasons.push('employee_below_min');if(max&&!(exact?exact<=max:hi&&hi<=max))reasons.push('employee_above_max');if(exclusions.some(x=>N(name+' '+industry+' '+why).includes(N(x))))reasons.push('hard_exclusion_match');
   const domain=H(site),ck=cvr?`cvr:${cvr}`:`${N(name)}|${N(address)}`,dup=(coq.data||[]).some((x:any)=>(cvr&&S(x.cvr,30).replace(/\D/g,'')===cvr)||(N(x.name)===N(name)&&N(x.address||'')===N(address))||(domain&&H(x.website_url||x.domain||'')===domain))||(caq.data||[]).some((x:any)=>x.candidate_key===ck);
   if(dup)reasons.push('duplicate');if(reasons.length){rejected.push({name,reasons});continue}
   accepted.push({candidate_key:ck,name,cvr:cvr||null,domain:domain||null,website_url:site||null,address,industry:matched||industry,why_relevant:why,source_url:ids,evidence_text:S(r.employee_evidence,1200),employee_source_url:es,employee_count:exact||null,employee_range_min:lo||null,employee_range_max:hi||null,matched_capability:matched||industry});
  }
  let stored=0,promoted=0;if(!dry){for(const c of accepted){const u=await db.from('crm_lead_candidates').upsert({client_id:cid,candidate_key:c.candidate_key,name:c.name,domain:c.domain,website_url:c.website_url,address:c.address,industry:c.industry,why_relevant:c.why_relevant,source_url:c.source_url,evidence_text:c.evidence_text,discovery_score:85,status:'ready',last_verified_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),metadata:{agent:'Autonomous Lead Hunter v3',cvr:c.cvr,matched_capability:c.matched_capability,candidate_role:'buyer_user',search_strategy_enforced:true,capability_profile_version:profile.version||null,employee_count:c.employee_count,employee_range_min:c.employee_range_min,employee_range_max:c.employee_range_max,employee_source_url:c.employee_source_url,verification_method:'web_search_business_register'}},{onConflict:'client_id,candidate_key'});if(!u.error)stored++}const p=await db.rpc('crm_promote_ready_candidates',{p_client_id:cid,p_target_min:target});promoted=Number(p.data||0)}
  const fq=await db.from('crm_leads').select('id',{count:'exact',head:true}).eq('client_id',cid).eq('lead_pool','standard').eq('status','NY');const output={dry_run:dry,client_name:client.name,active_before:ny,active_after:Number(fq.count||ny),target_active:target,pool:'standard',status:'NY',candidates_seen:raw.size,accepted:accepted.length,rejected:rejected.length,stored,promoted,track_errors:results.map(x=>x.error).filter(Boolean)};if(runId)await db.from('crm_agent_runs').update({status:'done',output,finished_at:new Date().toISOString()}).eq('id',runId);return J({ok:true,...output});
 }catch(e){const msg=e instanceof Error?e.message:String(e);if(runId)await db.from('crm_agent_runs').update({status:'error',error:msg,finished_at:new Date().toISOString()}).eq('id',runId);return J({error:msg},500)}
});