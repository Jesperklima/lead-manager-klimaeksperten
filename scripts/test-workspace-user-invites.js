const fs=require('fs');
const assert=require('assert');

const ui=fs.readFileSync('saas-workspace-users-v1.js','utf8');
const edge=fs.readFileSync('supabase/functions/saas-workspace-users/index.ts','utf8');
const bootstrap=fs.readFileSync('access-bootstrap-v1.js','utf8');
const settings=fs.readFileSync('saas-settings-hub-v1.js','utf8');

assert(ui.includes('+ Invitér bruger'),'invite button missing');
assert(ui.includes("action:'invite'"),'invite action missing');
assert(ui.includes("action:'resend'"),'resend action missing');
assert(ui.includes("action:'deactivate'"),'deactivate action missing');
assert(ui.includes("action:'change_role'"),'role change action missing');
assert(ui.includes('Admin')&&ui.includes('Bruger'),'role labels missing');

assert(edge.includes("invite_type: 'workspace_user'"),'workspace invite marker missing');
assert(edge.includes("['admin', 'user']"),'workspace invite roles must exclude owner');
assert(edge.includes('EMAIL_OTHER_WORKSPACE'),'cross-workspace guard missing');
assert(edge.includes('SELF_PROTECTED'),'self-deactivation guard missing');
assert(edge.includes('OWNER_PROTECTED'),'owner protection missing');
assert(edge.includes('WORKSPACE_FORBIDDEN'),'tenant access guard missing');
assert(!edge.includes(".from('crm_clients').insert"),'workspace invite must never create a client');
assert(!edge.includes("crm_apply_plan"),'workspace invite must never alter package');

assert(bootstrap.includes('/saas-workspace-users-v1.js?v=20260922-1'),'workspace user module is not loaded');
assert(settings.includes('window.LMWorkspaceUsers?.mount?.()'),'settings account does not mount workspace users');

console.log('PASS: workspace user invitation UI, tenant guards and no-new-workspace policy');
