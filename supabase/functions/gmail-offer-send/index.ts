import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { PDFDocument, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1?target=deno';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
const trim=(v:unknown,max=10000)=>String(v??'').trim().slice(0,max);
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const uuidOk=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const dateOk=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(new Date(v+'T12:00:00Z').getTime());
const bytesToB64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)};
const b64url=(s:string)=>bytesToB64(new TextEncoder().encode(s)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const b64header=(s:string)=>'=?UTF-8?B?'+bytesToB64(new TextEncoder().encode(s))+'?=';
const escHtml=(s:string)=>s.replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]||m));
const ymd=(d:Date)=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
const senderName=(client:any)=>trim(client?.settings?.mail_sender_name||client?.settings?.contact_name||client?.name||'',120).replace(/[\r\n]+/g,' ');
const fromB64Url=(s:string)=>{let x=String(s||'').replaceAll('-','+').replaceAll('_','/');while(x.length%4)x+='=';return x};
const wrap76=(s:string)=>s.match(/.{1,76}/g)?.join('\r\n')||s;

const refNorm=(v:any)=>trim(v,300).toLowerCase().replace(/[^a-z0-9æøå]+/g,'');
const headerValue=(payload:any,name:string)=>trim((payload?.headers||[]).find((h:any)=>String(h?.name||'').toLowerCase()===name.toLowerCase())?.value,3000);
function collectPdfParts(payload:any,out:any[]=[]):any[]{
  if(!payload)return out;
  const filename=trim(payload.filename,1000),mime=trim(payload.mimeType,200).toLowerCase();
  if(filename&&(mime==='application/pdf'||/\.pdf$/i.test(filename)))out.push({part:payload,filename});
  for(const p of payload.parts||[])collectPdfParts(p,out);
  return out;
}
function pdfB64Valid(value:string){
  const b64=String(value||'').replace(/\s+/g,'');
  if(b64.length<1200)return false;
  try{return atob(b64.slice(0,32)).startsWith('%PDF-')}catch{return false}
}
function arrayFrom(value:any){
  if(Array.isArray(value))return value;
  for(const k of ['files','Files','data','items','results'])if(Array.isArray(value?.[k]))return value[k];
  return[];
}
function minubaOfferId(offer:any){return trim(offer?.minuba_offer_id||offer?.minuba_raw?.id||offer?.minuba_raw?.orderId,200)}
function minubaPdfScore(item:any,offerRef:string,minubaId:string){
  const name=trim(item?.filename||item?.fileName||item?.name||item?.title,1000),n=refNorm(name),target=refNorm(offerRef);
  const mime=trim(item?.mimeType||item?.contentType||item?.type,200).toLowerCase();
  if(!(mime.includes('pdf')||/\.pdf$/i.test(name)))return -999;
  let score=0;
  if(target&&n.includes(target))score+=90;
  if(/tilbud|offer|quote|quotation|proposal/i.test(name))score+=20;
  const relation=trim(item?.orderId||item?.parentId||item?.entityId||item?.relationId,200);
  if(minubaId&&relation&&relation.toLowerCase()===minubaId.toLowerCase())score+=50;
  return score;
}
const pdfTextSafe=(v:any)=>String(v??'')
  .replace(/\u00a0/g,' ')
  .replace(/[–—]/g,'-')
  .replace(/[“”]/g,'"')
  .replace(/[‘’]/g,"'")
  .replace(/…/g,'...')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g,' ');
function decodeHtmlEntities(value:string){
  const named:Record<string,string>={nbsp:' ',thinsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",aelig:'æ',AElig:'Æ',oslash:'ø',Oslash:'Ø',aring:'å',Aring:'Å',eacute:'é',Eacute:'É'};
  return String(value||'').replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z]+);/g,(all,key)=>{
    if(named[key]!==undefined)return named[key];
    if(/^#x/i.test(key)){const n=parseInt(key.slice(2),16);return Number.isFinite(n)?String.fromCodePoint(n):all}
    if(/^#\d+/.test(key)){const n=parseInt(key.slice(1),10);return Number.isFinite(n)?String.fromCodePoint(n):all}
    return all;
  });
}
function minubaProposalPlainText(raw:any){
  const price=Number(raw?.price??raw?.calculationPrice);
  const priceText=Number.isFinite(price)?price.toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.'):'';
  const expiration=trim(raw?.expirationDate||raw?.expiration,100);
  let html=trim(raw?.proposalText,500000)
    .replaceAll('{{order.name}}',trim(raw?.name,1000))
    .replaceAll('{{order.proposalPriceLegacy}}',priceText?('Tilbudssum: '+priceText+' kr.'):'')
    .replaceAll('{{proposal.expirationDate}}',expiration)
    .replaceAll('{{order.link}}','')
    .replaceAll('{{user.name}}','');
  html=html
    .replace(/<\s*br\s*\/?>/gi,'\n')
    .replace(/<\s*li\b[^>]*>/gi,'- ')
    .replace(/<\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi,'\n')
    .replace(/<[^>]+>/g,'');
  return pdfTextSafe(decodeHtmlEntities(html))
    .replace(/\r/g,'')
    .replace(/[ \t]+\n/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}
function wrapPdfText(text:string,font:any,size:number,maxWidth:number){
  const words=pdfTextSafe(text).split(/\s+/).filter(Boolean),lines:string[]=[];
  let line='';
  for(const word of words){
    const candidate=line?line+' '+word:word;
    if(font.widthOfTextAtSize(candidate,size)<=maxWidth){line=candidate;continue}
    if(line){lines.push(line);line=''}
    if(font.widthOfTextAtSize(word,size)<=maxWidth){line=word;continue}
    let part='';
    for(const ch of word){
      const next=part+ch;
      if(part&&font.widthOfTextAtSize(next,size)>maxWidth){lines.push(part);part=ch}else part=next;
    }
    line=part;
  }
  if(line)lines.push(line);
  return lines.length?lines:[''];
}
async function renderOfferPdf(raw:any,offerRef:string,customerName:string){
  const pdf=await PDFDocument.create();
  pdf.setTitle('Tilbud '+offerRef);
  pdf.setSubject(trim(raw?.name,1000)||'Tilbud');
  pdf.setCreator('Lead Manager · Minuba live data');
  const normal=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const W=595.28,H=841.89,margin=46,contentW=W-margin*2;
  const pages:any[]=[];
  let page=pdf.addPage([W,H]);pages.push(page);let y=H-50;
  const newPage=()=>{page=pdf.addPage([W,H]);pages.push(page);y=H-50};
  const need=(h:number)=>{if(y-h<52)newPage()};
  const drawWrapped=(text:string,size=9.5,isBold=false,gap=4)=>{
    const font=isBold?bold:normal,lines=wrapPdfText(text,font,size,contentW),lh=size+3;
    need(lines.length*lh+gap);
    for(const line of lines){page.drawText(line,{x:margin,y,size,font});y-=lh}
    y-=gap;
  };
  page.drawText('Klimaeksperten ApS',{x:margin,y,size:18,font:bold});y-=28;
  page.drawText('Tilbud '+pdfTextSafe(offerRef),{x:margin,y,size:15,font:bold});y-=22;
  if(customerName)drawWrapped('Kunde: '+customerName,10,true,1);
  if(raw?.name)drawWrapped('Vedr.: '+trim(raw.name,1000),10,true,1);
  const address=raw?.contactAddress;
  const addr=[address?.streetAddress,address?.postCode,address?.city].filter(Boolean).join(' ');
  if(addr)drawWrapped(addr,9.5,false,1);
  const price=Number(raw?.price??raw?.calculationPrice);
  if(Number.isFinite(price)){
    const p=price.toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
    drawWrapped('Tilbudssum: '+p+' kr.',10,true,1);
  }
  const expiration=trim(raw?.expirationDate||raw?.expiration,100);
  if(expiration)drawWrapped('Tilbuddets udløbsdato: '+expiration,9.5,false,2);
  y-=8;
  const body=minubaProposalPlainText(raw);
  for(const rawLine of body.split('\n')){
    const line=rawLine.trim();
    if(!line){y-=5;continue}
    const heading=/^(Arbejdsbeskrivelse|Dimensioneringsgrundlag|Løsningsbeskrivelse|Indeholdt i tilbud|Uden for tilbud|Levering|Særlig bemærkninger|Tilbudssum|Med Venlig Hilsen)\s*:?$/i.test(line);
    drawWrapped(line,heading?10:9.5,heading,heading?4:2);
  }
  pages.forEach((p:any,i:number)=>{
    p.drawText('Tilbud '+pdfTextSafe(offerRef)+' · Klimaeksperten ApS',{x:margin,y:24,size:8,font:normal});
    p.drawText(String(i+1)+' / '+String(pages.length),{x:W-margin-28,y:24,size:8,font:normal});
  });
  return new Uint8Array(await pdf.save());
}
async function minubaAccessToken(admin:any,clientId:string){
  const {data:intg}=await admin.from('crm_integrations').select('status').eq('client_id',clientId).eq('provider','minuba').maybeSingle();
  if(intg?.status!=='connected')return null;
  const tenantSecret=async(kind:string)=>{const {data,error}=await admin.rpc('get_minuba_oauth_secret_for_service',{p_client_id:clientId,p_kind:kind});if(error)throw error;return String(data||'')};
  let access=await tenantSecret('access_token'),refresh=await tenantSecret('refresh_token');
  if(!access||!refresh)return null;
  const {data:platform,error:pe}=await admin.from('crm_integrations').select('client_id,config').eq('provider','minuba').eq('config->>is_platform_oauth_client','true').limit(1).maybeSingle();
  if(pe||!platform?.client_id)return null;
  const [{data:cid},{data:secret}]=await Promise.all([
    admin.rpc('get_minuba_oauth_secret_for_service',{p_client_id:platform.client_id,p_kind:'client_id'}),
    admin.rpc('get_minuba_oauth_secret_for_service',{p_client_id:platform.client_id,p_kind:'client_secret'})
  ]);
  if(!cid||!secret)return null;
  const {data:conn}=await admin.from('crm_oauth_connections').select('token_expires_at,scope').eq('client_id',clientId).eq('provider','minuba').maybeSingle();
  async function refreshAccess(){
    const r=await fetch(String((platform.config||{}).oauth_token_url||'https://auth.minuba.dk/oauth2/token'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','Authorization':'Basic '+btoa(String(cid)+':'+String(secret))},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh})});
    const j=await r.json().catch(()=>({}));if(!r.ok||!j.access_token)return false;
    access=String(j.access_token);refresh=String(j.refresh_token||refresh);
    await admin.rpc('set_minuba_oauth_tokens',{p_client_id:clientId,p_access_token:access,p_refresh_token:refresh,p_expires_at:new Date(Date.now()+Number(j.expires_in||3599)*1000).toISOString(),p_scope:String(j.scope||conn?.scope||'Administrator')});
    return true;
  }
  if(conn?.token_expires_at&&new Date(conn.token_expires_at).getTime()<=Date.now()+60000){if(!await refreshAccess())return null}
  return{token:access,refresh:refreshAccess};
}
async function minubaPdfCandidate(admin:any,clientId:string,offer:any,offerRef:string){
  const stableId=minubaOfferId(offer);if(!stableId)return null;
  let auth:any=null;try{auth=await minubaAccessToken(admin,clientId)}catch(e){console.error('[gmail-offer-send] Minuba token lookup failed',e)}
  if(!auth?.token)return null;
  const get=async(path:string,accept='application/json,application/pdf,*/*')=>{
    const once=()=>fetch('https://app.minuba.dk/api/1/'+path,{headers:{Accept:accept,Authorization:'Bearer '+auth.token}});
    let r=await once();if(r.status===401&&await auth.refresh())r=await once();return r;
  };
  const items:any[]=[];
  for(const key of ['orderId','parentId']){
    const r=await get('File?'+new URLSearchParams({[key]:stableId}).toString());
    if(!r.ok)continue;
    const ct=String(r.headers.get('content-type')||'').toLowerCase();
    if(!ct.includes('json'))continue;
    const data=await r.json().catch(()=>null);for(const item of arrayFrom(data))items.push(item);
  }
  const ranked=items.map(item=>({item,score:minubaPdfScore(item,offerRef,stableId)})).filter(x=>x.score>=90).sort((a,b)=>b.score-a.score);
  for(const {item} of ranked.slice(0,5)){
    const filename=trim(item?.filename||item?.fileName||item?.name||item?.title,1000)||`Tilbud ${offerRef}.pdf`;
    const embedded=trim(item?.data||item?.content||item?.base64,20_000_000).replace(/^data:application\/pdf;base64,/i,'');
    if(pdfB64Valid(embedded))return{b64:embedded,filename,source:'minuba_file',messageId:'',attachmentId:trim(item?.id,500),minubaOfferId:stableId};
    const direct=trim(item?.downloadUrl||item?.downloadURL||item?.url||item?.href,5000);
    if(/^https:\/\//i.test(direct)){
      const r=await fetch(direct,{headers:{Accept:'application/pdf,*/*',Authorization:'Bearer '+auth.token}});
      if(r.ok){const bytes=new Uint8Array(await r.arrayBuffer()),b64=bytesToB64(bytes);if(pdfB64Valid(b64))return{b64,filename,source:'minuba_file',messageId:'',attachmentId:trim(item?.id,500),minubaOfferId:stableId}}
    }
    const fileId=trim(item?.id,500);
    if(fileId){
      const r=await get('File/Download?'+new URLSearchParams({id:fileId}).toString());
      if(r.ok){
        const bytes=new Uint8Array(await r.arrayBuffer()),b64=bytesToB64(bytes);
        if(pdfB64Valid(b64))return{b64,filename,source:'minuba_file',messageId:'',attachmentId:fileId,minubaOfferId:stableId};
      }
    }
  }
  return null;
}
async function minubaLiveRenderCandidate(admin:any,clientId:string,offer:any,offerRef:string){
  const stableId=minubaOfferId(offer);if(!stableId)return null;
  let auth:any=null;try{auth=await minubaAccessToken(admin,clientId)}catch(e){console.error('[gmail-offer-send] Minuba live render token lookup failed',e)}
  if(!auth?.token)return null;
  const path='Order?'+new URLSearchParams({id:stableId}).toString();
  const once=()=>fetch('https://app.minuba.dk/api/1/'+path,{headers:{Accept:'application/json',Authorization:'Bearer '+auth.token}});
  let r=await once();if(r.status===401&&await auth.refresh())r=await once();
  if(!r.ok){console.error('[gmail-offer-send] Minuba live order fetch failed',{status:r.status,offer_ref:offerRef,minuba_offer_id:stableId});return null}
  const data=await r.json().catch(()=>null);
  const orders=Array.isArray(data)?data:Array.isArray(data?.orders)?data.orders:Array.isArray(data?.Orders)?data.Orders:Array.isArray(data?.data)?data.data:(data?.id?[data]:[]);
  const live=orders.find((x:any)=>String(x?.id||'').toLowerCase()===stableId.toLowerCase())||orders[0];
  if(!live)return null;
  if(refNorm(live?.orderNumber)!==refNorm(offerRef))return null;
  const state=trim(live?.state,100).toUpperCase();
  if(!(live?.proposal===true||live?.quote===true||state.includes('PROPOSAL')))return null;
  if(!trim(live?.proposalText,500000))return null;
  try{
    const bytes=await renderOfferPdf(live,offerRef,trim(offer?.customer_name||live?.client?.name,500));
    const b64=bytesToB64(bytes);
    if(!pdfB64Valid(b64))return null;
    return{b64,filename:`Tilbud ${offerRef}.pdf`,source:'minuba_live_render',messageId:'',attachmentId:'',minubaOfferId:stableId,generated:true};
  }catch(e){
    console.error('[gmail-offer-send] Minuba live PDF render failed',{offer_ref:offerRef,minuba_offer_id:stableId,error:e instanceof Error?e.message:String(e)});
    return null;
  }
}
async function gmailAttachmentB64(accessToken:string,messageId:string,part:any){
  if(part?.body?.data)return fromB64Url(part.body.data);
  const aid=trim(part?.body?.attachmentId,1000);if(!aid)return'';
  const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(aid)}`,{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'}});
  if(!r.ok)return'';const d=await r.json().catch(()=>({}));return d?.data?fromB64Url(d.data):'';
}
async function gmailPdfCandidate(admin:any,clientId:string,offer:any,offerRef:string,accessToken:string){
  const expected=`Tilbud ${offerRef}.pdf`,target=refNorm(offerRef),ids:string[]=[];
  const add=(id:any)=>{const v=trim(id,1000);if(v&&!ids.includes(v))ids.push(v)};
  add(offer?.pdf_source_message_id);
  const {data:linked}=await admin.from('crm_mail_messages').select('external_message_id').eq('client_id',clientId).eq('offer_id',offer.id).eq('provider','gmail').order('message_at',{ascending:false}).limit(20);
  for(const row of linked||[])add(row.external_message_id);
  const queries=[`filename:"${expected.replaceAll('\\','').replaceAll('"','')}"`,`"${offerRef.replaceAll('"','')}" has:attachment`];
  for(const q of queries){
    const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q='+encodeURIComponent(q),{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'}});
    if(!r.ok)continue;const d=await r.json().catch(()=>({}));for(const m of d.messages||[])add(m.id);
  }
  const linkedIds=new Set((linked||[]).map((x:any)=>String(x.external_message_id||''))),candidates:any[]=[];
  for(const mid of ids.slice(0,140)){
    const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(mid)}?format=full`,{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'}});
    if(!r.ok)continue;const msg=await r.json().catch(()=>({})),subject=headerValue(msg.payload,'Subject'),from=headerValue(msg.payload,'From'),evidence=refNorm(subject+' '+String(msg.snippet||''));
    for(const {part,filename} of collectPdfParts(msg.payload)){
      const nf=refNorm(filename);let score=0;
      if(nf===refNorm(expected))score+=120;
      else if(target&&nf.includes(target))score+=80;
      if(/tilbud|offer|quote|quotation|proposal/i.test(filename))score+=15;
      if(target&&evidence.includes(target))score+=40;
      if(/@minuba\.dk/i.test(from)||/minuba/i.test(from))score+=20;
      if(linkedIds.has(mid))score+=100;
      if(String(offer?.pdf_source_message_id||'')===mid)score+=150;
      const numbered=filename.match(/(?:tilbud|offer|quote|quotation|proposal)[ _-]*(\d{3,8})/i);
      if(numbered&&refNorm(numbered[1])!==target)score-=180;
      if(score<80)continue;
      const b64=await gmailAttachmentB64(accessToken,mid,part);if(!pdfB64Valid(b64))continue;
      candidates.push({b64,filename,source:String(offer?.pdf_source_message_id||'')===mid?'gmail_cache':linkedIds.has(mid)?'gmail_linked':'gmail_search',messageId:mid,attachmentId:trim(part?.body?.attachmentId,1000),score,date:Number(msg.internalDate||0)});
    }
  }
  candidates.sort((a,b)=>b.score-a.score||b.date-a.date);
  return candidates[0]||null;
}
async function resolveOfferPdf(admin:any,clientId:string,offer:any,offerRef:string,gmailToken:string){
  const stableId=minubaOfferId(offer);
  let found=await minubaPdfCandidate(admin,clientId,offer,offerRef);
  if(!found)found=await gmailPdfCandidate(admin,clientId,offer,offerRef,gmailToken);
  if(!found)found=await minubaLiveRenderCandidate(admin,clientId,offer,offerRef);
  if(found){
    const now=new Date().toISOString();
    await admin.from('crm_offers').update({
      minuba_offer_id:found.minubaOfferId||stableId||null,
      pdf_source_message_id:found.messageId||null,
      pdf_source_attachment_id:found.attachmentId||null,
      pdf_source_filename:found.filename,
      pdf_source_kind:found.source,
      pdf_verified_at:now,
      pdf_last_error:null,
      updated_at:now
    }).eq('id',offer.id).eq('client_id',clientId);
    return found;
  }
  const diagnostic=`Ingen verificeret PDF-kilde fundet for tilbud ${offerRef}`;
  await admin.from('crm_offers').update({minuba_offer_id:stableId||null,pdf_last_error:diagnostic,updated_at:new Date().toISOString()}).eq('id',offer.id).eq('client_id',clientId);
  console.error('[gmail-offer-send] OFFER_PDF_NOT_FOUND',{client_id:clientId,offer_id:offer.id,offer_ref:offerRef,minuba_offer_id:stableId||null});
  return null;
}

async function refreshAccessToken(mat:any){
  const googleClientId=trim(mat?.client_id,300),googleClientSecret=trim(mat?.client_secret,500),refreshToken=trim(mat?.refresh_token,2000);
  if(!googleClientId||!googleClientSecret||!refreshToken)throw Object.assign(new Error('Gmail direkte afsendelse er ikke færdigforbundet'),{code:'GMAIL_NOT_CONNECTED',status:412});
  const tokenResp=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:googleClientId,client_secret:googleClientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})
  });
  const tokenData=await tokenResp.json().catch(()=>({}));
  if(!tokenResp.ok||!tokenData.access_token){
    const msg=String(tokenData?.error_description||tokenData?.error||'Google kunne ikke forny Gmail-adgangen');
    throw Object.assign(new Error(msg),{code:'GMAIL_TOKEN_ERROR',status:502});
  }
  return String(tokenData.access_token);
}

async function kickPostprocess(supabaseUrl:string,serviceKey:string,jobId:string){
  const p=fetch(`${supabaseUrl}/functions/v1/gmail-send-postprocess`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+serviceKey},
    body:JSON.stringify({job_id:jobId})
  }).then(async r=>{if(!r.ok)console.error('[gmail-offer-send] postprocess kick failed',r.status,await r.text().catch(()=>''))})
    .catch(e=>console.error('[gmail-offer-send] postprocess kick error',e));
  const edgeRuntime=(globalThis as any).EdgeRuntime;
  if(edgeRuntime?.waitUntil)edgeRuntime.waitUntil(p);else void p;
}

async function recoverProviderState(admin:any,job:any,mat:any,supabaseUrl:string,serviceKey:string){
  if(!job?.message_rfc822_id)return {state:'unknown',reason:'missing_message_id'};
  let accessToken='';
  try{accessToken=await refreshAccessToken(mat)}catch(e){return {state:'unknown',reason:'token_error',error:e instanceof Error?e.message:String(e)}}
  const q=new URLSearchParams({q:`rfc822msgid:${job.message_rfc822_id}`,maxResults:'1'});
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+q.toString(),{headers:{Authorization:'Bearer '+accessToken}});
  const data=await r.json().catch(()=>({}));
  if(r.status===403)return {state:'unknown',reason:'gmail_search_scope'};
  if(!r.ok)return {state:'unknown',reason:'gmail_search_error',error:String(data?.error?.message||r.status)};
  const found=Array.isArray(data?.messages)&&data.messages[0];
  if(found?.id){
    const now=new Date().toISOString();
    const {data:updated,error}=await admin.from('crm_mail_send_jobs').update({
      status:'sent_pending_postprocess',
      gmail_message_id:String(found.id),
      gmail_thread_id:String(found.threadId||found.id),
      sent_at:job.sent_at||now,
      updated_at:now,
      last_status_check_at:now,
      error_code:null,
      error_message:null
    }).eq('id',job.id).select('*').single();
    if(error)throw error;
    await kickPostprocess(supabaseUrl,serviceKey,job.id);
    return {state:'sent',job:updated,recovered:true};
  }
  return {state:'not_found'};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);

  const supabaseUrl=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return json({error:'Mangler login-token'},401);
    const {data:userData,error:userError}=await admin.auth.getUser(token),user=userData?.user;
    if(userError||!user?.id||!user?.email)return json({error:'Ugyldigt login'},401);

    const body=await req.json().catch(()=>({}));
    const action=trim(body.action,30)||'send';
    const clientId=trim(body.client_id,80);
    let requestId=trim(body.request_id,80);
    if(action==='send'&&!requestId)requestId=crypto.randomUUID();
    if(!clientId)return json({error:'Mangler klient-id',code:'CLIENT_ID_MISSING'},400);
    if(['send','status'].includes(action)&&(!requestId||!uuidOk(requestId)))return json({error:'Mangler gyldigt send-id',code:'SEND_ID_INVALID'},400);
    if(!['send','status','pdf_status','preflight'].includes(action))return json({error:'Ukendt handling',code:'ACTION_INVALID'},400);

    const {data:membership,error:memberError}=await admin.from('crm_users')
      .select('email,client_id,role,auth_user_id')
      .eq('client_id',clientId).eq('auth_user_id',user.id).eq('active',true).maybeSingle();
    if(memberError)throw memberError;
    if(!membership)return json({error:'Ingen adgang til denne klient'},403);

    let existing:any=null;
    if(['send','status'].includes(action)){
      const existingR=await admin.from('crm_mail_send_jobs').select('*').eq('client_id',clientId).eq('send_id',requestId).maybeSingle();
      if(existingR.error)throw existingR.error;existing=existingR.data;
    }

    if(existing){
      if(['sent','sent_pending_postprocess','postprocessing'].includes(existing.status)){
        if(existing.status!=='sent')await kickPostprocess(supabaseUrl,serviceKey,existing.id);
        return json({
          ok:true,sent:true,status:existing.status,send_id:requestId,job_id:existing.id,
          id:existing.gmail_message_id,thread_id:existing.gmail_thread_id,reused:true,
          attachment:existing.attachment_filename?{filename:existing.attachment_filename,source:existing.attachment_source}:null
        });
      }
      if(existing.status==='failed'){
        return json({error:existing.error_message||'Det tidligere sendeforsøg fejlede',code:existing.error_code||'SEND_FAILED',status:'failed',send_id:requestId},409);
      }

      const ageMs=Date.now()-new Date(existing.updated_at||existing.created_at).getTime();
      if(ageMs>=12000){
        const {data:mat}=await admin.rpc('get_gmail_oauth_material',{p_client_id:clientId});
        const recovered=await recoverProviderState(admin,existing,mat,supabaseUrl,serviceKey);
        if(recovered.state==='sent'){
          return json({
            ok:true,sent:true,status:'sent_pending_postprocess',send_id:requestId,job_id:existing.id,
            id:recovered.job?.gmail_message_id,thread_id:recovered.job?.gmail_thread_id,recovered:true,
            attachment:existing.attachment_filename?{filename:existing.attachment_filename,source:existing.attachment_source}:null
          });
        }
        if(recovered.state==='not_found'&&ageMs>=120000){
          const now=new Date().toISOString();
          await admin.from('crm_mail_send_jobs').update({
            status:'failed',error_code:'SEND_INTERRUPTED_NOT_FOUND',
            error_message:'Afsendelsen blev afbrudt, og Gmail kunne ikke finde mailen efter 2 minutter.',
            updated_at:now,last_status_check_at:now
          }).eq('id',existing.id);
          if(existing.approval_id){
            const {data:oldApproval}=await admin.from('crm_approvals').select('payload').eq('id',existing.approval_id).maybeSingle();
            await admin.from('crm_approvals').update({
              status:'rejected',payload:{...(oldApproval?.payload||{}),send_error:'Afsendelsen blev afbrudt før Gmail kunne bekræfte mailen.'}
            }).eq('id',existing.approval_id);
          }
          return json({error:'Afsendelsen blev afbrudt før Gmail kunne bekræfte mailen. Du kan prøve igen.',code:'SEND_INTERRUPTED_NOT_FOUND',status:'failed',send_id:requestId},409);
        }
      }
      return json({ok:false,sent:false,status:existing.status||'sending',send_id:requestId,job_id:existing.id,code:'SEND_IN_PROGRESS'},202);
    }

    if(action==='status')return json({error:'Sendeforsøget blev ikke fundet',code:'SEND_JOB_NOT_FOUND'},404);

    const offerId=trim(body.offer_id,80),leadId=trim(body.lead_id,80),to=trim(body.to,320).toLowerCase(),subject=trim(body.subject,700),mailBody=trim(body.body,12000);
    let followUpDate=trim(body.follow_up_date,10),followUpAt=trim(body.follow_up_at,60);
    if(!offerId)return json({error:'Mangler gyldigt tilbud',code:'OFFER_ID_MISSING'},400);
    if(action==='send'){
      if(!followUpDate){const d=new Date();d.setUTCDate(d.getUTCDate()+7);followUpDate=ymd(d)}
      if(!dateOk(followUpDate))return json({error:'Opfølgningsdatoen er ugyldig',code:'FOLLOWUP_DATE_INVALID'},400);
      if(followUpAt&&Number.isNaN(new Date(followUpAt).getTime()))return json({error:'Opfølgningstidspunktet er ugyldigt',code:'FOLLOWUP_AT_INVALID'},400);
      if(!followUpAt)followUpAt=followUpDate+'T08:00:00.000Z';
      if(!emailOk(to)||!subject||!mailBody)return json({error:'Mangler gyldig modtager, emne eller mailtekst'},400);
    }

    const [clientR,offerR,materialR,limitsR,usageR]=await Promise.all([
      admin.from('crm_clients').select('id,name,settings').eq('id',clientId).single(),
      admin.from('crm_offers').select('id,company_id,lead_id,offer_ref,customer_name,contact_person,contact_details,follow_up_owner,status,follow_up_date,minuba_raw,minuba_offer_id,pdf_source_message_id,pdf_source_attachment_id,pdf_source_filename,pdf_source_kind,pdf_verified_at,pdf_last_error').eq('id',offerId).eq('client_id',clientId).maybeSingle(),
      admin.rpc('get_gmail_oauth_material',{p_client_id:clientId}),
      admin.from('crm_usage_limits').select('*').eq('client_id',clientId).maybeSingle(),
      admin.rpc('crm_usage_snapshot',{p_client_id:clientId})
    ]);
    const {data:client,error:clientError}=clientR as any,{data:offer,error:offerError}=offerR as any,{data:mat,error:matError}=materialR as any,{data:limits}=limitsR as any,{data:usage}=usageR as any;
    if(clientError||!client)return json({error:'Kundeprofil blev ikke fundet'},404);
    if(offerError)throw offerError;if(!offer)return json({error:'Tilbuddet blev ikke fundet'},404);
    if(matError)throw matError;

    const companyId=String(offer.company_id||'');if(!companyId)return json({error:'Tilbuddet er ikke koblet til en kunde',code:'OFFER_NO_COMPANY'},412);
    const effectiveLeadId=String(leadId||offer.lead_id||'')||null;
    const offerRef=trim(offer.offer_ref,160);if(!offerRef)return json({error:'Tilbudsnummer mangler, så den rigtige PDF kan ikke findes',code:'OFFER_REF_MISSING'},412);

    if(action==='send'||action==='preflight'){
      const {data:suppressions,error:suppressionError}=await admin.from('crm_followup_suppressions')
        .select('email,offer_ref,company_name_pattern,reason')
        .eq('client_id',clientId).eq('active',true);
      if(suppressionError)throw suppressionError;
      const customerName=trim(offer.customer_name,500);
      const normalizedTo=to.toLowerCase();
      const suppression=(suppressions||[]).find((s:any)=>{
        const email=trim(s?.email,320).toLowerCase(),ref=trim(s?.offer_ref,160).toLowerCase(),pattern=trim(s?.company_name_pattern,500).toLowerCase();
        return (email&&email===normalizedTo)
          ||(ref&&ref===offerRef.toLowerCase())
          ||(pattern&&customerName.toLowerCase().includes(pattern));
      });
      if(suppression){
        const reason=trim(suppression.reason,1200)||'Kunden eller modtageren er markeret som “ingen opfølgning”.';
        if(action==='preflight')return json({
          ok:true,
          blocked:true,
          code:'FOLLOWUP_SUPPRESSED',
          reason,
          message:'MAIL BLOKERET – INGEN OPFØLGNING'
        });
        return json({
          error:'Opfølgning er blokeret: '+reason,
          code:'FOLLOWUP_SUPPRESSED',
          status:'blocked',
          reason
        },409);
      }
      if(action==='preflight')return json({ok:true,blocked:false});
    }

    if(action==='send'&&limits&&limits.allow_mail_send===false)return json({error:'Mailafsendelse er ikke inkluderet i denne pakke',code:'PLAN_MAIL_DISABLED'},403);
    const dailyLimit=Number(limits?.daily_mail_send_limit||100),sentToday=Number(usage?.mail_sends_today||0);
    if(action==='send'&&sentToday>=dailyLimit)return json({error:'Dagens fair-use grænse for mails er nået',code:'MAIL_DAILY_LIMIT',limit:dailyLimit},429);

    const from=String(client.settings?.mail||mat?.account||'').trim().toLowerCase(),connectedAccount=String(mat?.account||'').trim().toLowerCase(),fromName=senderName(client);
    if(action==='send'&&!emailOk(from))return json({error:'Afsendermail mangler i kundeprofilen',code:'FROM_NOT_CONFIGURED'},412);
    if(action==='send'&&(!connectedAccount||connectedAccount!==from))return json({error:`Den forbundne Gmail-konto (${connectedAccount||'ingen'}) matcher ikke kundens afsendermail (${from})`,code:'FROM_ACCOUNT_MISMATCH'},412);

    let accessToken='';
    try{accessToken=await refreshAccessToken(mat)}
    catch(e:any){
      const msg=e instanceof Error?e.message:String(e);
      await admin.from('crm_integrations').update({last_error:msg,updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider','gmail');
      return json({error:msg,code:String(e?.code||'GMAIL_TOKEN_ERROR')},Number(e?.status||502));
    }

    const expectedPdfName=`Tilbud ${offerRef}.pdf`;
    const resolvedPdf=await resolveOfferPdf(admin,clientId,offer,offerRef,accessToken);
    if(action==='pdf_status'){
      if(!resolvedPdf)return json({ok:true,ready:false,code:'OFFER_PDF_NOT_FOUND',offer_ref:offerRef,minuba_offer_id:minubaOfferId(offer)||null,message:`Tilbud ${offerRef} blev fundet, men Lead Manager kunne hverken hente eller generere en verificeret tilbuds-PDF.`});
      return json({ok:true,ready:true,offer_ref:offerRef,minuba_offer_id:resolvedPdf.minubaOfferId||minubaOfferId(offer)||null,attachment:{filename:resolvedPdf.filename,source:resolvedPdf.source},verified:true,generated:resolvedPdf.generated===true});
    }
    if(!resolvedPdf)return json({error:`Tilbud ${offerRef} blev fundet, men en verificeret tilbuds-PDF kunne hverken hentes eller genereres fra Minuba/mailkilden. Mailen er ikke sendt.`,code:'OFFER_PDF_NOT_FOUND',offer_ref:offerRef,minuba_offer_id:minubaOfferId(offer)||null,expected_filename:expectedPdfName},412);
    const attachmentB64=resolvedPdf.b64,sourceMessageId=resolvedPdf.messageId||'',pdfName=resolvedPdf.filename||expectedPdfName;
    if(!pdfB64Valid(attachmentB64))return json({error:`PDF-kilden for tilbud ${offerRef} blev fundet, men indholdet er ikke en gyldig PDF. Mailen er ikke sendt.`,code:'OFFER_PDF_INVALID'},412);

    const [{data:contactRows,error:contactFindError},{data:companyRow,error:companyFindError}]=await Promise.all([
      admin.from('crm_contacts').select('id,email,verified').eq('client_id',clientId).eq('company_id',companyId),
      admin.from('crm_companies').select('id,email').eq('id',companyId).eq('client_id',clientId).maybeSingle()
    ]);
    if(contactFindError)throw contactFindError;if(companyFindError)throw companyFindError;
    let contact=(contactRows||[]).find((c:any)=>String(c.email||'').trim().toLowerCase()===to);
    const companyEmail=String(companyRow?.email||'').trim().toLowerCase();
    if(!contact&&companyEmail&&companyEmail===to){
      const now=new Date().toISOString();
      const {data:created,error:createContactError}=await admin.from('crm_contacts').insert({
        client_id:clientId,company_id:companyId,full_name:null,email:to,verified:true,verified_at:now,
        source_type:'company_standard_email',source_url:null,confidence:'high',email_is_inferred:false,
        email_verification_method:'company_record',email_verified_at:now
      }).select('id,email,verified').single();
      if(createContactError)throw createContactError;contact=created;
    }
    if(!contact){
      const now=new Date().toISOString();
      const {data:created,error:createContactError}=await admin.from('crm_contacts').insert({
        client_id:clientId,company_id:companyId,full_name:trim(offer.contact_person,180)||null,email:to,
        verified:true,verified_at:now,source_type:'manual_offer_mail',source_url:null,confidence:'high',
        email_is_inferred:false,email_verification_method:'manual_user_confirmed',email_verified_at:now
      }).select('id,email,verified').single();
      if(createContactError)throw createContactError;contact=created;
    }

    let approval:any=null;
    const {data:sameApprovals,error:sameApprovalError}=await admin.from('crm_approvals')
      .select('id,status,payload,created_at')
      .eq('client_id',clientId).eq('action_type','send_email')
      .contains('payload',{send_id:requestId})
      .order('created_at',{ascending:false}).limit(1);
    if(sameApprovalError)throw sameApprovalError;
    approval=sameApprovals?.[0]||null;

    if(approval?.status==='blocked')return json({error:approval.payload?.block_reason||'Mailen blev blokeret',code:'DUPLICATE_BLOCKED'},409);
    if(approval?.status==='rejected')return json({error:approval.payload?.send_error||'Det tidligere sendeforsøg blev afvist',code:'SEND_APPROVAL_REJECTED'},409);

    if(!approval){
      const approvalPayload={
        to,subject,body:mailBody,company_id:companyId,offer_id:offer.id,offer_ref:offerRef,
        customer_name:offer.customer_name||null,include_signature:true,signature_key:'client_default',
        approved_by:user.email,approval_method:'explicit_send_button',follow_up_date:followUpDate,
        follow_up_at:followUpAt,sender_name:fromName,send_id:requestId,
        attachment:{filename:pdfName,source:resolvedPdf.source,source_message_id:sourceMessageId}
      };
      const {data:createdApproval,error:approvalError}=await admin.from('crm_approvals').insert({
        client_id:clientId,lead_id:effectiveLeadId,action_type:'send_email',status:'approved',
        decided_at:new Date().toISOString(),payload:approvalPayload,ai_generated:false,ai_model:null
      }).select('id,status,payload').single();
      if(approvalError)throw approvalError;
      approval=createdApproval;
      if(approval?.status==='blocked')return json({error:approval.payload?.block_reason||'Mailen blev blokeret som mulig dobbeltkontakt',code:'DUPLICATE_BLOCKED'},409);
    }

    const sigText=String(client.settings?.mail_signature_text||'').trim(),sigHtml=String(client.settings?.mail_signature_html||'').trim();
    const messageRfc822Id=`<lm-${requestId}@lead-manager.invalid>`;

    const {data:job,error:jobError}=await admin.from('crm_mail_send_jobs').insert({
      client_id:clientId,send_id:requestId,user_id:user.id,user_email:user.email,company_id:companyId,
      lead_id:effectiveLeadId,offer_id:offer.id,contact_id:contact.id,approval_id:approval.id,
      to_email:to,subject,body_text:mailBody,follow_up_date:followUpDate,follow_up_at:followUpAt,
      from_email:from,sender_name:fromName,ai_generated:false,ai_model:null,
      signature_appended:!!(sigText||sigHtml),message_rfc822_id:messageRfc822Id,status:'sending',attempt_count:1,
      attachment_filename:pdfName,attachment_source:resolvedPdf.source,source_message_id:sourceMessageId
    }).select('*').single();
    if(jobError){
      if(String(jobError.code||'')==='23505'){
        const {data:raceJob,error:raceError}=await admin.from('crm_mail_send_jobs').select('*').eq('client_id',clientId).eq('send_id',requestId).single();
        if(raceError)throw raceError;
        return json({ok:false,sent:false,status:raceJob.status,send_id:requestId,job_id:raceJob.id,code:'SEND_IN_PROGRESS'},202);
      }
      throw jobError;
    }

    const plain=mailBody+(sigText?'\n\n'+sigText:'');
    const htmlBody='<div style="font-family:Arial,sans-serif;font-size:10.5pt;line-height:1.5">'+escHtml(mailBody).replaceAll('\n','<br>')+'</div>'+(sigHtml?sigHtml:'');
    const mixed='lm_mix_'+crypto.randomUUID().replaceAll('-',''),alt='lm_alt_'+crypto.randomUUID().replaceAll('-',''),fromHeader=fromName?`${b64header(fromName)} <${from}>`:from;
    const mime=[
      `Message-ID: ${messageRfc822Id}`,`From: ${fromHeader}`,`To: ${to}`,`Subject: ${b64header(subject)}`,
      'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${mixed}"`,'',
      `--${mixed}`,`Content-Type: multipart/alternative; boundary="${alt}"`,'',
      `--${alt}`,'Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: 8bit','',plain,'',
      `--${alt}`,'Content-Type: text/html; charset="UTF-8"','Content-Transfer-Encoding: 8bit','',htmlBody,'',`--${alt}--`,'',
      `--${mixed}`,`Content-Type: application/pdf; name="${pdfName}"`,'Content-Transfer-Encoding: base64',`Content-Disposition: attachment; filename="${pdfName}"`,'',wrap76(attachmentB64),'',`--${mixed}--`,''
    ].join('\r\n');

    const sendResp=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
      method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
      body:JSON.stringify({raw:b64url(mime)})
    });
    const sent=await sendResp.json().catch(()=>({}));
    if(!sendResp.ok||!sent.id){
      const msg=String(sent?.error?.message||`Gmail send fejlede (${sendResp.status})`);
      const failedAt=new Date().toISOString();
      await Promise.all([
        admin.from('crm_mail_send_jobs').update({status:'failed',error_code:'GMAIL_SEND_ERROR',error_message:msg,updated_at:failedAt}).eq('id',job.id),
        admin.from('crm_approvals').update({status:'rejected',payload:{...(approval?.payload||{}),send_error:msg}}).eq('id',approval.id),
        admin.from('crm_integrations').update({last_error:msg,updated_at:failedAt}).eq('client_id',clientId).eq('provider','gmail')
      ]);
      return json({error:msg,code:'GMAIL_SEND_ERROR'},502);
    }

    const sentAt=new Date().toISOString();
    const {error:markError}=await admin.from('crm_mail_send_jobs').update({
      status:'sent_pending_postprocess',gmail_message_id:String(sent.id),gmail_thread_id:String(sent.threadId||sent.id),
      sent_at:sentAt,updated_at:sentAt,error_code:null,error_message:null
    }).eq('id',job.id);
    if(markError)throw markError;

    await kickPostprocess(supabaseUrl,serviceKey,job.id);

    return json({
      ok:true,sent:true,status:'sent_pending_postprocess',send_id:requestId,job_id:job.id,
      id:String(sent.id),thread_id:String(sent.threadId||sent.id),from,from_name:fromName,to,subject,
      follow_up_date:followUpDate,offer_id:offer.id,lead_id:effectiveLeadId,client_name:client.name,
      provider:'gmail',attachment:{filename:pdfName,source:resolvedPdf.source}
    });
  }catch(err:any){
    console.error(err);
    const message=trim(
      err instanceof Error?err.message:(err?.message||err?.error_description||err?.details||err?.hint||String(err||'')),
      2000
    )||'Ukendt fejl';
    const code=trim(err?.code,120)||'OFFER_MAIL_SEND_INTERNAL_ERROR';
    return json({error:message,code},500);
  }
});
