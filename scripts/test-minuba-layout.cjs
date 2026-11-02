const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const pdfLib=require(process.env.PDF_LIB_PATH||'pdf-lib');
const dir='supabase/functions/_shared/';
const assets=fs.readFileSync(dir+'minuba-brand-assets.ts','utf8').replace('export const','const');
const layout=fs.readFileSync(dir+'minuba-offer-layout.ts','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
const api=new Function(...Object.keys(pdfLib),stripTypeScriptTypes(assets+'\n'+layout,{mode:'transform'})+';return {renderMinubaOfferPdf,proposalBlocks};')(...Object.values(pdfLib));
(async()=>{
  const base={orderNumber:42,name:'Prøve',price:0,expiration:'31-12-2026',updated:'2026-11-02',contactAddress:{name:'Kunde',streetAddress:'Vej 1',city:'By',postCode:'1234'},client:{clientNumber:'1'},proposalText:'<p>{{order.name}}</p><p>{{order.proposalPriceLegacy}}</p><div style="page-break-after: always"><span style="display: none">&nbsp;</span></div><p><strong>Vilkår</strong></p>',vatPercentage:25};
  const bytes=await api.renderMinubaOfferPdf(base,'42','Kunde','');const pdf=await pdfLib.PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),2);
  assert.throws(()=>api.proposalBlocks({...base,price:null},''),/pris mangler/);
  assert.throws(()=>api.proposalBlocks({...base,proposalText:'<p>{{unknown.field}}</p>'},''),/Manglende Minuba-felt/);
  assert.throws(()=>api.proposalBlocks({...base,proposalText:'<p>{{user.name}}</p>'},''),/Manglende Minuba-felt/);
  await assert.rejects(()=>api.renderMinubaOfferPdf(base,'43','Kunde',''),/matcher ikke/);
  const long={...base,proposalText:'<p>'+('Lang tekst '.repeat(8000))+'</p>'};const longPdf=await pdfLib.PDFDocument.load(await api.renderMinubaOfferPdf(long,'42','Kunde',''));assert(longPdf.getPageCount()>5);
  if(process.env.MINUBA_FIXTURES){
    fs.mkdirSync('../tmp/minuba-reference/generated',{recursive:true});
    for(const f of JSON.parse(fs.readFileSync(process.env.MINUBA_FIXTURES,'utf8'))){const raw={...f.minuba_raw,vatPercentage:25};const out=await api.renderMinubaOfferPdf(raw,f.offer_ref,raw.client.name,'Thomas Hansen');fs.writeFileSync('../tmp/minuba-reference/generated/'+f.offer_ref+'.pdf',out);console.log('Rendered',f.offer_ref,(await pdfLib.PDFDocument.load(out)).getPageCount(),'pages');}
  }
  console.log('PASS: zero price, unknown fields/signers blocked, identity, explicit/automatic pagination and large paragraphs');
})().catch(e=>{console.error(e);process.exitCode=1;});
