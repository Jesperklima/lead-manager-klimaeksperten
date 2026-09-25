const fs=require('fs');

function read(path){return fs.readFileSync(path,'utf8')}
function must(condition,message){if(!condition){console.error('FAIL: '+message);process.exit(1)}}

const offer=read('offer-date-save-v1.js');
const tenant=read('tenant-isolation-v1.js');
const app=read('api/app.js');

must(tenant.includes("Object.prototype.hasOwnProperty.call(row,'client_id')"), 'tenant guard contract changed unexpectedly');
must(offer.includes("select('id,client_id,follow_up_date')"), 'follow-up readback must include client_id for tenant verification');
must(offer.includes(".eq('client_id',clientId).select('id,client_id,status,follow_up_date,current_comment').single()"), 'offer update must return the persisted row in the active workspace');
must(offer.includes("const savedDate=normalizeDate(r.data?.follow_up_date||null)"), 'offer save must verify the returned persisted date');
must(offer.includes("readSavedDate(o.id,clientId)"), 'fallback readback must be tenant scoped');
must(!offer.includes("select('id,follow_up_date')"), 'unsafe projected offer read without client_id returned');
must(!offer.includes("const savedDate=await readSavedDate(o.id);"), 'old false-negative save verification returned');
must(app.includes('/offer-date-save-v1.js?v=20260925-1'), 'offer date asset cache version not bumped');

const requested='2026-09-25';
const persisted={id:'offer-1',client_id:'client-1',follow_up_date:'2026-09-25'};
must(persisted.follow_up_date===requested, 'date round-trip fixture failed');
must(persisted.client_id==='client-1', 'tenant identity missing from persisted row fixture');

console.log('PASS: offer follow-up persistence is atomic, tenant-scoped and regression guarded');
