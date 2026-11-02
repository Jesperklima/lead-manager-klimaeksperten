import { PDFDocument, StandardFonts, PDFString } from 'https://esm.sh/pdf-lib@1.17.1?target=deno';
import { minubaBrandAssets } from './minuba-brand-assets.ts';

// Measurements from the supplied Minuba exports. Branding is tenant scoped by the caller.
const W=595.28,H=841.89,L=70.88,R=538.56,S=10.01,LH=11.586,GAP=5.03;
const safe=(v:any)=>String(v??'').replace(/\u00a0/g,' ').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/…/g,'...');
const entities:Record<string,string>={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",aelig:'æ',AElig:'Æ',oslash:'ø',Oslash:'Ø',aring:'å',Aring:'Å',eacute:'é',Eacute:'É',bull:'•',ndash:'-',mdash:'-'};
export function decodeMinubaHtml(v:string){return String(v).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,k)=>entities[k]??(k[0]==='#'?String.fromCodePoint(parseInt(k.slice(/^#x/i.test(k)?2:1),/^#x/i.test(k)?16:10)):all));}
const money=(n:number)=>n.toLocaleString('da-DK',{minimumFractionDigits:2,maximumFractionDigits:2});
const date=(v:any)=>{const s=String(v||'');const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}-${m[2]}-${m[1]}`:s;};
type Run={text:string,bold:boolean,size:number,href?:string,underline?:boolean};
type Block={runs:Run[],list?:boolean,break?:boolean,price?:boolean,modernPrice?:boolean,images?:string[]};

export function proposalBlocks(raw:any,signer:string):Block[]{
  if(!raw?.proposalText||raw.price===null||raw.price===undefined||!Number.isFinite(Number(raw.price)))throw new Error('Tilbudstekst eller pris mangler i Minuba');
  const expiry=date(raw.expirationDate||raw.expiration);
  if(!expiry)throw new Error('Tilbuddets udløbsdato mangler i Minuba');
  const replacements:Record<string,string>={
    'order.name':String(raw.name||''),'proposal.expirationDate':expiry,'user.name':signer,
    'order.proposalPriceLegacy':'<lm-price></lm-price>','order.proposalPrice':'<lm-price modern="true"></lm-price>',
    'order.link':raw.proposalUrl||raw.acceptUrl?`<a href="${String(raw.proposalUrl||raw.acceptUrl).replace(/"/g,'&quot;')}">Klik på link for at acceptere</a>`:'Klik på link for at acceptere'
  };
  let html=String(raw.proposalText).replace(/\{\{\s*([^}]+?)\s*\}\}/g,(_m,k)=>{if(!(k in replacements)||k==='user.name'&&!signer)throw new Error('Manglende Minuba-felt: '+k);return replacements[k];});
  // Skip hidden page-break markers, never their surrounding visible content.
  html=html.replace(/<span\b[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,'');
  const blocks:Block[]=[];let block:Block={runs:[]},bold=0,underline=false,size=S,href='',list=false,inParagraph=false;
  const flush=(empty=false)=>{if(block.runs.length||block.images?.length||empty)blocks.push(block);block={runs:[],list};};
  for(const token of html.match(/<[^>]*>|[^<]+/g)||[]){
    if(!token.startsWith('<')){const text=safe(decodeMinubaHtml(token)).replace(/\s+/g,' ');if(text.trim()||inParagraph)block.runs.push({text,bold:bold>0,size,href,underline});continue;}
    const closing=/^<\//.test(token),tag=(token.match(/^<\/?([\w-]+)/)||[])[1]?.toLowerCase();
    if(!closing&&/page-break-(?:after|before)\s*:\s*always|break-(?:after|before)\s*:\s*page/i.test(token)){flush();blocks.push({runs:[],break:true});continue;}
    if(tag==='lm-price'){if(!closing){flush();blocks.push({runs:[],price:true,modernPrice:/modern=/.test(token)});}continue;}
    if(tag==='p'||/^h[1-6]$/.test(tag||'')){if(closing){flush(true);inParagraph=false;size=S;}else{flush();inParagraph=true;size=tag==='h1'?20:tag==='h3'?12:S;}continue;}
    if(tag==='strong'||tag==='b'){bold=Math.max(0,bold+(closing?-1:1));continue;}
    if(tag==='u'){underline=!closing;continue;}
    if(tag==='span'){const pt=token.match(/font-size\s*:\s*([\d.]+)pt/i);if(pt)size=Number(pt[1]);continue;}
    if(tag==='br'){block.runs.push({text:'\n',bold:bold>0,size});continue;}
    if(tag==='ul'||tag==='ol'){flush();list=!closing;block.list=list;if(!closing)blocks.push({runs:[]});continue;}
    if(tag==='li'){flush();block.list=!closing;continue;}
    if(tag==='a'){href=closing?'':decodeMinubaHtml((token.match(/href=["']([^"']+)/i)||[])[1]||'');continue;}
    if(tag==='img'&&!closing){const src=decodeMinubaHtml((token.match(/src=["']([^"']+)/i)||[])[1]||'');(block.images??=[]).push(src);continue;}
  }
  flush();return blocks;
}

export async function renderMinubaOfferPdf(raw:any,offerRef:string,customerName:string,signer:string){
  if(String(raw.orderNumber)!==String(offerRef))throw new Error('Minuba-tilbudsnummer matcher ikke');
  const blocks=proposalBlocks(raw,signer);
  const pdf=await PDFDocument.create();pdf.setTitle('Tilbud '+offerRef);pdf.setCreator('Lead Manager - Minuba layout');
  const normal=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo=await pdf.embedPng(minubaBrandAssets.logo),signature=await pdf.embedPng(minubaBrandAssets.signature),iso=await pdf.embedPng(minubaBrandAssets.iso);
  const pages:any[]=[];let page:any,y=0;
  const text=(value:any,x:number,baseline:number,font=normal,size=S)=>{const s=safe(value);font.encodeText(s);page.drawText(s,{x,y:H-baseline,font,size});};
  const addPage=()=>{page=pdf.addPage([W,H]);pages.push(page);page.drawImage(logo,{x:273.75,y:734.14,width:61.99,height:65.21});y=130.47;};
  const need=(height:number)=>{if(y+height>765)addPage();};
  const field=(label:string,value:any,baseline:number)=>{text(label,362.81,baseline,normal,9);const s=safe(value);text(s,R-normal.widthOfTextAtSize(s,9),baseline,normal,9);};
  addPage();
  const address=raw.billingAddress||raw.contactAddress;if(!address?.streetAddress||!raw.client?.clientNumber)throw new Error('Kundeoplysninger mangler i Minuba');
  let ay=122.25;
  for(const [i,line] of [address.name||customerName,address.streetAddress,address.streetAddress2,[address.postCode,address.city].filter(Boolean).join('  '),address.EAN||address.ean?`GLN-nummer: ${address.EAN||address.ean}`:''].filter(Boolean).entries()){text(line,L,ay,i===0?bold:normal);ay+=11.63;}
  field('Kundenummer:',raw.client.clientNumber,130.77);
  if(raw.client.cvr)field('Kunde CVR-nr.:',raw.client.cvr,144.04);
  if(raw.theirref)field('Deres ref.:',raw.theirref,144.04);
  if(address.att)text('Att: '+address.att,L,157.05);
  field('Tilbudsnummer:',offerRef,157.32);
  field('Dato:',date(raw.proposalDate||raw.updated||raw.created),170.59);
  const delivery=raw.deliveryAddress;
  if(delivery?.streetAddress){ay=208.69;text('Installationsadresse:',L,ay);ay+=11.89;for(const [i,line] of [delivery.name,delivery.streetAddress,delivery.streetAddress2,[delivery.postCode,delivery.city].filter(Boolean).join('  ')].filter(Boolean).entries()){text(line,L,ay,i===0&&delivery.name?bold:normal);ay+=11.63;}}
  const titleBaseline=delivery?.streetAddress?312.26+(address.att?11.25:0)+(delivery.att?23.51:0):229.53;
  text(raw.state==='DRAFT'?'TILBUD [Kladde]':'TILBUD',L,titleBaseline,bold,16.01);page.drawLine({start:{x:L,y:H-titleBaseline-5.49},end:{x:R,y:H-titleBaseline-5.49},thickness:.6});y=titleBaseline+17.51;
  const drawRuns=(runs:Run[],isList=false)=>{
    const xStart=L+(isList?30:0),max=R-xStart;let line:Run[]=[],width=0;
    const emit=()=>{need(LH);let x=xStart;if(isList&&firstLine)text('•',L+18,y);for(const run of line){const font=run.bold?bold:normal;text(run.text,x,y,font,run.size);const w=font.widthOfTextAtSize(run.text,run.size);if(run.underline)page.drawLine({start:{x,y:H-y-1},end:{x:x+w,y:H-y-1},thickness:.5});if(run.href&&/^https:\/\//i.test(run.href)){const annot=pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,H-y-2,x+w,H-y+run.size],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(run.href)}});page.node.addAnnot(pdf.context.register(annot));}x+=w;}y+=Math.max(LH,...line.map(r=>r.size*1.16));line=[];width=0;firstLine=false;};
    let firstLine=true;
    for(const run of runs){for(let word of run.text.split(/(\s+)/)){if(!word)continue;if(word.includes('\n')){emit();continue;}if(!width)word=word.trimStart();if(!word)continue;const font=run.bold?bold:normal;let w=font.widthOfTextAtSize(word,run.size);if(width+w>max&&width){emit();word=word.trimStart();w=font.widthOfTextAtSize(word,run.size);}if(w>max){for(const char of word){const cw=font.widthOfTextAtSize(char,run.size);if(width+cw>max)emit();line.push({...run,text:char});width+=cw;}}else{line.push({...run,text:word});width+=w;}}}
    if(line.length)emit();
  };
  for(const block of blocks){
    if(block.break){if(y!==130.47)addPage();continue;}
    if(block.price){need(3*LH+GAP);const net=Number(raw.price);const vatRate=raw.vatPercentage??raw.client?.vatPercentage;if(vatRate===null||vatRate===undefined||!Number.isFinite(Number(vatRate)))throw new Error('Momssats mangler');const vat=Math.round(net*Number(vatRate))/100;const rows=block.modernPrice?[['Subtotal',money(net)],[`Moms (${vatRate}%)`,money(vat)],['Total','kr '+money(Math.round((net+vat)*100)/100)]]:[['Pris ekskl. moms:',money(net)],['Moms (%):','kr '+money(vat)],['I alt inkl. moms:','kr '+money(Math.round((net+vat)*100)/100)]];for(const [label,value] of rows){text(label,L,y);text(value,205-normal.widthOfTextAtSize(value,S),y);y+=block.modernPrice?14.1:LH;}y+=GAP;continue;}
    if(block.images?.length){need(72+GAP);let x=L;for(const src of block.images){const image=/Bruun_ISO_9001-1\.png/.test(src)?iso:/googleusercontent\.com\/mail-sig\//.test(src)?signature:null;if(!image)throw new Error('Ukendt tilbudsbillede; original PDF kræves');const w=image===iso?33.75:68.25,h=image===iso?35.25:72;page.drawImage(image,{x,y:H-y-72,width:w,height:h});x+=w+2.81;}y+=72+GAP;}
    const visible=block.runs.some(r=>r.text.trim());
    if(visible){need(block.list?LH:2*LH);drawRuns(block.runs,block.list);y+=block.list?0:GAP;}else if(!block.images?.length)y+=LH+GAP;
  }
  const expiry=date(raw.expirationDate||raw.expiration);need(2*LH);y+=LH;text('Tilbuddet er gældende til: '+expiry,L,y);
  pages.forEach((p,i)=>{page=p;field('Side:',`${i+1} af ${pages.length}`,115.1);page.drawLine({start:{x:L,y:84.5},end:{x:R,y:84.5},thickness:.6});for(const [s,baseline] of [['Klimaeksperten • Rusgårds Bakke, 74 • 4100 Ringsted • Tlf: 93500606',778.88],['Mail: mail@klimaeksperten.dk • Web: www.klimaeksperten.dk',799.39],['CVR-nr.: 38890670',819.91]] as [string,number][]){text(s,(L+R-normal.widthOfTextAtSize(s,9))/2,baseline,normal,9);}});
  return new Uint8Array(await pdf.save());
}
