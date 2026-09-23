const assert=require('assert');
const core=require('../activity-report-core-v2.js');

assert.equal(core.categoryFor({type:'Indgående mail'}),'Mails');
assert.equal(core.categoryFor({type:'Planlægning',detail:'Opfølgning i morgen'}),'Planlægning');
assert.equal(core.categoryFor({type:'Tilbudsstatus',detail:'I GANG → VUNDET'}),'Pipeline');
assert.equal(core.categoryFor({type:'Tilbud sendt'}),'Tilbud');
assert.equal(core.categoryFor({type:'Lead ændret'}),'Leads');
assert.equal(core.categoryFor({type:'System sync fejl'}),'System');

const rows=[
  {at:'2026-09-23T09:00:00Z',category:'Mails',source:'mail',company:'Semler',actor:'Jesper',type:'Indgående mail',detail:'Svar på tilbud',mailDirection:'Indgående',offerStatus:'',leadStatus:'',pipelineStatus:''},
  {at:'2026-09-22T09:00:00Z',category:'Tilbud',source:'offer',company:'Acme',actor:'Thomas',type:'Tilbud sendt',detail:'Tilbud 42',mailDirection:'',offerStatus:'I GANG',leadStatus:'',pipelineStatus:''},
  {at:'2026-09-21T09:00:00Z',category:'Leads',source:'lead',company:'Beta',actor:'Jesper',type:'Lead ændret',detail:'Ring fredag',mailDirection:'',offerStatus:'',leadStatus:'DIALOG',pipelineStatus:''}
];

assert.equal(core.filterRows(rows,{category:'Mails'}).length,1);
assert.equal(core.filterRows(rows,{source:'offer'}).length,1);
assert.equal(core.filterRows(rows,{company:'Semler'}).length,1);
assert.equal(core.filterRows(rows,{mailDirection:'Indgående'}).length,1);
assert.equal(core.filterRows(rows,{offerStatus:'I GANG'}).length,1);
assert.equal(core.filterRows(rows,{query:'ring fredag'}).length,1);

assert.equal(core.sortRows(rows,'at','desc')[0].company,'Semler');
assert.equal(core.sortRows(rows,'company','asc')[0].company,'Acme');

const cols=[{key:'company',label:'Virksomhed'},{key:'detail',label:'Detalje'}];
const csv=core.toCsv([{company:'A;B',detail:'Hej "verden"'}],cols);
assert(csv.startsWith('\uFEFFVirksomhed;Detalje'));
assert(csv.includes('"A;B"'));
assert(csv.includes('"Hej ""verden"""'));

const xlsx=core.buildXlsx(rows,cols,{'Periode':'2026-09-01 – 2026-09-30','Antal':rows.length});
const buf=Buffer.from(xlsx);
assert.equal(buf[0],0x50);assert.equal(buf[1],0x4b);
const txt=buf.toString('utf8');
for(const marker of ['[Content_Types].xml','xl/workbook.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','Oversigt','Aktiviteter']){
  assert(txt.includes(marker),marker+' missing from xlsx');
}
console.log('PASS: activity report v2 core filters, sorting, CSV and XLSX');
