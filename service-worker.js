/* Network-only service worker: do not cache CRM records, auth tokens, pages, API calls or private mail. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
