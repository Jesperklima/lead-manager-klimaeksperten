/* Calendar dates stay date-only; the user's computer timezone must not shift them. */
(function(root){
  'use strict';
  const zone='Europe/Copenhagen';
  function validDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return false;
    const d=new Date(value+'T12:00:00Z');
    return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
  }
  function today(now=new Date()){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const part=type=>parts.find(p=>p.type===type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function addDays(value,days){
    if(!validDate(value)||!Number.isInteger(days))return '';
    const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);
    return d.toISOString().slice(0,10);
  }
  function format(value){
    if(!validDate(value))return '';
    return new Intl.DateTimeFormat('da-DK',{timeZone:zone,day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00Z'));
  }
  const sentence=value=>`Såfremt vi ikke hører fra dig inden da, følger vi op igen omkring den ${format(value)}.`;
  // Only our managed sentence is replaced. All other text remains byte-for-byte intact.
  function upsert(body,value){
    let text=String(body||'');
    const pattern=/Såfremt vi ikke hører fra dig inden da, følger vi op igen omkring den (?:\d{1,2}\.\s+[\p{L}]+\s+\d{4}|\{\{[^}\r\n]+\}\})\./gu;
    const matches=[...text.matchAll(pattern)];
    const next=validDate(value)?sentence(value):'';
    if(matches.length){
      for(let i=matches.length-1;i>=0;i--){const m=matches[i];text=text.slice(0,m.index)+(i===0?next:'')+text.slice(m.index+m[0].length)}
      return text;
    }
    if(!next||!text.trim())return text;
    const newline=text.includes('\r\n')?'\r\n':'\n';
    const closing=/^(?:[ \t]*(?:(?:med[ \t]+)?venlig(?:e)?[ \t]+hils(?:en|ner)|mvh\.?|de bedste hilsner|(?:jeg[ \t]+)?ser frem til at høre)[^\r\n]*)/im.exec(text);
    if(closing)return text.slice(0,closing.index)+next+newline+newline+text.slice(closing.index);
    return text+(text.endsWith(newline+newline)?'':text.endsWith(newline)?newline:newline+newline)+next;
  }
  const api={validDate,today,addDays,format,sentence,upsert};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(!root?.document)return;
  root.LMFollowupDate=api;
  const byId=id=>root.document.getElementById(id);
  api.sync=function(){
    const body=byId('offerMailBody'),date=byId('offerMailFollow');
    if(!body||!date)return;
    const next=upsert(body.value,date.value);
    if(next!==body.value){
      const start=body.selectionStart,end=body.selectionEnd,scroll=body.scrollTop;
      body.value=next;
      if(root.document.activeElement===body&&typeof body.setSelectionRange==='function')body.setSelectionRange(start,end);
      body.scrollTop=scroll;
    }
  };
  api.snapshot=function(){
    const follow=String(byId('offerMailFollow')?.value||'').trim();
    if(!validDate(follow)){
      if(typeof root.toast==='function')root.toast('Vælg en gyldig dato for næste opfølgning');
      byId('offerMailFollow')?.focus();return null;
    }
    api.sync();
    return {follow,body:String(byId('offerMailBody')?.value||'').trim()};
  };
  for(const event of ['input','change'])root.document.addEventListener(event,e=>{
    if(e.target?.id==='offerMailFollow')api.sync();
  });
  root.addEventListener('lm:offer-mail-opened',api.sync);
  root.addEventListener('lm:offer-mail-template-applied',api.sync);
})(typeof window==='object'?window:null);
