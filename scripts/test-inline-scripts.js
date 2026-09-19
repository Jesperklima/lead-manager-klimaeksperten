const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m=>!(/\bsrc\s*=/.test(m[1]||'')))
  .map((m,i)=>({index:i+1,attrs:m[1]||'',code:m[2]||''}))
  .filter(x=>!(/type\s*=\s*["'](?:application\/json|importmap)["']/i.test(x.attrs)));

let checked=0;
for(const s of scripts){
  const code=s.code.trim();
  if(!code)continue;
  try{new Function(code);checked++}
  catch(e){throw new Error('inline script #'+s.index+' failed syntax check: '+e.message)}
}
if(!checked)throw new Error('no inline scripts were checked');
console.log('PASS: '+checked+' inline browser scripts compile');
