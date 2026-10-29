// Server-only Minuba refresh. Never return provider bodies or credentials.
export class MinubaOAuthError extends Error {
  constructor(public code:string,public httpStatus:number,public upstreamStatus:number){
    super(code==='MINUBA_RECONNECT_REQUIRED'?'Minuba kræver ny godkendelse. Forbind Minuba igen under Integrationer.':code==='MINUBA_CREDENTIALS_REJECTED'?'Minuba afviser appens serverkonfiguration. Kontakt administrator.':'Minuba kunne ikke forny forbindelsen. Prøv igen; mailen er ikke sendt.');
  }
}
export async function refreshMinubaAccess(admin:any,clientId:string,clientIdValue:string,secret:string,scope='Administrator'){
  const read=async(kind:string)=>{const {data,error}=await admin.rpc('get_minuba_oauth_secret_for_service',{p_client_id:clientId,p_kind:kind});if(error)throw new MinubaOAuthError('MINUBA_TOKEN_STORAGE_ERROR',503,0);return String(data||'')};
  let refresh=await read('refresh_token');
  if(!refresh)throw new MinubaOAuthError('MINUBA_RECONNECT_REQUIRED',409,0);
  for(let attempt=0;attempt<2;attempt++){
    let response:Response|null=null,j:any={};
    try{
      response=await fetch('https://auth.minuba.dk/oauth2/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json',Authorization:'Basic '+btoa(clientIdValue+':'+secret)},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh})});
      j=await response.json().catch(()=>({}));
    }catch{}
    if(response?.ok&&typeof j.access_token==='string'&&j.access_token){
      const {error}=await admin.rpc('set_minuba_oauth_tokens',{p_client_id:clientId,p_access_token:j.access_token,p_refresh_token:String(j.refresh_token||refresh),p_expires_at:new Date(Date.now()+Math.max(60,Math.min(Number(j.expires_in)||3599,86400))*1000).toISOString(),p_scope:String(j.scope||scope)});
      if(error)throw new MinubaOAuthError('MINUBA_TOKEN_STORAGE_ERROR',503,response.status);
      return String(j.access_token);
    }
    // A competing request may already have rotated this tenant's token.
    const latest=await read('refresh_token');
    if(latest&&latest!==refresh){
      const access=await read('access_token');
      if(access)return access;
      refresh=latest;
    }
    const upstream=response?.status||0;
    const invalidGrant=j.error==='invalid_grant',invalidClient=j.error==='invalid_client';
    if(attempt===0&&!invalidGrant&&!invalidClient&&(upstream===0||upstream===429||upstream>=500)){
      await new Promise(resolve=>setTimeout(resolve,500));continue;
    }
    const code=invalidGrant?'MINUBA_RECONNECT_REQUIRED':invalidClient?'MINUBA_CREDENTIALS_REJECTED':'MINUBA_REFRESH_UNAVAILABLE';
    const e=new MinubaOAuthError(code,invalidGrant?409:503,upstream);
    await admin.from('crm_integrations').update({status:invalidGrant?'needs_reconnect':invalidClient?'oauth_credentials_rejected':'error',last_error:e.message+' ['+code+'; HTTP '+upstream+']',updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider','minuba');
    console.warn('Minuba refresh rejected',{code,upstream_status:upstream});
    throw e;
  }
  throw new MinubaOAuthError('MINUBA_REFRESH_UNAVAILABLE',503,0);
}
