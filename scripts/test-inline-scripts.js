const fs=require('node:fs');

const html=fs.readFileSync('index.html','utf8');
const scriptRe=/<script([^>]*)>([\s\S]*?)<\/script>/gi;
let match,index=0,checked=0;
while((match=scriptRe.exec(html))){
  const attrs=match[1]||'';
  const code=(match[2]||'').trim();
  const src=/\bsrc\s*=/.test(attrs);
  const type=(attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)||[])[1]||'';
  if(src||!code||type&& !/^(?:text\/javascript|application\/javascript|module)$/i.test(type)){index++;continue}
  try{new Function(code);checked++}
  catch(error){
    const id=(attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)||[])[1]||('inline-'+index);
    throw new Error(`Inline script ${id} has invalid JavaScript: ${error.message}`);
  }
  index++;
}
if(!checked)throw new Error('No inline JavaScript was checked');
console.log(`PASS: ${checked} inline scripts parse as valid JavaScript`);
