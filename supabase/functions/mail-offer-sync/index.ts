import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-mail-offer-sync-secret',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v:any,max=8000)=>String(v??'').trim().slice(0,max);
const lower=(v:any)=>clean(v).toLowerCase();
const norm=(v:any)=>clean(v,500).toLowerCase().replace(/[^a-z0-9æøå]+/g,'');
const emailRe=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
const closedStatuses=new Set(['VUNDET','TABT','LUKKET','LUKKET – UDSKUDT']);

function errText(e:any){
  if(e instanceof Error&&e.message)return e.message;
  if(e?.message)return String(e.message);
  try{const s=JSON.stringify(e);if(s&&s!=='{}')return s}catch{}
  return String(e??'Ukendt fejl');
}
function safeEqual(a:string,b:string){
  const aa=new TextEncoder().encode(a),bb=new TextEncoder().encode(b);let diff=aa.length^bb.length;
  for(let i=0;i<Math.max(aa.length,bb.length);i++)diff|=(aa[i%Math.max(aa.length,1)]||0)^(bb[i%Math.max(bb.length,1)]||0);
  return diff===0;
}
function stripHtml(s:string){
  return s.replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/\n{3,}/g,'\n\n').replace(/[ \t]{2,}/g,' ').trim();
}
function b64urlDecode(s:string){try{let x=s.replaceAll('-','+').replaceAll('_','/');while(x.length%4)x+='=';const raw=atob(x);return new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0)))}catch{return''}}
function b64urlEncode(s:string){const bytes=new TextEncoder().encode(s);let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/g,'')}
function gmailHeader(payload:any,name:string){return clean((payload?.headers||[]).find((h:any)=>lower(h?.name)===lower(name))?.value,2000)}
function gmailBody(part:any):string{
  if(!part)return'';
  if(part.mimeType==='text/plain'&&part.body?.data)return b64urlDecode(String(part.body.data));
  for(const p of(part.parts||[])){const t=gmailBody(p);if(t)return t}
  if(part.mimeType==='text/html'&&part.body?.data)return stripHtml(b64urlDecode(String(part.body.data)));
  if(part.body?.data){const t=b64urlDecode(String(part.body.data));return part.mimeType==='text/html'?stripHtml(t):t}
  return'';
}
function gmailAttachmentNames(part:any,out:string[]=[]):string[]{if(!part)return out;const filename=clean(part.filename,1000);if(filename)out.push(filename);for(const p of(part.parts||[]))gmailAttachmentNames(p,out);return[...new Set(out)]}
function arr(x:any,keys:string[]){if(Array.isArray(x))return x;for(const k of keys)if(Array.isArray(x?.[k]))return x[k];return[]}
function addDays(value:any,days:number){const d=new Date(value);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function cphDate(value:any){
  const d=new Date(value);if(Number.isNaN(d.getTime()))return new Date().toISOString().slice(0,10);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const get=(t:string)=>parts.find(p=>p.type===t)?.value||'';return`${get('year')}-${get('month')}-${get('day')}`;
}
function easterSunday(year:number){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;return new Date(Date.UTC(year,month-1,day,12));
}
function isoUtcDate(d:Date){return d.toISOString().slice(0,10)}
function moveDate(d:Date,days:number){const x=new Date(d);x.setUTCDate(x.getUTCDate()+days);return x}
function dkHolidays(year:number){
  const e=easterSunday(year);return new Set([
    `${year}-01-01`,`${year}-12-25`,`${year}-12-26`,
    isoUtcDate(moveDate(e,-3)),isoUtcDate(moveDate(e,-2)),isoUtcDate(e),isoUtcDate(moveDate(e,1)),
    isoUtcDate(moveDate(e,39)),isoUtcDate(moveDate(e,49)),isoUtcDate(moveDate(e,50))
  ]);
}
function isBusinessDay(d:Date){const day=d.getUTCDay(),iso=isoUtcDate(d),year=d.getUTCFullYear();return day>=1&&day<=5&&!dkHolidays(year).has(iso)}
function addBusinessDays(value:any,days:number){
  const base=cphDate(value),d=new Date(base+'T12:00:00Z');let left=Math.max(0,days);
  while(left>0){d.setUTCDate(d.getUTCDate()+1);if(isBusinessDay(d))left--}
  return isoUtcDate(d);
}
function weekdayDate(value:any,weekday:number,nextWord:boolean){
  const base=cphDate(value),d=new Date(base+'T12:00:00Z'),current=d.getUTCDay();let delta=(weekday-current+7)%7;
  if(delta===0||nextWord)delta=delta===0?7:delta;
  d.setUTCDate(d.getUTCDate()+delta);return isoUtcDate(d);
}
function domainOf(email:string){const m=lower(email).match(/@([^\s>]+)$/);return m?.[1]?.replace(/^www\./,'')||''}
function normalizeDomain(v:any){return lower(v).replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].split(':')[0]}
function newestMessageBody(value:any){
  const lines=clean(value,30000).split(/\r?\n/),kept:string[]=[];
  const replyStart=/^(?:-{2,}\s*(?:original message|videresendt meddelelse|forwarded message)\s*-{2,}|fra:|from:|sendt:|sent:|den .+ skrev:|on .+ wrote:)\s*/i;
  for(const line of lines){if(replyStart.test(line.trim()))break;if(/^>/.test(line.trim()))continue;kept.push(line)}
  return kept.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
function explicitRefs(text:string){
  const refs=new Set<string>();
  const re=/\b(?:tilbud(?:det|s)?|offer|quotation|quote|proposal)\s*(?:s?nr\.?|nummer|number|no\.?)?\s*[:#-]?\s*([a-z]?\d{3,8})\b/ig;
  for(const m of text.matchAll(re))refs.add(norm(m[1]));
  const filenameRe=/\b(?:tilbud|offer|quotation|quote|proposal)[ _-]*([a-z]?\d{3,8})\b/ig;
  for(const m of text.matchAll(filenameRe))refs.add(norm(m[1]));
  return[...refs].filter(Boolean);
}
function emailsInText(text:string){return[...new Set((clean(text,30000).match(emailRe)||[]).map(lower))]}
function explicitCompanyIds(text:string,companies:any[]){
  const hay=lower(text).replace(/\s+/g,' '),matches:any[]=[];
  for(const c of companies||[]){const name=lower(c.name).replace(/\s+/g,' ').trim();if(name.length>=4&&hay.includes(name))matches.push({id:c.id,len:name.length})}
  if(!matches.length)return[];const maxLen=Math.max(...matches.map(x=>x.len));return[...new Set(matches.filter(x=>x.len===maxLen).map(x=>x.id))];
}
function parseExplicitDate(text:string,at:any){
  const t=lower(text);let explicitDate:string|null=null;
  const dateMatch=t.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.]([0-2]?\d|3[01])\b/)||t.match(/\b([0-2]?\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/);
  if(dateMatch){
    const iso=dateMatch[1].length===4?`${dateMatch[1]}-${dateMatch[2].padStart(2,'0')}-${dateMatch[3].padStart(2,'0')}`:`${dateMatch[3]}-${dateMatch[2].padStart(2,'0')}-${dateMatch[1].padStart(2,'0')}`;
    const parsed=new Date(iso+'T12:00:00Z').getTime(),messageDay=cphDate(at);if(!Number.isNaN(parsed)&&iso>=messageDay)explicitDate=iso;
  }
  const relative=t.match(/\b(?:om|in)\s+(\d{1,2})\s+(?:dag(?:e)?s?|days?)\b/i);
  if(!explicitDate&&relative){const n=Math.max(1,Math.min(60,Number(relative[1])));explicitDate=addDays(at,n)}
  if(!explicitDate){
    const names:any={mandag:1,monday:1,tirsdag:2,tuesday:2,onsdag:3,wednesday:3,torsdag:4,thursday:4,fredag:5,friday:5};
    const m=t.match(/\b(næste|next|på|on)\s+(mandag|monday|tirsdag|tuesday|onsdag|wednesday|torsdag|thursday|fredag|friday)\b/i);
    if(m)explicitDate=weekdayDate(at,names[m[2].toLowerCase()],/^(næste|next)$/i.test(m[1]));
  }
  return explicitDate;
}
function classify(text:string,at:any){
  const t=lower(text);
  const lost=/\b(valgt en anden|afslår|afviser|ikke interesseret|ikke gå videre|går ikke videre|takker nej|declin(?:e|ed)|not proceed|chosen another)\b/i.test(t);
  const won=/\b(accepterer|accepteret|godkender|godkendt|ordren er jeres|vi går med|sæt i gang|bestiller|accepted|approved|go ahead|place the order)\b/i.test(t);
  const longDelay=/\b(næste år|til foråret|næste forår|næste sæson|senere på året|udskudt i længere tid|postponed until next year|next season)\b/i.test(t);
  const shortWait=/\b(næste uge|vender tilbage|afventer intern|hører fra os|snart|within a week|next week|awaiting internal)\b/i.test(t);
  const explicitDate=parseExplicitDate(t,at);
  if(lost)return{kind:'lost',status:'TABT',followUp:null,decisive:true,reason:'Mailen angiver, at tilbuddet er afslået.'};
  if(won)return{kind:'won',status:'VUNDET',followUp:null,decisive:true,reason:'Mailen angiver, at tilbuddet er accepteret.'};
  if(longDelay||(explicitDate&&new Date(explicitDate).getTime()>Date.now()+90*86400000))return{kind:'long_delay',status:'LUKKET – UDSKUDT',followUp:null,decisive:true,reason:'Sagen er udskudt så længe, at tilbuddet skal genberegnes ved genoptagelse.',futureDate:explicitDate};
  return{kind:shortWait?'short_wait':'follow_up',status:'I GANG',followUp:explicitDate||addBusinessDays(at,7),decisive:false,reason:explicitDate?'Opfølgningsdato fundet i mailen.':'Ingen sikker dato fundet; standardopfølgning er sat til 7 hverdage.'};
}
function evidenceText(m:any){return`${m.subject||''}\n${m.body||''}\n${(m.attachments||[]).join('\n')}`}
function isCandidate(m:any){if(/^lead manager:\s*(?:tilbud registreret|mailkontrol)/i.test(clean(m.subject)))return false;const evidence=evidenceText(m);return explicitRefs(evidence).length>0||/\b(?:tilbud(?:det|s)?|offer|quotation|quote|proposal|overslag)\b/i.test(`${m.subject}\n${newestMessageBody(m.body)}`)}
function forwardedOwnOffer(m:any){const t=evidenceText(m);return/\bmail\+klimaeksperten@minuba\.dk\b/i.test(t)||(/\btilbuds?\s*nr\.?\s*[:#-]?\s*[a-z]?\d{3,8}\b/i.test(t)&&/\bklimaeksperten\b/i.test(t))}
function minubaRefs(x:any){return[x?.orderNumber,x?.number,x?.offerNumber,x?.offerNo,x?.offerReference,x?.reference,x?.quotationNumber,x?.quoteNumber].map(norm).filter(Boolean)}
function minubaMatchesRef(x:any,target:string){
  if(minubaRefs(x).includes(target))return true;const seen=new Set<any>();
  const walk=(o:any,d=0):boolean=>{if(!o||typeof o!=='object'||d>4||seen.has(o))return false;seen.add(o);for(const[k,v]of Object.entries(o)){if(/offer|quote|quotation/i.test(k)&&['string','number'].includes(typeof v)&&norm(v)===target)return true;if(v&&typeof v==='object'&&walk(v,d+1))return true}return false};
  return walk(x);
}
function isMinubaDraft(x:any){const s=lower(x?.state||x?.status||x?.statusName||'');return/draft|kladde/.test(s)}
function addressText(a:any){return[a?.streetAddress||a?.street,a?.streetAddress2,a?.postCode||a?.postalCode,a?.city].filter(Boolean).join(', ')}
function emailList(v:any){return[...new Set((clean(v,3000).match(emailRe)||[]).map((x:string)=>x.trim()))]}
function minubaInfo(record:any,ref:string){
  const client=record?.client||record?.customer||{};
  const addresses=Array.isArray(record?.addresses)?record.addresses:[];
  const contactAddress=record?.contactAddress||addresses.find((a:any)=>String(a?.addressType||'').toUpperCase()==='CONTACT')||record?.billingAddress||addresses[0]||{};
  const deliveryAddress=record?.deliveryAddress||addresses.find((a:any)=>String(a?.addressType||'').toUpperCase()==='DELIVERY')||contactAddress||{};
  const contact=record?.contactPerson||record?.contact||{};
  const person=clean(contact?.name||record?.contactName||record?.theirref||record?.theirRef||contactAddress?.att,300);
  const emails=emailList(contact?.email||record?.contactEmail||contactAddress?.email||client?.email),email=emails[0]||'';
  const phone=clean(contact?.cellPhone||contact?.phone||contactAddress?.cellPhone||contactAddress?.phone,120);
  const created=clean(record?.sentDate||record?.offerDate||record?.date||record?.created||record?.updated,80);
  return{offer_ref:clean(record?.orderNumber||record?.number||ref,160),customer_name:clean(client?.name||record?.clientName||record?.customerName||contactAddress?.name,300),cvr:clean(client?.cvr||record?.cvr,40),installation_address:clean(addressText(deliveryAddress),700),contact_person:person,contact_email:email,contact_phone:phone,contact_details:clean([email,phone].filter(Boolean).join(' · '),700),sent_date:/^\d{4}-\d{2}-\d{2}/.test(created)?created.slice(0,10):null,minuba_status:clean(record?.state||record?.status||'PROPOSAL',160)||'PROPOSAL',minuba_record_type:'proposal',raw:record};
}

async function gmailToken(admin:any,clientId:string){
  const{data:mat,error}=await admin.rpc('get_gmail_oauth_material',{p_client_id:clientId});if(error)throw new Error(errText(error));
  const appId=clean(mat?.client_id,500),secret=clean(mat?.client_secret,1000),refresh=clean(mat?.refresh_token,4000);if(!appId||!secret||!refresh)throw new Error('Gmail er ikke forbundet med læseadgang');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:appId,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token'})});
  const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)throw new Error(clean(d?.error_description||d?.error||'Gmail tokenfejl',1000));return{access:String(d.access_token),account:lower(mat?.account)};
}
async function microsoftToken(admin:any,clientId:string){
  const{data:mat,error}=await admin.rpc('crm_get_microsoft_oauth_material',{p_client_id:clientId});if(error)throw new Error(errText(error));
  const appId=clean(mat?.client_id,500),secret=clean(mat?.client_secret,1000),refresh=clean(mat?.refresh_token,4000),scope=clean(mat?.scope,2000);if(!appId||!secret||!refresh||!scope.includes('Mail.Read'))throw new Error('Microsoft er ikke forbundet med Mail.Read');
  const r=await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:appId,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token',scope})});
  const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)throw new Error(clean(d?.error_description||d?.error||'Microsoft tokenfejl',1000));
  if(d.refresh_token&&d.refresh_token!==refresh)await admin.rpc('crm_set_microsoft_refresh_token',{p_client_id:clientId,p_refresh_token:d.refresh_token,p_account:mat?.account,p_scope:d.scope||scope});return{access:String(d.access_token),account:lower(mat?.account)};
}
async function fetchGmail(admin:any,clientId:string,lastSync:any,backfillDays:number){
  const{access,account}=await gmailToken(admin,clientId);
  const since=backfillDays>0?new Date(Date.now()-backfillDays*86400000):lastSync?new Date(new Date(lastSync).getTime()-48*3600000):new Date(Date.now()-14*86400000);
  const after=Math.floor(since.getTime()/1000);
  const q=`after:${after} {tilbud tilbuddet offer quotation quote proposal overslag}`;
  const lr=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q='+encodeURIComponent(q),{headers:{Authorization:'Bearer '+access}});
  const ld=await lr.json().catch(()=>({}));
  if(!lr.ok)throw new Error(clean(ld?.error?.message||`Gmail-fejl (${lr.status})`,1000));
  const ids=(ld.messages||[]).slice(0,50).map((x:any)=>clean(x?.id,1000)).filter(Boolean);
  const known=new Set<string>();
  if(ids.length){
    const{data,error}=await admin.from('crm_mail_messages').select('external_message_id').eq('client_id',clientId).eq('provider','gmail').in('external_message_id',ids);
    if(error)throw new Error(errText(error));
    for(const row of data||[])known.add(clean(row.external_message_id,1000));
  }
  const pending=ids.filter((id:string)=>!known.has(id));
  const rows:any[]=[];
  for(let i=0;i<pending.length;i+=5){
    const batch=await Promise.all(pending.slice(i,i+5).map(async(id:string)=>{
      const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,{headers:{Authorization:'Bearer '+access}});
      const m=await r.json().catch(()=>({}));
      if(!r.ok)return null;
      const fromRaw=gmailHeader(m.payload,'From'),toRaw=gmailHeader(m.payload,'To'),ccRaw=gmailHeader(m.payload,'Cc');
      const from=lower((fromRaw.match(emailRe)||[fromRaw])[0]),to=(toRaw.match(emailRe)||[]).map(lower),cc=(ccRaw.match(emailRe)||[]).map(lower),outbound=!!account&&from===account;
      const body=clean(gmailBody(m.payload),30000),attachments=gmailAttachmentNames(m.payload),embedded=emailsInText(body),correspondents=[...new Set([...(outbound?[...to,...cc]:[from]),...embedded].filter(x=>x&&x!==account))];
      return{provider:'gmail',id:clean(m.id,1000),thread:clean(m.threadId,1000),direction:outbound?'outbound':'inbound',from,to,cc,subject:gmailHeader(m.payload,'Subject'),body,attachments,at:m.internalDate?new Date(Number(m.internalDate)).toISOString():new Date().toISOString(),url:`https://mail.google.com/mail/u/0/#all/${m.id}`,correspondents};
    }));
    rows.push(...batch.filter(Boolean));
  }
  return rows;
}

async function fetchMicrosoft(admin:any,clientId:string,lastSync:any,backfillDays:number){
  const{access,account}=await microsoftToken(admin,clientId);
  const since=backfillDays>0?new Date(Date.now()-backfillDays*86400000):lastSync?new Date(new Date(lastSync).getTime()-48*3600000):new Date(Date.now()-14*86400000);
  const params=new URLSearchParams({'$top':'100','$select':'id,subject,body,bodyPreview,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,webLink,conversationId,hasAttachments','$filter':`receivedDateTime ge ${since.toISOString()}`,'$orderby':'receivedDateTime desc'});
  const r=await fetch('https://graph.microsoft.com/v1.0/me/messages?'+params,{headers:{Authorization:'Bearer '+access,Prefer:'outlook.body-content-type="text"'}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(clean(d?.error?.message||`Microsoft Graph-fejl (${r.status})`,1000));
  const rows:any[]=[];for(const m of(d.value||[])){
    const from=lower(m?.from?.emailAddress?.address),to=(m.toRecipients||[]).map((x:any)=>lower(x?.emailAddress?.address)).filter(Boolean),cc=(m.ccRecipients||[]).map((x:any)=>lower(x?.emailAddress?.address)).filter(Boolean),outbound=!!account&&from===account,body=clean(m.body?.content||m.bodyPreview,30000);let attachments:string[]=[];
    if(m.hasAttachments){const ar=await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(m.id)}/attachments?$select=name`,{headers:{Authorization:'Bearer '+access}});const ad=await ar.json().catch(()=>({}));if(ar.ok)attachments=(ad.value||[]).map((x:any)=>clean(x?.name,1000)).filter(Boolean)}
    const embedded=emailsInText(body),correspondents=[...new Set([...(outbound?[...to,...cc]:[from]),...embedded].filter(x=>x&&x!==account))];rows.push({provider:'microsoft',id:clean(m.id,1000),thread:clean(m.conversationId,1000),direction:outbound?'outbound':'inbound',from,to,cc,subject:clean(m.subject,1000),body,attachments,at:m.receivedDateTime||m.sentDateTime||new Date().toISOString(),url:clean(m.webLink,2000),correspondents});
  }return rows;
}

async function loadMinubaProposals(admin:any,clientId:string){
  const{data:intg}=await admin.from('crm_integrations').select('status').eq('client_id',clientId).eq('provider','minuba').maybeSingle();
  if(intg?.status!=='connected')return{enabled:false,rows:[]};
  async function tenantSecret(kind:string){const{data,error}=await admin.rpc('get_minuba_oauth_secret_for_service',{p_client_id:clientId,p_kind:kind});if(error)throw new Error(errText(error));return String(data||'')}
  let accessToken=await tenantSecret('access_token'),refreshToken=await tenantSecret('refresh_token');
  const{data:platform,error:pe}=await admin.from('crm_integrations').select('client_id,config').eq('provider','minuba').eq('config->>is_platform_oauth_client','true').limit(1).maybeSingle();if(pe)throw new Error(errText(pe));if(!platform?.client_id)throw new Error('Platform Minuba OAuth mangler');
  const[{data:oauthClientId,error:c1},{data:oauthClientSecret,error:c2}]=await Promise.all([admin.rpc('get_minuba_oauth_secret_for_service',{p_client_id:platform.client_id,p_kind:'client_id'}),admin.rpc('get_minuba_oauth_secret_for_service',{p_client_id:platform.client_id,p_kind:'client_secret'})]);if(c1||c2)throw new Error(errText(c1||c2));if(!accessToken||!refreshToken)throw new Error('Minuba OAuth mangler for kunden');
  const{data:conn}=await admin.from('crm_oauth_connections').select('token_expires_at,scope').eq('client_id',clientId).eq('provider','minuba').maybeSingle();
  async function refreshAccess(){const r=await fetch(String((platform.config||{}).oauth_token_url||'https://auth.minuba.dk/oauth2/token'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','Authorization':'Basic '+btoa(`${String(oauthClientId)}:${String(oauthClientSecret)}`)},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken})});const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{}if(!r.ok||!j.access_token)throw new Error('Minuba OAuth refresh fejlede: HTTP '+r.status);accessToken=String(j.access_token);refreshToken=String(j.refresh_token||refreshToken);const exp=new Date(Date.now()+Number(j.expires_in||3599)*1000).toISOString();const{error}=await admin.rpc('set_minuba_oauth_tokens',{p_client_id:clientId,p_access_token:accessToken,p_refresh_token:refreshToken,p_expires_at:exp,p_scope:String(j.scope||conn?.scope||'Administrator')});if(error)throw new Error(errText(error))}
  if(conn?.token_expires_at&&new Date(conn.token_expires_at).getTime()<=Date.now()+60000)await refreshAccess();
  const call=async()=>{const q=new URLSearchParams({state:'proposal',forAllUsers:'true',include:'client,addresses'}),r=await fetch('https://app.minuba.dk/api/1/Order?'+q,{headers:{Accept:'application/json',Authorization:'Bearer '+accessToken}});return{r,t:await r.text()}};
  let z=await call();if(z.r.status===401){await refreshAccess();z=await call()}let data:any={};try{data=JSON.parse(z.t)}catch{}if(!z.r.ok)throw new Error(`Minuba Order state=proposal fejlede: HTTP ${z.r.status}`);
  return{enabled:true,rows:arr(data,['orders','Orders','data']).filter((x:any)=>!isMinubaDraft(x))};
}
async function ensureMinubaCompany(admin:any,clientId:string,info:any,companies:any[]){
  const cvr=clean(info.cvr,40),name=clean(info.customer_name,300);let company:any=null;
  if(cvr)company=companies.find(c=>clean(c.cvr,40)===cvr)||null;
  if(!company&&name)company=companies.find(c=>norm(c.name)===norm(name))||null;
  if(!company){
    if(!name)throw new Error('Minuba fandt tilbuddet, men kundenavn mangler.');
    const{data,error}=await admin.from('crm_companies').insert({client_id:clientId,name,cvr:cvr||null,phone:info.contact_phone||null,address:info.installation_address||null,minuba_relationship_status:'existing_customer',minuba_exact_match:true,minuba_checked_at:new Date().toISOString(),minuba_raw:info.raw}).select('*').single();if(error)throw new Error(errText(error));company=data;companies.push(data);
  }else{
    const patch:any={minuba_relationship_status:'existing_customer',minuba_exact_match:true,minuba_checked_at:new Date().toISOString(),minuba_raw:info.raw};if(!company.cvr&&cvr)patch.cvr=cvr;if(!company.address&&info.installation_address)patch.address=info.installation_address;
    await admin.from('crm_companies').update(patch).eq('id',company.id);Object.assign(company,patch);
  }
  return company;
}
async function ensureMinubaContact(admin:any,clientId:string,companyId:string,info:any,contacts:any[]){
  const email=lower(info.contact_email),name=clean(info.contact_person,300),phone=clean(info.contact_phone,120);if(!email&&!name)return null;
  let contact=email?contacts.find(c=>c.company_id===companyId&&lower(c.email)===email):contacts.find(c=>c.company_id===companyId&&norm(c.full_name)===norm(name));
  if(!contact){const{data,error}=await admin.from('crm_contacts').insert({client_id:clientId,company_id:companyId,full_name:name||null,phone:phone||null,email:email||null,source_type:'minuba_offer',verified:true,verified_at:new Date().toISOString(),confidence:'high',email_is_inferred:false,email_verification_method:email?'minuba':null,email_verified_at:email?new Date().toISOString():null}).select('*').single();if(error)throw new Error(errText(error));contact=data;contacts.push(data)}
  return contact;
}

async function sendGmailFollowUpNotice(admin:any,clientId:string,recipient:string,rows:any[]){
  if(!recipient||!rows.length)return;const{access}=await gmailToken(admin,clientId),unique=[...new Map(rows.map((p:any)=>[p.offer?.id||p.offer_ref,p])).values()] as any[];
  const lines=unique.map((p:any)=>`- Tilbud ${p.offer?.offer_ref||p.offer_ref||'(uden nummer)'}${p.customer_name?` – ${p.customer_name}`:''}: opfølgning ${p.follow_up_date}`),subject='Lead Manager: tilbud registreret til opfølgning',body=`Hej\n\nJeg har oprettet eller opdateret følgende tilbud og lagt dem til opfølgning i Lead Manager:\n\n${lines.join('\n')}\n\nVenlig hilsen\nLead Manager`,raw=[`To: ${recipient}`,`Subject: ${subject}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','',body].join('\r\n');
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({raw:b64urlEncode(raw)})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(clean(d?.error?.message||`Gmail-kvittering fejlede (${r.status})`,1000));
}
async function applyProposal(admin:any,p:any,actor='Mail & Conversation Agent'){
  const now=new Date().toISOString();let offer=p.offer||null;
  const min=p.minuba_info||null;
  if(!offer&&p.create_offer){
    const payload:any={client_id:p.client_id,company_id:p.company_id,lead_id:p.lead_id||null,offer_ref:p.offer_ref,customer_name:p.customer_name||null,sent_date:min?.sent_date||p.message_at.slice(0,10),follow_up_date:p.follow_up_date,follow_up_owner:p.owner||null,status:p.status,status_reason:p.reason,current_comment:p.comment,status_source:'mail_sync',status_updated_at:now,contact_person:min?.contact_person||null,contact_details:min?.contact_details||null,installation_address:min?.installation_address||null,raw:{created_from_mail:true,external_message_id:p.external_message_id,source_evidence:'explicit_mail_minuba_validated'}};
    if(min){payload.minuba_status=min.minuba_status;payload.minuba_record_type='proposal';payload.minuba_last_checked_at=now;payload.minuba_last_seen_at=now;payload.minuba_sync_state='active';payload.minuba_raw=min.raw}
    const ins=await admin.from('crm_offers').insert(payload).select('*').single();if(ins.error)throw new Error(errText(ins.error));offer=ins.data;
  }else if(offer){
    const patch:any={updated_at:now,status_source:'mail_sync',status_updated_at:now,status_reason:p.reason,current_comment:p.comment,follow_up_date:p.follow_up_date||null};if(p.status)patch.status=p.status;
    if(min){if(!offer.contact_person&&min.contact_person)patch.contact_person=min.contact_person;if(!offer.contact_details&&min.contact_details)patch.contact_details=min.contact_details;patch.minuba_status=min.minuba_status;patch.minuba_record_type='proposal';patch.minuba_last_checked_at=now;patch.minuba_last_seen_at=now;patch.minuba_sync_state='active';patch.minuba_raw=min.raw}
    const up=await admin.from('crm_offers').update(patch).eq('id',offer.id).eq('client_id',p.client_id).select('*').single();if(up.error)throw new Error(errText(up.error));offer=up.data;
  }
  if(!offer)return null;
  if(closedStatuses.has(p.status)){await admin.from('crm_tasks').update({status:'done',updated_at:now}).eq('client_id',p.client_id).eq('offer_id',offer.id).eq('task_type','offer_followup').eq('status','open')}
  await admin.from('crm_mail_messages').update({offer_id:offer.id,company_id:offer.company_id,lead_id:offer.lead_id,contact_id:p.contact_id||null,metadata:{...(p.mail_metadata||{}),offer_sync_processed:true,offer_sync_result:p.status,offer_sync_reason:p.reason,offer_sync_evidence:p.evidence||{}}}).eq('client_id',p.client_id).eq('provider',p.provider).eq('external_message_id',p.external_message_id);
  await admin.from('crm_activities').insert({client_id:p.client_id,company_id:offer.company_id,lead_id:offer.lead_id,offer_id:offer.id,type:'Mail→tilbud',actor_type:'agent',actor_name:actor,summary:p.comment,metadata:{provider:p.provider,external_message_id:p.external_message_id,previous_status:p.previous_status||null,status:p.status,follow_up_date:p.follow_up_date,automatic:true,evidence:p.evidence||{},minuba_validated:!!min}});
  return offer;
}

async function loadStoredPendingMessages(admin:any,clientId:string,integrations:any[],backfillDays:number){
  const days=Math.max(45,backfillDays||0),since=new Date(Date.now()-days*86400000).toISOString();
  const{data,error}=await admin.from('crm_mail_messages').select('*').eq('client_id',clientId).gte('message_at',since).order('message_at',{ascending:false}).limit(500);
  if(error)throw new Error(errText(error));
  const accountByProvider=new Map<string,string>();
  const internalAccounts=new Set<string>();
  for(const i of integrations||[]){
    const account=lower(i?.account);
    if(account){
      accountByProvider.set(clean(i.provider,80),account);
      internalAccounts.add(account);
    }
  }
  const rows:any[]=[];
  for(const m of data||[]){
    if(m?.metadata?.offer_sync_processed===true||!m?.external_message_id)continue;
    const provider=clean(m.provider,80),account=accountByProvider.get(provider)||'',from=lower(m.from_email);
    const to=Array.isArray(m.to_emails)?m.to_emails.map(lower).filter(Boolean):[];
    const cc=Array.isArray(m.cc_emails)?m.cc_emails.map(lower).filter(Boolean):[];
    const body=clean(m.body_text,30000),embedded=emailsInText(body),outbound=m.direction==='outbound';
    const correspondents=[...new Set([...(outbound?[...to,...cc]:[from]),...embedded].filter(x=>x&&!internalAccounts.has(x)&&x!==account))];
    const meta=m.metadata||{},attachments=Array.isArray(meta.attachments)?meta.attachments:Array.isArray(meta.attachment_names)?meta.attachment_names:[];
    rows.push({provider,id:clean(m.external_message_id,1000),thread:clean(m.external_thread_id,1000),direction:m.direction||'inbound',from,to,cc,subject:clean(m.subject,1000),body,attachments,at:m.message_at||m.created_at||new Date().toISOString(),url:clean(meta.source_url,3000),correspondents});
  }
  return rows;
}

async function markMailIgnored(admin:any,clientId:string,m:any,existing:any,matched:any,result:string,reason:string){
  const metadata={...(existing?.metadata||{}),source_url:clean(existing?.metadata?.source_url||m.url,3000),offer_sync_candidate:false,offer_sync_processed:true,offer_sync_result:result,offer_sync_reason:reason};
  if(existing){
    const{error}=await admin.from('crm_mail_messages').update({
      company_id:matched?.company_id||existing.company_id||null,
      lead_id:matched?.lead_id||existing.lead_id||null,
      offer_id:matched?.id||existing.offer_id||null,
      metadata
    }).eq('id',existing.id).eq('client_id',clientId);
    if(error)throw new Error(errText(error));
    return;
  }
  const{error}=await admin.from('crm_mail_messages').insert({
    client_id:clientId,
    company_id:matched?.company_id||null,
    lead_id:matched?.lead_id||null,
    offer_id:matched?.id||null,
    contact_id:null,
    provider:m.provider,
    external_message_id:m.id,
    external_thread_id:m.thread||null,
    direction:m.direction,
    from_email:m.from,
    to_emails:m.to||[],
    cc_emails:m.cc||[],
    subject:m.subject,
    body_text:m.body,
    message_at:m.at,
    metadata
  });
  if(error&&!/duplicate key value violates unique constraint/i.test(errText(error)))throw new Error(errText(error));
}

async function runClient(admin:any,client:any,dryRun:boolean,backfillDays:number){
  const clientId=client.id;
  const[{data:limits},{data:integrations},{data:offers},{data:contacts},{data:companies},{data:users}]=await Promise.all([
    admin.from('crm_usage_limits').select('*').eq('client_id',clientId).maybeSingle(),
    admin.from('crm_integrations').select('provider,status,account,last_sync_at,last_error').eq('client_id',clientId).in('provider',['gmail','microsoft','minuba']),
    admin.from('crm_offers').select('*').eq('client_id',clientId),
    admin.from('crm_contacts').select('*').eq('client_id',clientId),
    admin.from('crm_companies').select('*').eq('client_id',clientId),
    admin.from('crm_users').select('email,role,active').eq('client_id',clientId).eq('active',true),
  ]);
  if(!limits?.allow_mail_monitor)return{client_id:clientId,skipped:'mail_monitor_disabled'};
  const owner=users?.find((u:any)=>['owner','admin'].includes(lower(u.role)))?.email||users?.[0]?.email||null;
  const companyById=new Map((companies||[]).map((x:any)=>[x.id,x])),companyByEmail=new Map<string,string[]>(),companyByDomain=new Map<string,string[]>();
  const rebuildMaps=()=>{
    companyByEmail.clear();companyByDomain.clear();
    for(const c of contacts||[]){const e=lower(c.email);if(!e)continue;const a=companyByEmail.get(e)||[];if(!a.includes(c.company_id))a.push(c.company_id);companyByEmail.set(e,a);const d=domainOf(e);if(d){const b=companyByDomain.get(d)||[];if(!b.includes(c.company_id))b.push(c.company_id);companyByDomain.set(d,b)}}
    for(const c of companies||[]){companyById.set(c.id,c);for(const d0 of[c.domain,c.website_url]){const d=normalizeDomain(d0);if(!d)continue;const a=companyByDomain.get(d)||[];if(!a.includes(c.id))a.push(c.id);companyByDomain.set(d,a)}}
  };rebuildMaps();
  const mailConnected=(integrations||[]).filter((i:any)=>['gmail','microsoft'].includes(i.provider)&&i.status==='connected'),providerResults:any[]=[],successfulProviders:string[]=[];
  let allMessages:any[]=await loadStoredPendingMessages(admin,clientId,integrations||[],backfillDays);
  providerResults.push({provider:'stored_mail',pending:allMessages.length});
  for(const i of mailConnected){try{const rows=i.provider==='microsoft'?await fetchMicrosoft(admin,clientId,i.last_sync_at,backfillDays):await fetchGmail(admin,clientId,i.last_sync_at,backfillDays);allMessages.push(...rows);providerResults.push({provider:i.provider,new_messages:rows.length});successfulProviders.push(i.provider)}catch(e){const msg=errText(e);providerResults.push({provider:i.provider,error:msg});if(!dryRun)await admin.from('crm_integrations').update({last_error:msg.slice(0,1000),updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider',i.provider)}}
  allMessages=[...new Map(allMessages.map((m:any)=>[`${m.provider}:${m.id}`,m])).values()];
  let minuba:any={enabled:false,rows:[]};
  if((integrations||[]).some((i:any)=>i.provider==='minuba'&&i.status==='connected')){try{minuba=await loadMinubaProposals(admin,clientId);providerResults.push({provider:'minuba_validation',active_proposals:minuba.rows.length})}catch(e){minuba={enabled:true,rows:[],error:errText(e)};providerResults.push({provider:'minuba_validation',error:minuba.error})}}
  const idsByProvider=new Map<string,string[]>();for(const m of allMessages){const a=idsByProvider.get(m.provider)||[];a.push(m.id);idsByProvider.set(m.provider,a)}
  const existingByKey=new Map<string,any>();for(const[provider,ids]of idsByProvider){if(!ids.length)continue;const{data}=await admin.from('crm_mail_messages').select('*').eq('client_id',clientId).eq('provider',provider).in('external_message_id',ids);for(const row of(data||[]))existingByKey.set(`${provider}:${row.external_message_id}`,row)}
  const proposals:any[]=[],followUpNotices:any[]=[];let stored=0,processed=0,ignored=0,approvals=0,minubaCreated=0;
  for(const m of allMessages.sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime())){
    const key=`${m.provider}:${m.id}`,existing=existingByKey.get(key);if(existing?.metadata?.offer_sync_processed)continue;if(!isCandidate(m))continue;
    const evidence=evidenceText(m),refs=explicitRefs(evidence);if(!refs.length)continue;
    let matched:any=null,matchType='';for(const ref of refs){const rows=(offers||[]).filter((o:any)=>norm(o.offer_ref)===ref);if(rows.length===1){matched=rows[0];matchType='explicit_offer_ref';break}}
    const emailCompanyIds=[...new Set((m.correspondents||[]).flatMap((e:string)=>[...(companyByEmail.get(lower(e))||[]),...(companyByDomain.get(domainOf(e))||[])]))],nameCompanyIds=explicitCompanyIds(evidence,companies||[]),candidateCompanyIds=[...new Set([...emailCompanyIds,...nameCompanyIds])];
    let companyId=matched?.company_id||(candidateCompanyIds.length===1?candidateCompanyIds[0]:null),contactId:any=null,min:any=null,minubaExplanation='';
    const newestBody=newestMessageBody(m.body),analysisText=`${m.subject}\n${newestBody||m.body}`,analysis:any=classify(analysisText,m.at);
    if(m.direction==='outbound'&&analysis.decisive){analysis.kind='follow_up';analysis.status='I GANG';analysis.followUp=addBusinessDays(m.at,7);analysis.decisive=false;analysis.reason='Udgående tilbudsmail registreret; standardopfølgning er sat til 7 hverdage.'}
    const offerRef=matched?.offer_ref||refs[0]||null;
    const statusAt=matched?.status_updated_at||matched?.updated_at||null;
    const mailTime=new Date(m.at).getTime(),statusTime=statusAt?new Date(statusAt).getTime():NaN;
    const staleAgainstCurrent=!!matched&&Number.isFinite(statusTime)&&Number.isFinite(mailTime)&&mailTime<=statusTime;
    const closedReopen=!!matched&&closedStatuses.has(matched.status)&&analysis.status==='I GANG';
    if(staleAgainstCurrent||closedReopen){
      const result=staleAgainstCurrent?'IGNORED_STALE_OFFER_STATUS':'IGNORED_CLOSED_OFFER_REOPEN';
      const reason=staleAgainstCurrent
        ?`Mailen er ældre end tilbudets nuværende status (${matched.status}) og må ikke overskrive den.`
        :`Tilbuddet står allerede som ${matched.status}; en almindelig opfølgningsmail må ikke genåbne det automatisk.`;
      proposals.push({client_id:clientId,provider:m.provider,external_message_id:m.id,message_at:m.at,offer:{id:matched.id,offer_ref:matched.offer_ref,status:matched.status,manual_lock:matched.manual_lock},offer_ref:matched.offer_ref,status:matched.status,ignored:true,offer_sync_result:result,reason});
      if(!dryRun){await markMailIgnored(admin,clientId,m,existing,matched,result,reason);ignored++}
      continue;
    }
    if(offerRef&&minuba.enabled&&!minuba.error){const row=minuba.rows.find((x:any)=>minubaMatchesRef(x,norm(offerRef)));if(row&&!isMinubaDraft(row)){min=minubaInfo(row,offerRef);if(!companyId){const company=await ensureMinubaCompany(admin,clientId,min,companies||[]);companyId=company.id;rebuildMaps()}if(companyId){const contact=await ensureMinubaContact(admin,clientId,companyId,min,contacts||[]);contactId=contact?.id||null;rebuildMaps()}}else if(!matched)minubaExplanation=`Tilbud ${offerRef} blev ikke fundet som et aktivt PROPOSAL i Minuba og oprettes derfor ikke automatisk.`}
    else if(offerRef&&minuba.enabled&&minuba.error&&!matched)minubaExplanation=`Minuba-valideringen fejlede: ${minuba.error}. Nyt tilbud oprettes ikke uden sikker validering.`;
    const canCreate=!matched&&!!offerRef&&!!companyId&&(minuba.enabled?!!min:(m.direction==='outbound'||forwardedOwnOffer(m)));
    const highConfidence=matchType==='explicit_offer_ref'||canCreate;
    const customerName=min?.customer_name||companyById.get(companyId)?.name||null;
    const comment=`${analysis.reason} Mail: ${m.subject||'(uden emne)'} (${new Date(m.at).toLocaleDateString('da-DK')}).`+(analysis.kind==='long_delay'?' Tilbuddet kræver ny beregning ved genoptagelse.':'')+(min?' Verificeret som aktivt tilbud i Minuba.':'');
    const evidenceMeta={offer_refs:refs,attachments:m.attachments||[],matched_company_by_email:emailCompanyIds,matched_company_by_name:nameCompanyIds,mail_only:!min,minuba_validated:!!min};
    const proposal:any={client_id:clientId,provider:m.provider,external_message_id:m.id,message_at:m.at,company_id:companyId,contact_id:contactId,lead_id:matched?.lead_id||null,offer:matched,create_offer:canCreate,offer_ref:offerRef,customer_name:customerName,previous_status:matched?.status||null,status:analysis.status,follow_up_date:analysis.followUp,owner,reason:analysis.reason,comment,mail_metadata:{...(existing?.metadata||{}),source_url:m.url,offer_sync_candidate:true},match_type:matchType||(canCreate?'explicit_minuba_validated':'uncertain'),evidence:evidenceMeta,minuba_info:min};
    proposals.push({...proposal,offer:matched?{id:matched.id,offer_ref:matched.offer_ref,status:matched.status,manual_lock:matched.manual_lock}:null,minuba_info:min?{offer_ref:min.offer_ref,customer_name:min.customer_name,status:min.minuba_status}:null});if(dryRun)continue;
    if(!existing){const ins=await admin.from('crm_mail_messages').insert({client_id:clientId,company_id:companyId,lead_id:proposal.lead_id,offer_id:matched?.id||null,contact_id:contactId,provider:m.provider,external_message_id:m.id,external_thread_id:m.thread,direction:m.direction,from_email:m.from,to_emails:m.to,cc_emails:m.cc,subject:m.subject,body_text:m.body,message_at:m.at,metadata:proposal.mail_metadata}).select('*').single();if(ins.error)throw new Error(errText(ins.error));proposal.mail_metadata=ins.data.metadata||{};stored++}
    const automatic=highConfidence&&!matched?.manual_lock;
    if(automatic){const applied=await applyProposal(admin,proposal);processed++;if(applied&&proposal.follow_up_date)followUpNotices.push({...proposal,offer:applied});if(canCreate&&min)minubaCreated++;await admin.from('crm_approvals').update({status:'approved',decided_at:new Date().toISOString()}).eq('client_id',clientId).eq('action_type','offer_mail_update').eq('status','pending').contains('payload',{provider:m.provider,external_message_id:m.id})}
    else{
      const explanation=minubaExplanation||(!companyId?'Kunden kunne ikke matches sikkert ud fra mailen eller Minuba.':!matched&&!canCreate?'Tilbuddet står i mailen, men kan ikke oprettes automatisk med sikkerhed.':matched?.manual_lock?'Tilbuddet er manuelt låst.':'Kræver kontrol.');
      const{data:prior}=await admin.from('crm_approvals').select('id').eq('client_id',clientId).eq('action_type','offer_mail_update').eq('status','pending').contains('payload',{provider:m.provider,external_message_id:m.id}).limit(1);
      if(!prior?.length){const ins=await admin.from('crm_approvals').insert({client_id:clientId,lead_id:proposal.lead_id,action_type:'offer_mail_update',status:'pending',payload:{...proposal,offer:matched?{id:matched.id,offer_ref:matched.offer_ref,status:matched.status}:null,minuba_info:min?{offer_ref:min.offer_ref,customer_name:min.customer_name,status:min.minuba_status}:null,subject:m.subject,from:m.from,explanation},ai_generated:false});if(ins.error)throw new Error(errText(ins.error));approvals++}
      const pendingMeta={...(proposal.mail_metadata||{}),offer_sync_candidate:true,offer_sync_processed:true,offer_sync_result:'PENDING_APPROVAL',offer_sync_reason:explanation};
      const pending=await admin.from('crm_mail_messages').update({metadata:pendingMeta}).eq('client_id',clientId).eq('provider',m.provider).eq('external_message_id',m.id);
      if(pending.error)throw new Error(errText(pending.error));
    }
  }
  if(!dryRun){
    if(followUpNotices.length){try{await sendGmailFollowUpNotice(admin,clientId,owner,followUpNotices)}catch(e){providerResults.push({provider:'gmail_notification',error:errText(e)})}}
    const now=new Date().toISOString();for(const p of successfulProviders)await admin.from('crm_integrations').update({last_sync_at:now,last_error:null,updated_at:now}).eq('client_id',clientId).eq('provider',p);
    await admin.from('crm_usage_events').insert({client_id:clientId,event_type:'mail_offer_sync',quantity:1,metadata:{fetched:allMessages.length,candidates:proposals.length,processed,ignored,approvals,minuba_created:minubaCreated,mode:'stored_first_closed_guard_pending_v12'}});
  }
  return{client_id:clientId,dry_run:dryRun,providers:providerResults,fetched:allMessages.length,candidates:proposals.length,stored,processed,ignored,approvals,minuba_created:minubaCreated,proposals:proposals.slice(0,25)};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const body=await req.json().catch(()=>({})),action=clean(body.action||'run',40),requestedClient=clean(body.client_id,100),cronSecret=clean(req.headers.get('x-mail-offer-sync-secret'),500),{data:expected}=await admin.rpc('crm_get_mail_offer_sync_secret'),cron=!!cronSecret&&!!expected&&safeEqual(cronSecret,String(expected));let user:any=null;
    if(!cron){const token=clean((req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,''),5000);if(!token)return json({error:'Mangler login-token'},401);const auth=await admin.auth.getUser(token);user=auth.data?.user;if(auth.error||!user?.id)return json({error:'Ugyldigt login'},401)}
    if(action==='apply_approval'){
      if(!user)return json({error:'Kun en bruger kan godkende ændringer'},403);const approvalId=clean(body.approval_id,100),{data:approval}=await admin.from('crm_approvals').select('*').eq('id',approvalId).eq('status','pending').eq('action_type','offer_mail_update').single();if(!approval)return json({error:'Godkendelsen blev ikke fundet'},404);
      const{data:membership}=await admin.from('crm_users').select('id').eq('client_id',approval.client_id).eq('auth_user_id',user.id).eq('active',true).maybeSingle();if(!membership)return json({error:'Ingen adgang'},403);const p=approval.payload||{};if(p.offer?.id){const{data:offer}=await admin.from('crm_offers').select('*').eq('id',p.offer.id).eq('client_id',approval.client_id).single();p.offer=offer}await applyProposal(admin,p,user.email||'Bruger');await admin.from('crm_approvals').update({status:'approved',decided_at:new Date().toISOString()}).eq('id',approval.id);return json({ok:true});
    }
    let clients:any[]=[];if(requestedClient){if(user){const{data:membership}=await admin.from('crm_users').select('id').eq('client_id',requestedClient).eq('auth_user_id',user.id).eq('active',true).maybeSingle();if(!membership)return json({error:'Ingen adgang til denne klient'},403)}const{data}=await admin.from('crm_clients').select('id,name,settings').eq('id',requestedClient).limit(1);clients=data||[]}else{if(!cron)return json({error:'client_id er påkrævet'},400);const{data}=await admin.from('crm_clients').select('id,name,settings');clients=data||[]}
    const dryRun=body.dry_run===true,backfillDays=Math.max(0,Math.min(30,Number(body.backfill_days||0))),results:any[]=[];
    for(const c of clients){try{results.push(await runClient(admin,c,dryRun,backfillDays))}catch(e){results.push({client_id:c.id,error:errText(e)})}}
    const failures=results.filter(r=>r.error||r.providers?.some((p:any)=>p.error&&p.provider!=='gmail_notification'));
    return json({ok:failures.length===0,dry_run:dryRun,results},failures.length?207:200);
  }catch(e){console.error(e);return json({error:errText(e)},500)}
});
