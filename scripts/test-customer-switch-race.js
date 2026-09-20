const fs=require('fs');
const s=fs.readFileSync('saas-admin-client-switcher-v1.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20260920193000_startup_snapshot_tenant_identity_fix.sql','utf8');
function assert(v,m){if(!v)throw new Error(m)}

assert(s.includes("if(seq===switchSeq)setSwitching(false)"),'stale switch can unlock UI while a newer switch is running');
assert(s.includes("if(seq===switchSeq){\n      if(committed)restoreWorkspace(previous);"),'stale switch errors are not gated to the newest request');
assert(s.includes("if(typeof toast==='function')toast('Kunne ikke skifte kundeprofil. Prøv igen.')"),'workspace switch error feedback missing');
assert(s.includes("if(seq!==switchSeq)return"),'stale switch result guard missing');
assert(s.includes("supabase.from('crm_clients').select('*').eq('id',id).limit(1)"),'target workspace context is not fetched before switching');
assert(s.includes("supabase.rpc('crm_startup_snapshot',{p_client_id:id})"),'atomic target snapshot is missing');
assert(s.includes("const waits=[0,180,450]"),'workspace snapshot retries/backoff missing');
assert(s.includes("function applyWorkspaceSnapshot(id,loaded)"),'atomic workspace apply missing');
assert(s.includes("resetWorkspaceUi(false)"),'workspace apply can still render an empty intermediate state');
assert(!s.includes("state.client={id:row.client_id,name:row.client_name||'Kunde'}"),'switch still drops full client settings before target data is ready');

const loadPos=s.indexOf("const loaded=await fullLoadForClient(id)");
const applyPos=s.indexOf("applyWorkspaceSnapshot(id,loaded)",loadPos);
const storePos=s.indexOf("localStorage.setItem(STORAGE,id)",applyPos);
assert(loadPos>=0&&applyPos>loadPos&&storePos>applyPos,'target workspace is persisted before its snapshot is ready');

assert(s.includes("Promise.resolve().then(()=>window.__LM_PERF.refreshWorkspace()).catch(error=>console.warn('workspace background refresh failed',error))"),'post-switch refresh is still fatal');
assert(s.includes("window.__LM_WORKSPACE_SWITCH_STATS={client_id:id,duration_ms:duration,finished_at:new Date().toISOString(),mode:'atomic_snapshot'}"),'atomic workspace switch telemetry missing');
assert(s.includes("window.__LM_ADMIN_CLIENT_SWITCHER_TEST={resetWorkspaceUi,assertVisibleData,fetchWorkspaceSnapshot,fullLoadForClient,applyWorkspaceSnapshot,switchClient}"),'atomic switch helpers are not exposed to regression harness');

assert(migration.includes('select id,client_id,type,summary,metadata,lead_id,company_id,created_at'),'activity snapshot rows can lose tenant identity');
assert(migration.includes('select id,client_id,status,created_at'),'approval snapshot rows can lose tenant identity');

console.log('PASS: atomic admin customer switch guards');
