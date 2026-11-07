// Public smart-link page.
(() => {
  'use strict';
  const el = document.getElementById('sl');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
  const src = new URLSearchParams(location.search).get('src') || 'direct';

  fetch('/api/public/r/' + encodeURIComponent(slug)).then(r => r.json().then(d => ({ ok: r.ok, d }))).then(({ ok, d }) => {
    if (!ok) { el.innerHTML = `<h1>Link not found</h1><p class="muted">${esc(d.error)}</p>`; return; }
    document.title = `${d.title} by ${d.artist}`;
    document.body.style.setProperty('--c', d.color);
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = d.releaseDate > today;
    const when = new Date(d.releaseDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    el.innerHTML = `
      <div class="sl-cover" aria-hidden="true"><span></span></div>
      <div>
        <p class="sl-date">${upcoming ? 'Out ' + esc(when) : esc(d.genre) + ' ' + esc(d.type)}</p>
        <h1>${esc(d.title)}</h1>
        <p class="artist">${esc(d.artist)}</p>
      </div>
      ${d.story ? `<p class="story">${esc(d.story)}</p>` : ''}
      ${!upcoming && d.platforms.length ? `<div class="sl-buttons">${d.platforms.map(p =>
        `<a class="sl-btn" href="/go/${encodeURIComponent(slug)}/${p.id}?src=${encodeURIComponent(src)}" rel="noopener">${esc(p.label)}<span class="go">Listen →</span></a>`).join('')}</div>` : ''}
      <form class="sl-fan" id="fanForm" novalidate>
        <h2>${upcoming ? 'Get a message the day it drops' : 'Hear the next one first'}</h2>
        <div class="row">
          <label class="sr-only" for="fanEmail">Email address</label>
          <input id="fanEmail" type="email" autocomplete="email" placeholder="you@email.com" required>
          <button class="btn btn-primary" type="submit">${upcoming ? 'Notify me' : 'Join the list'}</button>
        </div>
        <label class="hp" aria-hidden="true">Leave empty<input id="website" tabindex="-1" autocomplete="off"></label>
        <p class="error-msg" id="fanErr" hidden></p>
        <p class="hint">Only ${esc(d.artist)} will use your email. Unsubscribe any time.</p>
      </form>`;
    document.getElementById('fanForm').onsubmit = async e => {
      e.preventDefault();
      const err = document.getElementById('fanErr');
      const res = await fetch(`/api/public/r/${encodeURIComponent(slug)}/fan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DropRadar': '1' },
        body: JSON.stringify({ email: document.getElementById('fanEmail').value, website: document.getElementById('website').value, source: src })
      });
      const d2 = await res.json().catch(() => ({}));
      if (!res.ok) { err.textContent = d2.error || 'Something went wrong. Try again.'; err.hidden = false; return; }
      e.target.outerHTML = `<p class="sl-ok">You're on the list. Thank you!</p>`;
    };
  }).catch(() => { el.innerHTML = '<h1>Could not load this release</h1><p class="muted">Check your connection and refresh.</p>'; });
})();
