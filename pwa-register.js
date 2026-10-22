/* Lead Manager PWA: installation only. No private CRM data is cached. */
(()=>{if(!('serviceWorker' in navigator)||!window.isSecureContext)return;window.addEventListener('load',()=>{navigator.serviceWorker.register('/service-worker.js',{scope:'/'}).catch(err=>console.warn('PWA registration unavailable',err));});})();
