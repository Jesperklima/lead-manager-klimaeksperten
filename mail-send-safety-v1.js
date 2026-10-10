/* Stable send IDs survive ambiguous responses and reloads; this layer never sends on its own. */
(()=>{
 const previousFetch=window.fetch.bind(window);
 const memory=new Map();
 function read(key){try{return JSON.parse(sessionStorage.getItem(key)||'null')||memory.get(key)}catch{return memory.get(key)}}
 function save(key,value){memory.set(key,value);try{sessionStorage.setItem(key,JSON.stringify(value))}catch{}}
 function purpose(value){
  if(['direct_marketing','Salgs-/kampagnemail','Første kontakt','Automatisk',''].includes(String(value||'')))return 'direct_marketing';
  if(['offer_followup','Tilbudsopfølgning'].includes(value))return 'offer_followup';
  if(['operational_relationship','reply','Opfølgning','Efter telefonsamtale','Svar på seneste mail','Send information','Book møde'].includes(value))return 'operational_relationship';
  return 'direct_marketing';
 }
 window.fetch=async function(input,init){
  const url=typeof input==='string'?input:input?.url||'';
  if(!/\/functions\/v1\/(gmail-direct-send|gmail-offer-send|microsoft-direct-send)(?:\?|$)/.test(url)||!init?.body)return previousFetch(input,init);
  let body;try{body=JSON.parse(init.body)}catch{return previousFetch(input,init)}
  if(body.action&&body.action!=='send')return previousFetch(input,init);
  const bytes=new TextEncoder().encode(JSON.stringify([body.client_id,body.lead_id,body.offer_id,body.to,body.subject,body.body]));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const key='lm-send:'+hash;
  let state=read(key);
  if(!state)state={id:body.request_id||crypto.randomUUID(),status:'prepared'};
  const uncertain=['prepared','sending','unknown'].includes(state.status);
  body.request_id=uncertain?state.id:(body.request_id||state.id);
  body.purpose=purpose(body.purpose||(body.offer_id?'offer_followup':document.getElementById('mPurpose')?.value)||'');
  save(key,{...state,id:body.request_id,status:'sending'});
  let response;
  try{response=await previousFetch(input,{...init,body:JSON.stringify(body)})}
  catch(error){save(key,{id:body.request_id,status:'unknown'});throw error}
  const data=await response.clone().json().catch(()=>({}));
  save(key,{id:body.request_id,status:data.status||(response.ok?'accepted':'rejected')});
  if(response.status===202&&data.sent!==true&&data.provider_accepted!==true){
   return new Response(JSON.stringify({...data,error:'Afsendelsen er ikke bekræftet endnu. Kontrollér status eller Sendt-mappen. Samme mail bliver ikke sendt igen.'}),{status:409,headers:response.headers});
  }
  return response;
 };
 window.LMMailSendSafety={purpose};
})();
