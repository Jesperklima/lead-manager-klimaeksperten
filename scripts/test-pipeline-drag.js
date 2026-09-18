const fs=require('node:fs');

const html=fs.readFileSync('index.html','utf8');

for(const [marker,message] of [
  ['draggable="false" data-pipeline-lead=','pipeline cards must use pointer dragging instead of native HTML5 dragging'],
  ["card.addEventListener('pointerdown'","pipeline pointerdown handler missing"],
  ["card.addEventListener('pointermove'","pipeline pointermove handler missing"],
  ["card.addEventListener('pointerup'","pipeline pointerup handler missing"],
  ["document.elementFromPoint(x,y)","drop target must follow the actual pointer location"],
  [".pipeline-col[data-pipeline-status]","pipeline status drop target selector missing"],
  ["card.dataset.pipelineSuppressClick='1'","dragging must suppress the following click-to-open"],
  ["await movePipelineLead(id,col.dataset.pipelineStatus)","pointer drop must persist the target status"],
  [".pipeline-drag-ghost","drag ghost styling missing"],
  ["background:#0a1f2c!important","drawer status select must stay dark in the dark theme"],
  ["color:#eaf4f8!important","drawer status select text must remain readable"]
]){
  if(!html.includes(marker))throw new Error(message);
}

if(html.includes('class="leadcard pipeline-card" draggable="true"'))
  throw new Error('native HTML5 draggable pipeline cards returned');

console.log('PASS: pointer-based pipeline dragging and readable dark quick-status UI');
