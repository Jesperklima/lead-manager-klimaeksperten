const fs=require('node:fs');

const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('function updatePipelineColumnCount(col)');
const end=html.indexOf('\nfunction ensurePipelineEdgeGlow()',start);
if(start<0||end<0)throw new Error('pipeline drag implementation missing');
const drag=html.slice(start,end);

for(const [marker,message] of [
  ["board.dataset.pipelinePointerBound='1'","pipeline board must bind delegated pointer dragging only once"],
  ["document.addEventListener('pointermove'","dragging must continue at document level when pointer leaves the card"],
  ["document.addEventListener('pointerup'","drop must complete at document level"],
  ["document.elementFromPoint(x,y)","drop column must follow the actual pointer position"],
  ["movePipelineCardDom(id,targetStatus)","successful drops must move the existing card without rerendering the board"],
  ["Object.assign(l,patch)","successful drops must update in-memory CRM state"],
  ["updatePipelineColumnCount(source)","source count must update in place"],
  ["updatePipelineColumnCount(target)","target count must update in place"],
  ["await movePipelineLead(id,col.dataset.pipelineStatus)","pointer drop must persist the selected status"]
]){
  if(!drag.includes(marker))throw new Error(message);
}

if(drag.includes('await loadAll()'))throw new Error('pipeline drag must not reload all CRM data after a drop');
if(drag.includes("card.addEventListener('pointermove'"))throw new Error('card-local pointermove returned; drag can fall off the card again');

console.log('PASS: global pointer drag remains attached and successful drops update in place without full CRM rerender');
