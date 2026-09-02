import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}
});
const DAY_MS=24*60*60*1000;
type Level='low'|'elevated'|'high'|'unknown';
type Signal={code:string;severity:'positive'|'attention'|'critical'|'info';title:string;detail:string};

const cleanCvr=(value:unknown)=>String(value??'').replace(/\D/g,'').slice(0,8);
const money=(value:unknown)=>{
  if(value===''||value==null)return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?Math.round(n*100)/100:null;
};
const yearsSince=(value:unknown)=>{
  const date=new Date(String(value||''));
  return Number.isNaN(date.getTime())?null:Math.max(0,(Date.now()-date.getTime())/(365.2425*DAY_MS));
};
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));

function exposureRecommendation(level:Level,orderValue:number|null){
  let recommendation=level==='high'
    ?'Giv ikke almindelig kredit. Kræv fuld forudbetaling, eller afvis ordren efter en konkret vurdering.'
    :level==='elevated'
      ?'Kræv depositum eller forudbetaling af materialer og brug en kort betalingsfrist.'
      :'Almindelige betalingsvilkår kan overvejes ved mindre ordrer. Vurder stadig eksponeringen, før I lægger større beløb ud.';
  if(orderValue==null)return recommendation+' Angiv ordrebeløbet før den endelige beslutning.';
  if(orderValue>=250000)return recommendation+' Ordren er meget stor: kræv mindst 30–50 % ved ordre og betaling af materialer før levering.';
  if(orderValue>=100000)return recommendation+' Ordren er stor: kræv mindst 25–30 % depositum og få materialerne dækket på forhånd.';
  if(orderValue>=50000)return recommendation+' Overvej depositum eller særskilt forudbetaling af materialer.';
  return recommendation;
}

function assess(company:any,orderValue:number|null){
  const signals:Signal[]=[];
  const status=String(company?.status||'').trim().toUpperCase();
  const bankrupt=company?.bankrupt===true;
  const ended=Boolean(company?.enddate);
  const employees=Number.isFinite(Number(company?.employees))?Number(company.employees):null;
  const age=yearsSince(company?.startdate);
  let score=65;

  if(bankrupt){score-=80;signals.push({code:'bankrupt',severity:'critical',title:'Konkursmarkering',detail:'CVR-data markerer virksomheden som konkurs.'})}
  else signals.push({code:'not_bankrupt',severity:'positive',title:'Ingen konkursmarkering',detail:'Der er ikke fundet en konkursmarkering i de hentede CVR-grunddata.'});

  if(ended){score-=65;signals.push({code:'ended',severity:'critical',title:'Virksomheden er ophørt',detail:`Ophørsdato: ${company.enddate}.`})}
  if(status==='NORMAL'){score+=10;signals.push({code:'normal_status',severity:'positive',title:'Normal CVR-status',detail:'Virksomhedens registrerede status er NORMAL.'})}
  else {score-=40;signals.push({code:'abnormal_status',severity:'critical',title:'CVR-status kræver kontrol',detail:`Registreret status: ${status||'ukendt'}.`})}

  if(age!=null){
    if(age>=10){score+=12;signals.push({code:'age_10',severity:'positive',title:'Lang driftshistorik',detail:`Virksomheden har eksisteret i ca. ${Math.floor(age)} år.`})}
    else if(age>=5){score+=8;signals.push({code:'age_5',severity:'positive',title:'Etableret virksomhed',detail:`Virksomheden har eksisteret i ca. ${Math.floor(age)} år.`})}
    else if(age>=3){score+=4;signals.push({code:'age_3',severity:'positive',title:'Mere end tre års historik',detail:`Virksomheden har eksisteret i ca. ${Math.floor(age)} år.`})}
    else if(age<1){score-=25;signals.push({code:'age_under_1',severity:'attention',title:'Meget ny virksomhed',detail:'Virksomheden er under ét år gammel.'})}
    else {score-=10;signals.push({code:'age_under_3',severity:'attention',title:'Kort driftshistorik',detail:`Virksomheden har eksisteret i ca. ${Math.floor(age)} år.`})}
  }else signals.push({code:'age_unknown',severity:'info',title:'Startdato mangler',detail:'Virksomhedens alder kunne ikke vurderes.'});

  if(employees!=null){
    if(employees>=5){score+=5;signals.push({code:'employees_5',severity:'positive',title:'Registrerede medarbejdere',detail:`Senest registrerede medarbejdertal: ${employees}.`})}
    else if(employees>0){score+=2;signals.push({code:'employees_some',severity:'info',title:'Lille organisation',detail:`Senest registrerede medarbejdertal: ${employees}.`})}
    else {score-=3;signals.push({code:'employees_zero',severity:'attention',title:'Ingen registrerede medarbejdere',detail:'CVR-grunddata viser 0 medarbejdere. Tallet kan være forsinket.'})}
  }

  if(company?.protected===true)signals.push({code:'advertising_protected',severity:'attention',title:'Reklamebeskyttet virksomhed',detail:'CVR-data markerer virksomheden som reklamebeskyttet. Oplysningerne må ikke bruges til direkte markedsføring.'});

  signals.push({code:'scope_limit',severity:'info',title:'Afgrænset datagrundlag',detail:'Tjekket omfatter offentlige CVR-signaler. Det er ikke et RKI-opslag og indeholder ikke en fuld regnskabsanalyse.'});
  score=clamp(Math.round(score),0,92);
  let level:Level=score<40?'high':score<72?'elevated':'low';
  if(bankrupt||ended||status!=='NORMAL')level='high';
  const label=level==='high'?'Høj risiko':level==='elevated'?'Forhøjet risiko':'Lav offentlig risiko';
  return {score,level,label,signals,recommendation:exposureRecommendation(level,orderValue)};
}

function snapshot(company:any){
  return {
    vat:company?.vat??null,
    name:String(company?.name||'').slice(0,240),
    address:String(company?.address||'').slice(0,240),
    zipcode:company?.zipcode??null,
    city:String(company?.city||'').slice(0,120),
    startdate:company?.startdate||null,
    enddate:company?.enddate||null,
    employees:Number.isFinite(Number(company?.employees))?Number(company.employees):null,
    status:String(company?.status||'').slice(0,80),
    bankrupt:company?.bankrupt===true,
    companydesc:String(company?.companydesc||'').slice(0,160),
    companytypeshort:String(company?.companytypeshort||'').slice(0,40),
    protected:company?.protected===true
  };
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return json({error:'Mangler login-token',code:'NO_TOKEN'},401);
    const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await admin.auth.getUser(token),user=userData?.user;
    if(userError||!user?.id||!user?.email)return json({error:'Ugyldigt eller udløbet login',code:'INVALID_LOGIN'},401);
    const body=await req.json().catch(()=>({}));
    const requestedClientId=String(body.client_id||'').trim();
    const {data:members,error:memberError}=await admin.from('crm_users').select('client_id,active,auth_user_id').eq('auth_user_id',user.id).eq('active',true);
    if(memberError)throw memberError;
    const membership=(members||[]).find((m:any)=>m.client_id===requestedClientId)||(!requestedClientId?members?.[0]:null);
    if(!membership)return json({error:'Ingen adgang til denne kundekonto',code:'NO_MEMBERSHIP'},403);
    const clientId=membership.client_id;
    const action=String(body.action||'check').trim().toLowerCase();

    if(action==='history'){
      const {data,error}=await admin.from('crm_credit_checks')
        .select('id,cvr,company_name,risk_score,risk_level,risk_label,recommendation,order_value,signals,company_snapshot,source_name,source_url,source_checked_at,checked_at')
        .eq('client_id',clientId).eq('check_kind','manual').order('checked_at',{ascending:false}).limit(12);
      if(error)throw error;
      return json({checks:data||[]});
    }
    if(action!=='check')return json({error:'Ukendt handling'},400);

    const cvr=cleanCvr(body.cvr);
    if(!/^\d{8}$/.test(cvr))return json({error:'CVR-nummeret skal bestå af præcis 8 cifre',code:'INVALID_CVR'},400);
    const checkKind=body.check_kind==='lead'?'lead':'manual';
    const leadId=checkKind==='lead'&&body.lead_id?String(body.lead_id):null;
    const companyId=checkKind==='lead'&&body.company_id?String(body.company_id):null;
    const orderValue=money(body.order_value);
    if(body.order_value!=null&&body.order_value!==''&&orderValue==null)return json({error:'Ordrebeløbet er ugyldigt'},400);

    if(leadId){
      const {data:lead,error}=await admin.from('crm_leads').select('id,client_id,company_id').eq('id',leadId).eq('client_id',clientId).maybeSingle();
      if(error)throw error;
      if(!lead)return json({error:'Leadet blev ikke fundet på denne kundekonto'},404);
      if(companyId&&lead.company_id!==companyId)return json({error:'Lead og virksomhed passer ikke sammen'},400);
    }

    const {data:recent,error:recentError}=await admin.from('crm_credit_checks').select('*')
      .eq('client_id',clientId).eq('cvr',cvr).order('source_checked_at',{ascending:false}).limit(1).maybeSingle();
    if(recentError)throw recentError;
    const recentMs=recent?.source_checked_at?new Date(recent.source_checked_at).getTime():0;
    const fresh=recentMs&&Date.now()-recentMs<DAY_MS;
    if(checkKind==='lead'&&fresh&&!body.force_refresh&&recent?.lead_id===leadId){
      return json({check:recent,cached:true,stale:false});
    }

    let company:any=null,sourceCheckedAt=new Date().toISOString(),providerCached=false,stale=false;
    if(fresh&&!body.force_refresh&&recent?.company_snapshot){
      company=recent.company_snapshot;
      sourceCheckedAt=recent.source_checked_at;
      providerCached=true;
    }else{
      try{
        const response=await fetch(`https://apicvr.dk/api/v1/${cvr}`,{
          headers:{'Accept':'application/json','User-Agent':'Lead Manager credit-check'},
          signal:AbortSignal.timeout(12000)
        });
        const payload=await response.json().catch(()=>null);
        if(!response.ok||!payload||payload?.detail||payload?.error)throw new Error(payload?.detail||payload?.error||`CVR-kilden svarede ${response.status}`);
        company=payload;
      }catch(providerError){
        if(!recent?.company_snapshot)throw providerError;
        company=recent.company_snapshot;
        sourceCheckedAt=recent.source_checked_at;
        providerCached=true;
        stale=true;
      }
    }

    const safeSnapshot=snapshot(company);
    if(String(safeSnapshot.vat)!==cvr)return json({error:'CVR-kilden returnerede ikke den forventede virksomhed',code:'CVR_MISMATCH'},502);
    const assessment=assess(safeSnapshot,orderValue);
    if(stale)assessment.signals.push({code:'stale_source',severity:'attention',title:'Kilden kunne ikke opdateres',detail:`Resultatet bruger seneste gemte CVR-data fra ${sourceCheckedAt}.`});
    const officialUrl=`https://datacvr.virk.dk/enhed/virksomhed/${cvr}`;
    const insert={
      client_id:clientId,lead_id:leadId,company_id:companyId,cvr,check_kind:checkKind,order_value:orderValue,
      company_name:safeSnapshot.name||null,risk_score:assessment.score,risk_level:assessment.level,risk_label:assessment.label,
      recommendation:assessment.recommendation,signals:assessment.signals,company_snapshot:safeSnapshot,
      source_name:'APICVR.dk / CVR',source_url:officialUrl,source_checked_at:sourceCheckedAt,checked_by_user_id:user.id
    };
    const {data:created,error:insertError}=await admin.from('crm_credit_checks').insert(insert).select('*').single();
    if(insertError)throw insertError;
    return json({check:created,cached:providerCached,stale});
  }catch(err){
    console.error('credit-check',err);
    const message=err instanceof Error?err.message:String(err);
    return json({error:message||'Kreditcheck kunne ikke gennemføres',code:'CREDIT_CHECK_FAILED'},503);
  }
});
