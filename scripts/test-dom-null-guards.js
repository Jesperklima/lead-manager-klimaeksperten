const fs=require('fs');
const s=fs.readFileSync('index.html','utf8');
const must=[
  "function setText(id,value)",
  "if(!e){console.warn('Toast element mangler:',t);return}",
  "console.error('Renderfejl i '+name,error)",
  "setText('syncState'",
  "setText('brandClient'"
];
for(const x of must){if(!s.includes(x)){console.error('Mangler DOM-guard:',x);process.exit(1)}}
if(s.includes("function render(){renderMetrics();renderTasks();renderRows();")){console.error('Monolitisk render er stadig aktiv');process.exit(1)}
console.log('DOM null-guards OK');
