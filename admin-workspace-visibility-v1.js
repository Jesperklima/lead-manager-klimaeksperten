/* Lead Manager admin workspace visibility guard.
 * Internal owner/admin accounts must always see all customer workspaces.
 * Customer accounts remain restricted by the server-side access model.
 */
(function () {
  'use strict';
  async function refreshAdminWorkspaces() {
    try {
      const token = localStorage.getItem('sb-access-token') || sessionStorage.getItem('sb-access-token');
      const headers = token ? { Authorization: 'Bearer ' + token } : {};
      const r = await fetch('/api/admin-clients', { headers, credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const payload = await r.json();
      const clients = Array.isArray(payload) ? payload : (payload.clients || []);
      if (!clients.length) return;
      const selectors = document.querySelectorAll('select[data-client-selector], #clientSelector, #customerSelector, #workspaceSelector');
      selectors.forEach(function (select) {
        const current = select.value;
        select.innerHTML = '';
        clients.forEach(function (c) {
          const o = document.createElement('option');
          o.value = c.id || c.client_id;
          o.textContent = c.name || c.company_name || c.email || o.value;
          select.appendChild(o);
        });
        if ([].some.call(select.options, function(o){ return o.value === current; })) select.value = current;
      });
    } catch (_) {}
  }
  window.addEventListener('load', function(){ setTimeout(refreshAdminWorkspaces, 250); });
  window.addEventListener('focus', refreshAdminWorkspaces);
})();
