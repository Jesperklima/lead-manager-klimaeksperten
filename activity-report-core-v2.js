(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LMActivityReportCoreV2=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const txt=v=>String(v==null?'':v).trim();
  const fold=v=>txt(v).toLocaleLowerCase('da-DK');
  const xml=v=>txt(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[m]));
  const csv=v=>{const s=String(v==null?'':v).replace(/\r?\n/g,' ');return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};

  function categoryFor(row){
    if(row&&row.category)return row.category;
    const hay=fold([row?.type,row?.detail,row?.source,row?.status].filter(Boolean).join(' '));
    if(/mail|e-mail|gmail|message/.test(hay))return 'Mails';
    if(/planlæg|opfølg|follow.?up|scheduled|kalender|calendar|task|aftale/.test(hay))return 'Planlægning';
    if(/pipeline|statusænd|status ænd|flyttet|drag.?drop|→/.test(hay))return 'Pipeline';
    if(/tilbud|offer|proposal|quote/.test(hay))return 'Tilbud';
    if(/lead|kundeemne/.test(hay))return 'Leads';
    if(/system|sync|integration|cron|login|sikkerhed|security|api|fejl|error|webhook/.test(hay))return 'System';
    return 'Øvrige';
  }

  function same(value,filter){
    if(filter==null||filter===''||filter==='all')return true;
    return fold(value)===fold(filter);
  }

  function filterRows(rows,filters={}){
    const q=fold(filters.query);
    return (rows||[]).filter(r=>{
      if(!same(r.category,filters.category))return false;
      if(!same(r.source,filters.source))return false;
      if(!same(r.company,filters.company))return false;
      if(!same(r.actor,filters.actor))return false;
      if(!same(r.type,filters.type))return false;
      if(!same(r.mailDirection,filters.mailDirection))return false;
      if(!same(r.offerStatus,filters.offerStatus))return false;
      if(!same(r.leadStatus,filters.leadStatus))return false;
      if(!same(r.pipelineStatus,filters.pipelineStatus))return false;
      if(q){
        const hay=fold([
          r.date,r.time,r.category,r.type,r.company,r.actor,r.detail,r.status,
          r.mailDirection,r.offerStatus,r.leadStatus,r.pipelineStatus,r.offerRef,r.source
        ].filter(Boolean).join(' '));
        if(!hay.includes(q))return false;
      }
      return true;
    });
  }

  function sortRows(rows,key='at',dir='desc'){
    const d=dir==='asc'?1:-1;
    return [...(rows||[])].sort((a,b)=>{
      const av=a?.[key],bv=b?.[key];
      if(key==='at'){
        const aa=av?new Date(av).getTime():0,bb=bv?new Date(bv).getTime():0;
        if(aa!==bb)return (aa-bb)*d;
      }
      const aa=fold(av),bb=fold(bv);
      return aa.localeCompare(bb,'da',{numeric:true,sensitivity:'base'})*d;
    });
  }

  function toCsv(rows,columns,delimiter=';'){
    const cols=(columns||[]).filter(c=>c&&c.key);
    const lines=[cols.map(c=>csv(c.label||c.key)).join(delimiter)];
    for(const row of rows||[])lines.push(cols.map(c=>csv(row?.[c.key])).join(delimiter));
    return '\uFEFF'+lines.join('\r\n');
  }

  const CRC_TABLE=(()=>{
    const t=new Uint32Array(256);
    for(let n=0;n<256;n++){
      let c=n;
      for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
      t[n]=c>>>0;
    }
    return t;
  })();
  function crc32(bytes){
    let c=0xFFFFFFFF;
    for(const b of bytes)c=CRC_TABLE[(c^b)&0xFF]^(c>>>8);
    return (c^0xFFFFFFFF)>>>0;
  }
  const enc=new TextEncoder();
  const u16=n=>new Uint8Array([n&255,(n>>>8)&255]);
  const u32=n=>new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
  function concat(parts){
    const len=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(len);
    let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out;
  }
  function dosStamp(date){
    const d=date||new Date(),year=Math.max(1980,d.getFullYear());
    const time=((d.getHours()&31)<<11)|((d.getMinutes()&63)<<5)|((Math.floor(d.getSeconds()/2))&31);
    const day=(((year-1980)&127)<<9)|(((d.getMonth()+1)&15)<<5)|(d.getDate()&31);
    return {time,day};
  }
  function zipStore(files){
    const locals=[],centrals=[];let offset=0;
    const stamp=dosStamp(new Date());
    for(const f of files){
      const name=enc.encode(f.name),data=typeof f.data==='string'?enc.encode(f.data):f.data,crc=crc32(data);
      const local=concat([
        u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(stamp.time),u16(stamp.day),
        u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data
      ]);
      locals.push(local);
      centrals.push(concat([
        u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(stamp.time),u16(stamp.day),
        u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),
        u32(0),u32(offset),name
      ]));
      offset+=local.length;
    }
    const central=concat(centrals),body=concat(locals);
    const end=concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(central.length),u32(body.length),u16(0)]);
    return concat([body,central,end]);
  }
  function colName(n){
    let s='';for(let x=n+1;x>0;x=Math.floor((x-1)/26))s=String.fromCharCode(65+((x-1)%26))+s;return s;
  }
  function cell(value,ref,style){
    return '<c r="'+ref+'" t="inlineStr"'+(style!=null?' s="'+style+'"':'')+'><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
  }
  function sheetXml(rows,{freeze=true,filter=false,widths=[]}={}){
    const cols=(rows[0]||[]).length;
    const dim=cols?('A1:'+colName(cols-1)+Math.max(1,rows.length)):'A1';
    const colXml=widths.length?'<cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols>':'';
    const data=rows.map((r,ri)=>'<row r="'+(ri+1)+'">'+r.map((v,ci)=>cell(v,colName(ci)+(ri+1),ri===0?1:null)).join('')+'</row>').join('');
    const pane=freeze?'<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>':'<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const af=filter&&cols?'<autoFilter ref="A1:'+colName(cols-1)+Math.max(1,rows.length)+'"/>':'';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="'+dim+'"/>'+pane+colXml+'<sheetData>'+data+'</sheetData>'+af+'</worksheet>';
  }

  function buildXlsx(rows,columns,overview={}){
    const cols=(columns||[]).filter(c=>c&&c.key);
    const activityRows=[cols.map(c=>c.label||c.key),...(rows||[]).map(r=>cols.map(c=>r?.[c.key]??''))];
    const overviewRows=[['Felt','Værdi'],...Object.entries(overview||{}).map(([k,v])=>[k,v==null?'':String(v)])];
    const files=[
      {name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'},
      {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Oversigt" sheetId="1" r:id="rId1"/><sheet name="Aktiviteter" sheetId="2" r:id="rId2"/></sheets></workbook>'},
      {name:'xl/_rels/workbook.xml.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
      {name:'xl/styles.xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'},
      {name:'xl/worksheets/sheet1.xml',data:sheetXml(overviewRows,{freeze:true,filter:false,widths:[24,80]})},
      {name:'xl/worksheets/sheet2.xml',data:sheetXml(activityRows,{freeze:true,filter:true,widths:cols.map(c=>Math.min(60,Math.max(12,(c.label||c.key).length+5)))})}
    ];
    return zipStore(files);
  }

  return {categoryFor,filterRows,sortRows,toCsv,buildXlsx};
});
