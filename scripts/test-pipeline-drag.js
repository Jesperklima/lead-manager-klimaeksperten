const fs=require('node:fs');

const html=fs.readFileSync('index.html','utf8');

for(const [marker,message] of [
  ["board.dataset.pipelineDragLead=id","drag state must be kept in memory on the board"],
  ["e.dataTransfer.setData('application/x-pipeline-lead',id)","custom drag payload missing"],
  ["e.dataTransfer.setData('text/plain',id)","text/plain drag fallback missing"],
  ["const col=e.target.closest?.('.pipeline-col[data-pipeline-status]')","drop target must be resolved from the hovered column"],
  ["board.ondrop=async e=>","pipeline must use a delegated board drop handler"],
  ["e.preventDefault();\n    if(e.dataTransfer)e.dataTransfer.dropEffect='move';","board dragover must enable dropping"],
  ["clearDragState();\n    await movePipelineLead(id,targetStatus);","drop must clear UI state and persist the status move"],
]){
  if(!html.includes(marker))throw new Error(message);
}

if(html.includes("if(!e.dataTransfer?.types?.includes('application/x-pipeline-lead'))return"))
  throw new Error('legacy strict custom MIME gate still blocks pipeline dragging');

console.log('PASS: pipeline drag/drop accepts robust in-memory + text fallback and delegated column drops');
