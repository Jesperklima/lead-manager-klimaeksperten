const fs=require('node:fs');
const path=require('node:path');

async function render(){
  const handler=require('../api/app.js');
  let statusCode=200,body='',headers={};
  const res={
    setHeader(name,value){headers[String(name).toLowerCase()]=String(value);return this},
    status(code){statusCode=code;return this},
    send(value){body=String(value??'');return this}
  };
  await handler({query:{}},res);
  if(statusCode!==200)throw new Error('api/app returned '+statusCode);
  return {body,headers};
}

function count(haystack,needle){return haystack.split(needle).length-1}

(async()=>{
  const {body,headers}=await render();
  if(!body.includes('/* authInit deferred to access-bootstrap-v1.js */'))throw new Error('legacy auth bootstrap was not deferred');
  if(!body.includes("const OFFER_PIPE_STATUSES=['I GANG','PÅ PAUSE','VUNDET','TABT','LUKKET','STATUS UKLAR'];"))throw new Error('served offer pipeline is missing LUKKET');
  if(!body.includes("document.addEventListener('pointermove'"))throw new Error('served lead pipeline is missing global pointer dragging');
  if(body.includes("card.addEventListener('pointermove'"))throw new Error('served lead pipeline regressed to card-local pointer dragging');

  const moveStart=body.indexOf('async function movePipelineLead(id,targetStatus)');
  const dragStart=body.indexOf('function wirePipelineDrag(){',moveStart);
  if(moveStart<0||dragStart<0)throw new Error('served lead pipeline functions missing');
  const moveBlock=body.slice(moveStart,dragStart);
  if(moveBlock.includes('await loadAll()'))throw new Error('served lead pipeline still reloads all CRM data after a drop');

  const startupStart=body.indexOf('<script id="lm-startup-autorefresh-v8">');
  const startupEnd=body.indexOf('</script>',startupStart);
  if(startupStart<0||startupEnd<0)throw new Error('startup auto-refresh script missing');
  const startup=body.slice(startupStart,startupEnd);
  if(startup.includes('\\n(()=>{'))throw new Error('startup auto-refresh contains literal escaped newlines');

  for(const critical of [
    '/performance-v1.js',
    '/tenant-isolation-v1.js',
    '/saas-onboarding-v5.js',
    '/access-bootstrap-v1.js',
    '/saas-admin-client-switcher-v1.js',
    '/saas-impersonation-v1.js',
    '/saas-settings-hub-v1.js'
  ]){
    if(count(body,critical)!==1)throw new Error(critical+' must be injected exactly once');
  }

  const scriptRe=/<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m,inline=0;
  while((m=scriptRe.exec(body))){
    const attrs=m[1]||'',code=(m[2]||'').trim();
    if(/\bsrc\s*=/.test(attrs)||!code)continue;
    const type=(attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)||[])[1]||'';
    if(type&&!/^(?:text\/javascript|application\/javascript|module)$/i.test(type))continue;
    try{new Function(code);inline++}catch(error){throw new Error('served inline JavaScript invalid: '+error.message)}
  }

  const refs=[...body.matchAll(/<script[^>]+src=["']\/([^"'?]+\.js)(?:\?[^"']*)?["']/gi)].map(x=>x[1]);
  for(const ref of new Set(refs)){
    if(!fs.existsSync(path.join(process.cwd(),ref)))throw new Error('served script file missing: '+ref);
  }
  if(headers['cache-control']!=='no-store, no-cache, must-revalidate, max-age=0')throw new Error('served app cache policy changed');
  console.log(`PASS: served /api/app composition is valid (${inline} inline scripts, ${new Set(refs).size} local script assets)`);
})().catch(error=>{console.error(error);process.exit(1)});
