// One-click unsubscribe page. The fan confirms with a button so link scanners
// in email apps (which open every link automatically) can't unsubscribe people by accident.
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = decodeURIComponent(location.pathname.split('/')[2] || '');
  const btn = document.getElementById('unsubBtn');
  const err = document.getElementById('unsubErr');
  btn.onclick = async () => {
    btn.disabled = true; err.hidden = true;
    try {
      const res = await fetch('/api/public/unsubscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DropRadar': '1' },
        body: JSON.stringify({ token })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Something went wrong. Try again.');
      document.getElementById('unsub').innerHTML = `<h1>You're unsubscribed</h1>
        <p class="muted">You won't get any more emails from ${esc(d.artist)}. If you change your mind, sign up again on any of their release pages.</p>
        <a class="btn btn-ghost" href="/privacy">Privacy policy</a>`;
    } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; }
  };
})();
