const fs=require('fs');
const assert=require('node:assert/strict');

const auth=fs.readFileSync('supabase/functions/gmail-direct-auth/index.ts','utf8');
const callback=fs.readFileSync('supabase/functions/gmail-oauth-callback/index.ts','utf8');

const redirect='https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/gmail-oauth-callback';

assert(auth.includes(`const REDIRECT_URI='${redirect}'`),'Gmail OAuth start redirect URI changed unexpectedly');
assert(callback.includes(`const REDIRECT_URI='${redirect}'`),'Gmail OAuth callback redirect URI must exactly match start URI');

assert(auth.includes("prompt:'consent select_account'"),'Google account chooser must be forced during Gmail OAuth');
assert(!auth.includes("login_hint:account"),'Gmail OAuth must not pin the browser to the configured account with login_hint');
assert(auth.includes("access_type:'offline'"),'offline access must remain enabled for refresh token issuance');
assert(auth.includes("include_granted_scopes:'true'"),'incremental granted scopes handling missing');
assert(auth.includes("state:stateToken"),'OAuth state token must be included');

assert(callback.includes("set_gmail_refresh_token"),'callback must store the refresh token through the guarded RPC');
assert(callback.includes("Kunne ikke verificere den valgte Google-konto."),'selected Google account verification guard missing');
assert(callback.includes("row.used_at"),'OAuth state replay protection missing');

console.log('PASS: Gmail OAuth forces account selection and keeps exact callback/state guards');
