import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v:unknown)=>typeof v==='string'?v.trim():(v==null?'':String(v).trim());
const uuidLike=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

async function hmacHex(secret:string,message:string){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,enc.encode(message));return Array.from(new Uint8Array(sig)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
async function getSecret(id:string|null){if(!id)return null;const {data,error}=await db.rpc('crm_marketing_service_get_secret',{p_secret_id:id});if(error)throw error;return data as string|null}

Deno.serve(async(req:Request)=>{
  try{
    if(req.method!=='POST')return json({error:'Method not allowed'},405);
    const url=new URL(req.url);
    const bootstrapId=clean(url.searchParams.get('connection_id'));
    if(!uuidLike(bootstrapId))return json({error:'Ugyldigt provisioning connection_id'},400);

    const raw=await req.text();
    let body:any={};
    try{body=raw?JSON.parse(raw):{}}catch{return json({error:'Ugyldig JSON'},400)}

    const {data:conn,error:ce}=await db.from('crm_marketing_connections').select('*').eq('id',bootstrapId).maybeSingle();
    if(ce)throw ce;
    if(!conn||conn.status==='disabled')return json({error:'Provisioning forbindelsen findes ikke eller er deaktiveret'},404);
    if(conn.platform!=='generic'||conn.config?.skarp_workspace_provisioning!==true)return json({error:'Forbindelsen er ikke godkendt til workspace provisioning'},403);

    if(clean(body.partner).toLowerCase()!=='skarp_studio')return json({error:'Ugyldig partner'},403);
    if(clean(body.event)!=='workspace.sync')return json({error:'Kun workspace.sync understøttes'},400);
    const signalId=clean(body.id),headerId=clean(req.headers.get('x-skarp-signal-id'));
    if(!uuidLike(signalId)||signalId!==headerId)return json({error:'Signal-id mangler eller matcher ikke'},400);
    const workspaceId=clean(body.workspace_id);
    if(!uuidLike(workspaceId))return json({error:'Ugyldigt workspace_id'},400);
    const occurredAt=clean(body.occurred_at);
    if(!occurredAt||Number.isNaN(Date.parse(occurredAt)))return json({error:'Ugyldigt occurred_at'},400);

    const ts=Number(clean(req.headers.get('x-skarp-timestamp')));
    if(!Number.isFinite(ts))return json({error:'Ugyldigt timestamp'},400);
    if(Math.abs(Math.floor(Date.now()/1000)-ts)>600)return json({error:'Timestamp er for gammelt'},401);

    const secret=await getSecret(conn.webhook_secret_id||null);
    if(!secret)return json({error:'Provisioning webhook-nøgle mangler'},409);
    const supplied=clean(req.headers.get('x-skarp-signature')).replace(/^sha256=/i,'');
    const expected=await hmacHex(secret,raw);
    if(!supplied||!safeEqual(supplied,expected))return json({error:'Ugyldig Skarp-signatur'},403);

    const data=body?.data&&typeof body.data==='object'?body.data:{};
    const workspaceName=clean(data.workspace_name);
    if(workspaceName.length<2)return json({error:'workspace_name mangler'},400);
    const marketingActive=data.marketing_active!==false;
    const forceRotate=data.force_rotate===true;
    const metadata=data.metadata&&typeof data.metadata==='object'&&!Array.isArray(data.metadata)?data.metadata:{};

    const {data:provisioned,error:pe}=await db.rpc('crm_skarp_provision_workspace',{
      p_bootstrap_client_id:conn.client_id,
      p_workspace_id:workspaceId,
      p_workspace_name:workspaceName,
      p_marketing_active:marketingActive,
      p_force_rotate:forceRotate,
      p_metadata:{...metadata,last_sync_signal_id:signalId,last_sync_occurred_at:occurredAt}
    });
    if(pe)throw pe;

    const connectionId=clean(provisioned?.connection_id);
    const webhookKey=clean(provisioned?.webhook_key);
    if(!uuidLike(connectionId)||!webhookKey)throw new Error('Provisioning returnerede ikke en gyldig workspace forbindelse');

    return json({
      ok:true,
      workspace_id:workspaceId,
      client_id:provisioned.client_id,
      connection_id:connectionId,
      webhook_url:`${SUPABASE_URL}/functions/v1/marketing-webhook?connection_id=${connectionId}`,
      webhook_key:webhookKey,
      marketing_active:marketingActive,
      created_client:provisioned.created_client===true,
      created_connection:provisioned.created_connection===true,
      rotated:provisioned.rotated===true
    });
  }catch(e){
    console.error('skarp-workspace-sync',e instanceof Error?e.message:String(e));
    return json({error:e instanceof Error?e.message:String(e)},500);
  }
});
