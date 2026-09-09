import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const PORT=Number(process.env.PORT||8787);
const PUBLIC_BASE=(process.env.PUBLIC_BASE_URL||`http://localhost:${PORT}`).replace(/\/$/,'');
const MINUBA_API='https://app.minuba.dk/api/1/';
const TOKEN_URL='https://auth.minuba.dk/oauth2/token';
const AUTHORIZE_URL='https://auth.minuba.dk/oauth2/authorize';
const CLIENT_ID=process.env.MINUBA_ASSISTANT_CLIENT_ID||'';
const CLIENT_SECRET=process.env.MINUBA_ASSISTANT_CLIENT_SECRET||'';
const REDIRECT_URI=process.env.MINUBA_ASSISTANT_REDIRECT_URI||`${PUBLIC_BASE}/oauth/callback`;
const SCOPE=process.env.MINUBA_ASSISTANT_SCOPE||'Administrator';

// This service deliberately uses its own token store. It never reads or writes Lead Manager's token tables.
let tokens:{accessToken:string;refreshToken:string;expiresAt:number;scope:string}|null=null;
const states=new Map<string,{createdAt:number}>();

const app=express();
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:false}));

function jsonText(v:unknown){return [{type:'text' as const,text:JSON.stringify(v)}]}
function normal(v:unknown){return String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9æøå]+/g,' ')}
function arr(v:any,keys:string[]){if(Array.isArray(v))return v;for(const k of keys)if(Array.isArray(v?.[k]))return v[k];return []}
function itemUrl(kind:string,id:string){return `${PUBLIC_BASE}/item/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`}

async function refreshToken(){
  if(!tokens?.refreshToken) throw new Error('Minuba Assistant er ikke forbundet endnu.');
  if(!CLIENT_ID||!CLIENT_SECRET) throw new Error('Den separate Minuba Assistant OAuth-client er ikke konfigureret endnu.');
  const r=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','Authorization':'Basic '+Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refreshToken})});
  const raw=await r.text();let j:any={};try{j=JSON.parse(raw)}catch{}
  if(!r.ok||!j.access_token)throw new Error(`Minuba token-fornyelse fejlede (HTTP ${r.status}).`);
  tokens={accessToken:String(j.access_token),refreshToken:String(j.refresh_token||tokens.refreshToken),expiresAt:Date.now()+Number(j.expires_in||3599)*1000,scope:String(j.scope||tokens.scope||SCOPE)};
}
async function access(){if(!tokens)throw new Error('Minuba Assistant er ikke forbundet endnu.');if(tokens.expiresAt<=Date.now()+60000)await refreshToken();return tokens.accessToken}
async function mg(path:string,params:Record<string,string>={}){
  let token=await access();const q=new URLSearchParams(params);const url=MINUBA_API+path+(q.toString()?`?${q}`:'');
  let r=await fetch(url,{headers:{Accept:'application/json',Authorization:`Bearer ${token}`}});
  if(r.status===401){await refreshToken();token=await access();r=await fetch(url,{headers:{Accept:'application/json',Authorization:`Bearer ${token}`}})}
  const raw=await r.text();let j:any={};try{j=JSON.parse(raw)}catch{throw new Error('Minuba returnerede et uventet svar.')}if(!r.ok)throw new Error(`Minuba svarer med HTTP ${r.status}.`);return j;
}

async function loadDataset(){
  const clientsRaw=await mg('Client',{include:'addresses'});const clients=arr(clientsRaw,['clients','Clients','data']);
  const orders:any[]=[];for(const state of ['proposal','new','started','delayed','completed','closed']){const raw=await mg('Order',{state,forAllUsers:'true',include:'client,addresses'});for(const x of arr(raw,['orders','Orders','data']))orders.push({...x,_state:state})}
  return{clients,orders};
}

const server=new McpServer({name:'Minuba Assistant',version:'0.1.0'});
server.registerTool('search',{title:'Søg i Minuba',description:'Use this when you need to find Minuba customers, active offers or orders. Read-only.',inputSchema:{query:z.string().min(1).max(300)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false,idempotentHint:true}},async({query})=>{
  const q=normal(query);const {clients,orders}=await loadDataset();const results:any[]=[];
  for(const c of clients){const hay=normal([c.name,c.cvr,c.email,c.phone,JSON.stringify(c.addresses||[])].join(' '));if(hay.includes(q))results.push({id:`client:${c.id}`,title:`Kunde: ${c.name||c.id}`,url:itemUrl('client',String(c.id))})}
  for(const o of orders){const hay=normal([o.orderNumber,o.number,o.offerNumber,o.offerReference,o.description,o.client?.name,o.clientName,o._state,JSON.stringify(o.addresses||[])].join(' '));if(hay.includes(q)){const type=o._state==='proposal'?'Tilbud':'Ordre';results.push({id:`order:${o.id}`,title:`${type}: ${o.orderNumber||o.number||o.offerNumber||o.id} · ${o.client?.name||o.clientName||''}`.trim(),url:itemUrl('order',String(o.id))})}}
  return{content:jsonText({results:results.slice(0,50)})};
});
server.registerTool('fetch',{title:'Hent Minuba-post',description:'Use this after search when you need the full details for one Minuba customer, active offer or order. Read-only.',inputSchema:{id:z.string().min(1).max(300)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false,idempotentHint:true}},async({id})=>{
  const [kind,rawId]=id.split(':',2);if(!kind||!rawId)throw new Error('Ugyldigt Minuba-id.');const {clients,orders}=await loadDataset();let row:any=null;
  if(kind==='client')row=clients.find((x:any)=>String(x.id)===rawId);if(kind==='order')row=orders.find((x:any)=>String(x.id)===rawId);if(!row)throw new Error('Posten blev ikke fundet i Minuba.');
  const title=kind==='client'?`Kunde: ${row.name||rawId}`:`${row._state==='proposal'?'Tilbud':'Ordre'}: ${row.orderNumber||row.number||row.offerNumber||rawId}`;
  return{content:jsonText({id,title,text:JSON.stringify(row,null,2),url:itemUrl(kind,rawId),metadata:{source:'Minuba',read_only:true,state:row._state||null}})};
});
server.registerTool('connection_status',{title:'Minuba forbindelsesstatus',description:'Use this when you need to verify whether the separate Minuba Assistant connection is active. Read-only.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false,idempotentHint:true}},async()=>({content:jsonText({connected:!!tokens,expires_at:tokens?new Date(tokens.expiresAt).toISOString():null,scope:tokens?.scope||null,lead_manager_tokens_used:false})}));

const transports=new Map<string,StreamableHTTPServerTransport>();
app.all('/mcp',async(req,res)=>{
  const sid=String(req.headers['mcp-session-id']||'');let transport=sid?transports.get(sid):undefined;
  if(!transport){transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),onsessioninitialized:id=>transports.set(id,transport!)});transport.onclose=()=>{for(const [k,v] of transports)if(v===transport)transports.delete(k)};await server.connect(transport)}
  await transport.handleRequest(req,res,req.body);
});

app.get('/connect',(_req,res)=>{
  if(!CLIENT_ID||!CLIENT_SECRET)return res.status(503).send('Den separate Minuba Assistant OAuth-client mangler endnu. Lead Manager er ikke berørt.');
  const state=randomUUID();states.set(state,{createdAt:Date.now()});const u=new URL(AUTHORIZE_URL);u.searchParams.set('client_id',CLIENT_ID);u.searchParams.set('redirect_uri',REDIRECT_URI);u.searchParams.set('scope',SCOPE);u.searchParams.set('state',state);u.searchParams.set('response_type','code');u.searchParams.set('response_mode','form_post');res.redirect(303,u.toString());
});
app.all('/oauth/callback',async(req,res)=>{
  try{const p=req.method==='POST'?req.body:req.query;const state=String(p.state||''),code=String(p.code||'');const st=states.get(state);if(!st||Date.now()-st.createdAt>10*60*1000)return res.status(400).send('Ugyldig eller udløbet OAuth-state.');states.delete(state);if(!code)return res.status(400).send('Minuba returnerede ingen authorization code.');
    const r=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','Authorization':'Basic '+Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:REDIRECT_URI})});const raw=await r.text();let j:any={};try{j=JSON.parse(raw)}catch{}if(!r.ok||!j.access_token)return res.status(502).send(`Minuba token exchange fejlede (HTTP ${r.status}).`);tokens={accessToken:String(j.access_token),refreshToken:String(j.refresh_token||''),expiresAt:Date.now()+Number(j.expires_in||3599)*1000,scope:String(j.scope||SCOPE)};res.send('Minuba Assistant er nu forbundet. Denne forbindelse er separat fra Lead Manager.');
  }catch(e){res.status(500).send(e instanceof Error?e.message:String(e))}
});
app.get('/item/:kind/:id',(req,res)=>res.type('text/plain').send(`Minuba Assistant reference: ${req.params.kind}:${req.params.id}`));
app.get('/health',(_req,res)=>res.json({ok:true,connected:!!tokens,lead_manager_tokens_used:false}));
app.listen(PORT,()=>console.log(`Minuba Assistant listening on ${PORT}`));
