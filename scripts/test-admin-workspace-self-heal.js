const fs=require('fs');
const access=fs.readFileSync('access-bootstrap-v1.js','utf8');
const app=fs.readFileSync('api/app.js','utf8');
function must(s,m){if(!s)throw new Error(m)}
for(const marker of [
  "localStorage.removeItem('lm_admin_active_client_v1')",
  "localStorage.removeItem('lm_admin_client_id')",
  "supabase.from('crm_clients').select('*').order('created_at',{ascending:true}).limit(1)",
  "localStorage.setItem('lm_admin_active_client_v1',String(clientId))",
  "if(!clientId||!valid(cr))throw new Error"
]) must(access.includes(marker),'missing stale-workspace self-heal marker: '+marker);
must(!access.includes("if(!clientId)throw new Error('Intet workspace kunne vælges.')"),'old hard failure still present');
must(app.includes("access-bootstrap-v1.js?v=20260920-3"),'access bootstrap cache version not bumped');
console.log('PASS: stale platform-admin workspace self-heals');
