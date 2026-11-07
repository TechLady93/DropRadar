// DropRadar front end. Plain JavaScript, no build step.
// All user-supplied text is escaped before it touches the page (XSS defence),
// and no inline scripts or styles are used so the strict Content-Security-Policy holds.
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const view = $('#view');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const fmtLong = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  const nf = new Intl.NumberFormat('en-US');

  let META = null;
  let ME = null;

  // ---- API ---------------------------------------------------------------------
  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    if (init.method !== 'GET') init.headers['X-DropRadar'] = '1';
    const res = await fetch(path, init);
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) { const err = new Error(data.error || 'Something went wrong. Try again.'); err.status = res.status; throw err; }
    return data;
  }

  // ---- Small UI helpers ------------------------------------------------------------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }
  async function copy(text, okMsg = 'Copied') {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch { toast('Select the text and copy it manually'); }
  }
  // CSS custom properties from data attributes (no inline style attributes under the CSP).
  function applyVars(root = view) {
    $$('[data-c]', root).forEach(el => el.style.setProperty('--c', el.dataset.c));
    $$('[data-w]', root).forEach(el => el.style.setProperty('--w', el.dataset.w + '%'));
    $$('[data-k]', root).forEach(el => el.style.setProperty('--k', el.dataset.k));
  }
  function go(path) { history.pushState({}, '', path); route(); }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-nav]');
    if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
  });
  window.addEventListener('popstate', route);

  function setUser(user) {
    ME = user;
    $('#userbar').hidden = !user;
    $('#userName').textContent = user ? user.artist_name : '';
    $('#demoBanner').hidden = !(user && user.is_demo);
  }

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null); go('/app');
  });
  $('#demoSignup').addEventListener('click', async e => {
    e.preventDefault();
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null); go('/app?signup=1');
  });

  // ---- Router ------------------------------------------------------------------------
  async function route() {
    window.scrollTo(0, 0);
    if (!META) META = await api('/api/meta');
    if (!ME) {
      try { setUser((await api('/api/me')).user); } catch { setUser(null); }
    }
    const params = new URLSearchParams(location.search);
    if (!ME && params.get('demo') === '1') {
      try { await api('/api/auth/demo', { method: 'POST' }); setUser((await api('/api/me')).user); history.replaceState({}, '', '/app'); }
      catch (err) { /* fall through to auth screen */ }
    }
    if (!ME) return renderAuth(params.get('signup') === '1' ? 'signup' : 'login');

    const p = location.pathname.replace(/\/+$/, '');
    let m;
    if (p === '/app/new') return renderNew();
    if ((m = p.match(/^\/app\/release\/(\d+)$/))) return renderRelease(Number(m[1]));
    return renderList();
  }

  // ---- Auth ---------------------------------------------------------------------------
  function renderAuth(mode) {
    document.title = 'Sign in · DropRadar';
    view.innerHTML = `
      <section class="auth">
        <div class="auth-pitch">
          <p class="eyebrow">DropRadar</p>
          <h1>Get your release heard in its first 30 days.</h1>
          <p>Matched curators and creators, a day-by-day rollout plan, a smart link that collects fans, and protection from fake-stream scams.</p>
        </div>
        <div class="panel auth-card">
          <div class="tabs-mini" role="tablist">
            <button type="button" role="tab" id="tabLogin" aria-selected="${mode === 'login'}">Sign in</button>
            <button type="button" role="tab" id="tabSignup" aria-selected="${mode === 'signup'}">Create account</button>
          </div>
          <form class="auth-form" id="authForm" novalidate>
            <label ${mode === 'login' ? 'hidden' : ''} id="artistField">Artist name
              <input id="artistName" name="artistName" autocomplete="nickname" maxlength="60">
            </label>
            <label>Email
              <input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
            </label>
            <label>Password
              <input id="password" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
              <span class="hint" ${mode === 'login' ? 'hidden' : ''} id="pwHint">At least 10 characters with letters and numbers.</span>
            </label>
            <p class="error-msg" id="authErr" hidden></p>
            <button class="btn btn-primary" type="submit" id="authSubmit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          <div class="or">or</div>
          <button class="btn btn-ghost" type="button" id="demoBtn">Explore the demo account</button>
        </div>
      </section>`;
    $('#tabLogin').onclick = () => renderAuth('login');
    $('#tabSignup').onclick = () => renderAuth('signup');
    $('#demoBtn').onclick = async () => {
      try { await api('/api/auth/demo', { method: 'POST' }); setUser((await api('/api/me')).user); go('/app'); }
      catch (err) { showErr(err.message); }
    };
    const showErr = msg => { const e = $('#authErr'); e.textContent = msg; e.hidden = false; };
    $('#authForm').onsubmit = async e => {
      e.preventDefault();
      const btn = $('#authSubmit'); btn.disabled = true;
      try {
        const body = { email: $('#email').value, password: $('#password').value };
        if (mode === 'signup') body.artistName = $('#artistName').value;
        await api(mode === 'login' ? '/api/auth/login' : '/api/auth/signup', { method: 'POST', body });
        setUser((await api('/api/me')).user);
        history.replaceState({}, '', '/app');
        route();
      } catch (err) { showErr(err.message); btn.disabled = false; }
    };
    (mode === 'signup' ? $('#artistName') : $('#email')).focus();
  }

  // ---- Release list --------------------------------------------------------------------
  async function renderList() {
    document.title = 'Releases · DropRadar';
    view.innerHTML = '<p class="loading">Loading your releases…</p>';
    const { releases } = await api('/api/releases');
    const t = todayISO();
    view.innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">${esc(ME.artist_name)}</p><h1>Your releases</h1></div>
        <a class="btn btn-primary" href="/app/new" data-nav>Add a release</a>
      </div>
      ${releases.length ? `<div class="release-grid">${releases.map(r => {
        const d = daysBetween(r.release_date, t);
        const when = d < 0 ? `Out in ${-d} day${d === -1 ? '' : 's'}` : d === 0 ? 'Out today' : `Day ${d} after release`;
        return `<a class="release-card" href="/app/release/${r.id}" data-nav>
          <span class="cover" data-c="${esc(r.cover_color)}"></span>
          <div>
            <h3>${esc(r.title)}</h3>
            <span class="meta-line">${esc(r.genre)} · ${esc(r.release_type)} · ${fmtDate(r.release_date)}</span>
            <span class="meta-line">${when} · ${nf.format(r.fans)} fans · ${nf.format(r.clicks)} clicks</span>
          </div>
        </a>`;
      }).join('')}</div>` : `
      <div class="panel empty">
        <h2>No releases yet</h2>
        <p>Add your next single and DropRadar will build its rollout plan, match it with outlets and set up a smart link.</p>
        <a class="btn btn-primary" href="/app/new" data-nav>Add your first release</a>
      </div>`}`;
    applyVars();
  }

  // ---- New release form ------------------------------------------------------------------
  const COVER_COLORS = ['#3438F0', '#E0662E', '#11845B', '#C42B3A', '#7A3FD1', '#0F7C99', '#1B1F2E', '#C99A18'];

  function renderNew() {
    document.title = 'New release · DropRadar';
    const defDate = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
    view.innerHTML = `
      <a class="back" href="/app" data-nav>← Releases</a>
      <div class="page-head"><div><p class="eyebrow">New release</p><h1>Tell us about the song</h1></div></div>
      <form class="panel form-panel" id="relForm" novalidate>
        <div class="form-section">
          <h3>The basics</h3>
          <div class="field-row">
            <label>Song title<input id="title" maxlength="100" required placeholder="Ocean Drive"></label>
            <label>Type<select id="releaseType"><option value="single">Single</option><option value="EP">EP</option><option value="album">Album</option></select></label>
            <label>Release date<input id="releaseDate" type="date" value="${defDate}" required><span class="hint">Four weeks out gives editorial teams time to listen.</span></label>
          </div>
        </div>
        <div class="form-section">
          <h3>The sound</h3>
          <div class="field-row">
            <label>Genre<select id="genre" required><option value="">Choose a genre</option>${META.genres.map(g => `<option>${esc(g)}</option>`).join('')}</select></label>
            <label>BPM <span class="hint">Optional. Sharpens matching.</span><input id="bpm" type="number" inputmode="numeric" min="40" max="220" placeholder="104"></label>
          </div>
          <fieldset class="form-section plain-fieldset">
            <legend class="hint">Mood. Pick up to three.</legend>
            <div class="chips" id="moods">${META.moods.map(m => `<label class="chip-toggle"><input type="checkbox" value="${esc(m)}"><span>${esc(m)}</span></label>`).join('')}</div>
          </fieldset>
          <div class="field-row">
            <label>Sounds like <span class="hint">Two or three artists</span><input id="soundsLike" maxlength="120" placeholder="Tems, Ayra Starr"></label>
            <label>Hometown or market<input id="hometown" maxlength="60" placeholder="Fort Lauderdale, FL"></label>
          </div>
          <label>The story in one or two sentences <span class="hint">Goes into every pitch. Why does this song exist?</span>
            <textarea id="story" maxlength="400" rows="3"></textarea></label>
        </div>
        <div class="form-section">
          <h3>Where it lives <span class="hint">Optional. Add them now or later. https links only.</span></h3>
          <div class="field-row">${['youtube', 'bandcamp', 'apple', 'audiomack', 'soundcloud', 'spotify'].map(p =>
            `<label>${esc(META.platformLabels[p])}<input id="link_${p}" type="url" inputmode="url" placeholder="https://"></label>`).join('')}</div>
        </div>
        <div class="form-section">
          <h3>Cover colour</h3>
          <div class="color-row">${COVER_COLORS.map((c, i) => `<label class="swatch"><input type="radio" name="cc" value="${c}" ${i === 0 ? 'checked' : ''}><span data-c="${c}"></span><span class="sr-only">${c}</span></label>`).join('')}</div>
        </div>
        <p class="error-msg" id="relErr" hidden></p>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit" id="relSubmit">Build my rollout</button>
          <a class="btn btn-ghost" href="/app" data-nav>Cancel</a>
        </div>
      </form>`;
    applyVars();
    const moodBoxes = $$('#moods input');
    moodBoxes.forEach(b => b.addEventListener('change', () => {
      const n = moodBoxes.filter(x => x.checked).length;
      moodBoxes.forEach(x => { x.disabled = !x.checked && n >= 3; });
    }));
    $('#relForm').onsubmit = async e => {
      e.preventDefault();
      const btn = $('#relSubmit'); btn.disabled = true;
      const links = {};
      ['youtube', 'bandcamp', 'apple', 'audiomack', 'soundcloud', 'spotify'].forEach(p => { const v = $('#link_' + p).value.trim(); if (v) links[p] = v; });
      try {
        const { id } = await api('/api/releases', { method: 'POST', body: {
          title: $('#title').value, releaseType: $('#releaseType').value, releaseDate: $('#releaseDate').value,
          genre: $('#genre').value, bpm: $('#bpm').value, moods: moodBoxes.filter(x => x.checked).map(x => x.value),
          soundsLike: $('#soundsLike').value, hometown: $('#hometown').value, story: $('#story').value,
          links, coverColor: ($('input[name="cc"]:checked') || {}).value
        } });
        go('/app/release/' + id);
      } catch (err) { const el = $('#relErr'); el.textContent = err.message; el.hidden = false; btn.disabled = false; el.scrollIntoView({ block: 'center' }); }
    };
    $('#title').focus();
  }

  // ---- Release detail -------------------------------------------------------------------------
  const TABS = [
    ['plan', 'Rollout plan'], ['matches', 'Matches'], ['content', 'Content'],
    ['link', 'Smart link'], ['protect', 'Protect'], ['results', 'Results']
  ];
  let REL = null;

  async function renderRelease(id, keepTab) {
    if (!keepTab) view.innerHTML = '<p class="loading">Loading release…</p>';
    try { REL = await api('/api/releases/' + id); }
    catch (err) { view.innerHTML = `<div class="panel empty"><h2>Release not found</h2><p>${esc(err.message)}</p><a class="btn btn-primary" href="/app" data-nav>Back to releases</a></div>`; return; }
    const r = REL.release;
    document.title = `${r.title} · DropRadar`;
    const t = todayISO();
    const d = daysBetween(r.release_date, t);
    const tab = TABS.some(x => x[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'plan';
    const done = REL.plan.filter(s => s.state === 'done').length;
    const pitched = REL.matches.filter(m => m.status && m.status !== 'draft').length;
    const counts = {
      plan: `${done}/${REL.plan.length}`,
      matches: REL.matches.length,
      protect: REL.results.alerts.length ? `${REL.results.alerts.length} alert` : null
    };
    view.innerHTML = `
      <a class="back" href="/app" data-nav>← Releases</a>
      <header class="rel-head">
        <span class="cover cover-lg" data-c="${esc(r.cover_color)}"></span>
        <div>
          <p class="eyebrow">${esc(r.genre)} ${esc(r.release_type)}${r.bpm ? ` · ${r.bpm} BPM` : ''}</p>
          <h1>${esc(r.title)}</h1>
          <div class="chips">${r.moods.map(m => `<span class="pill">${esc(m)}</span>`).join('')}</div>
        </div>
        <div class="day-counter">
          <span class="big num">${d < 0 ? 'T' + d : d === 0 ? 'Day 0' : 'Day ' + d}</span>
          <span class="muted">${d < 0 ? `releases ${fmtLong(r.release_date)}` : d === 0 ? 'release day' : `released ${fmtLong(r.release_date)}`}</span>
        </div>
      </header>
      <section class="strip" aria-label="Release summary">
        <div><span class="val">${done}<span class="muted">/${REL.plan.length}</span></span><span class="lbl">Plan steps done</span></div>
        <div><span class="val">${pitched}</span><span class="lbl">Outlets pitched</span></div>
        <div><span class="val">${nf.format(REL.results.fans)}</span><span class="lbl">Fans captured</span></div>
        <div><span class="val">${nf.format(REL.results.clicks)}</span><span class="lbl">Smart-link clicks</span></div>
      </section>
      <nav class="tabs" role="tablist" aria-label="Release sections">
        ${TABS.map(([k, label]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${label}${counts[k] != null ? `<span class="count ${k === 'protect' ? 'alert' : ''}">${counts[k]}</span>` : ''}</button>`).join('')}
      </nav>
      <section class="tab-body" id="tabBody"></section>`;
    applyVars();
    $$('.tabs button').forEach(b => b.onclick = () => { history.replaceState({}, '', '#' + b.dataset.tab); renderRelease(id, true); });
    ({ plan: tabPlan, matches: tabMatches, content: tabContent, link: tabLink, protect: tabProtect, results: tabResults })[tab](id);
    applyVars($('#tabBody'));
  }

  // -- Plan
  function tabPlan(id) {
    const body = $('#tabBody');
    const phases = [
      ['Before release', s => s.offset < 0, 'Build anticipation and get pitches in early'],
      ['Release week', s => s.offset >= 0 && s.offset <= 7, 'Turn attention into first listens and saves'],
      ['Keep it moving', s => s.offset > 7, 'Give people new reasons to share']
    ];
    const done = REL.plan.filter(s => s.state === 'done').length;
    const pct = Math.round(done / REL.plan.length * 100);
    const chPill = { Setup: '', Protect: 'pill-good', Content: 'pill-accent', Pitch: 'pill-signal', Fans: 'pill-good', Results: '' };
    body.innerHTML = `
      <div class="panel stack">
        <div class="section-head"><h2>30-day rollout</h2><span class="num muted">${pct}% complete</span></div>
        <div class="progress"><span data-w="${pct}"></span></div>
        <p class="muted">Every step says why it matters. Check steps off as you go; the plan moves with your release date.</p>
      </div>
      ${phases.map(([title, fn, sub]) => {
        const steps = REL.plan.filter(fn);
        if (!steps.length) return '';
        return `<section class="phase">
          <div class="phase-title"><h3>${title}</h3><span class="muted">${sub}</span></div>
          <ol class="timeline">${steps.map(s => `
            <li class="step is-${s.state}">
              <input type="checkbox" data-task="${esc(s.key)}" ${s.state === 'done' ? 'checked' : ''} aria-label="Mark “${esc(s.title)}” done">
              <div class="when"><span class="d">${fmtDate(s.date)}</span><span class="o">${s.offset === 0 ? 'Release day' : (s.offset > 0 ? 'Day +' : 'T') + s.offset}</span></div>
              <div class="what">
                <div class="what-top"><strong>${esc(s.title)}</strong>
                  <span class="pill ${chPill[s.channel] || ''}">${esc(s.channel)}</span>
                  ${s.state === 'today' ? '<span class="pill pill-signal">Today</span>' : ''}
                  ${s.state === 'overdue' ? '<span class="pill pill-warn">Overdue</span>' : ''}
                </div>
                <p class="why">${esc(s.why)}</p>
              </div>
            </li>`).join('')}</ol>
        </section>`;
      }).join('')}`;
    $$('[data-task]', body).forEach(cb => cb.onchange = async () => {
      try { await api(`/api/releases/${id}/tasks/${cb.dataset.task}`, { method: 'POST', body: { done: cb.checked } }); renderRelease(id, true); }
      catch (err) { toast(err.message); cb.checked = !cb.checked; }
    });
  }

  // -- Matches
  let matchFilter = 'all';
  const KIND_LABEL = { playlist: 'Playlist', blog: 'Blog', creator: 'Creator', dj: 'DJ', community: 'Community', radio: 'Radio' };
  const STATUS = [['', 'Not pitched'], ['draft', 'Drafted'], ['approved', 'Approved'], ['sent', 'Sent'], ['replied', 'Replied'], ['added', 'Added'], ['passed', 'Passed']];

  function ring(score) {
    const c = 2 * Math.PI * 22;
    return `<div class="score-ring" aria-label="${score}% fit"><svg viewBox="0 0 52 52"><circle class="track" cx="26" cy="26" r="22"/><circle class="bar" cx="26" cy="26" r="22" stroke-dasharray="${(score / 100 * c).toFixed(1)} ${c.toFixed(1)}"/></svg><span>${score}</span></div>`;
  }

  function tabMatches(id) {
    const a = REL.analysis;
    const body = $('#tabBody');
    const kinds = ['all', ...new Set(REL.matches.map(m => m.kind))];
    const list = REL.matches.filter(m => matchFilter === 'all' || m.kind === matchFilter);
    body.innerHTML = `
      <section class="panel analysis">
        <div class="gauge">
          <span class="eyebrow">Short-form fit</span>
          <span class="val num">${a.shortFormScore}</span>
          <div class="progress"><span data-w="${a.shortFormScore}"></span></div>
          <span class="muted">${esc(a.tempo.label)}</span>
        </div>
        <div class="stack">
          <h2>Where this song is most likely to travel</h2>
          <ul class="lanes">${a.lanes.map(l => `<li>${esc(l)}</li>`).join('')}<li>${esc(a.hookTip)}</li></ul>
        </div>
      </section>
      <div class="toolbar">
        <div class="filter" role="group" aria-label="Filter outlets">${kinds.map(k => `<button type="button" data-k2="${k}" aria-pressed="${k === matchFilter}">${k === 'all' ? 'All' : KIND_LABEL[k]}</button>`).join('')}</div>
        <span class="muted">${list.length} matched outlets · sample data</span>
      </div>
      <ul class="outlets">${list.map(o => `
        <li class="outlet">
          ${ring(o.score)}
          <div class="outlet-info">
            <span class="name">${esc(o.name)}</span>
            <span class="meta-line">${KIND_LABEL[o.kind]} · ${esc(o.platform)} · ${esc(o.region)} · ${nf.format(o.reach)} reach</span>
            <span class="reasons">${o.reasons.map(esc).join(' · ')}</span>
          </div>
          <div class="outlet-actions">
            <select data-status="${o.id}" aria-label="Pitch status for ${esc(o.name)}">${STATUS.map(([v, l]) => `<option value="${v}" ${(o.status || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button class="btn btn-ghost btn-sm" type="button" data-pitch="${o.id}">Write pitch</button>
          </div>
        </li>`).join('')}</ul>`;
    $$('[data-k2]', body).forEach(b => b.onclick = () => { matchFilter = b.dataset.k2; tabMatches(id); applyVars(body); });
    $$('[data-status]', body).forEach(s => s.onchange = async () => {
      try { await api(`/api/releases/${id}/pitch/${s.dataset.status}`, { method: 'PUT', body: { status: s.value || null } }); toast('Status saved'); }
      catch (err) { toast(err.message); }
    });
    $$('[data-pitch]', body).forEach(b => b.onclick = () => openPitch(id, Number(b.dataset.pitch)));
  }

  async function openPitch(id, outletId) {
    const o = REL.matches.find(m => m.id === outletId);
    const p = await api(`/api/releases/${id}/pitch/${outletId}`);
    const bg = document.createElement('div'); bg.className = 'drawer-bg';
    const dr = document.createElement('aside'); dr.className = 'drawer'; dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true'); dr.setAttribute('aria-labelledby', 'drTitle');
    dr.innerHTML = `
      <div class="drawer-head"><div><p class="eyebrow">Pitch</p><h3 id="drTitle">${esc(o.name)}</h3></div><button class="icon-btn" type="button" id="drClose" aria-label="Close">×</button></div>
      <div class="drawer-body">
        <label>Subject<input id="pSubject" value="${esc(p.subject)}"></label>
        <label>Message<textarea id="pBody">${esc(p.body)}</textarea></label>
        <p class="hint">Read it once and make it sound like you. Personal pitches get answered; templates get ignored.</p>
      </div>
      <div class="drawer-foot">
        <button class="btn btn-primary" type="button" id="pCopy">Copy pitch</button>
        <button class="btn btn-ghost" type="button" id="pApprove">Mark approved</button>
      </div>`;
    document.body.append(bg, dr);
    const close = () => { bg.remove(); dr.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    bg.onclick = close; $('#drClose', dr).onclick = close;
    $('#pCopy', dr).onclick = () => copy(`Subject: ${$('#pSubject', dr).value}\n\n${$('#pBody', dr).value}`, 'Pitch copied');
    $('#pApprove', dr).onclick = async () => {
      await api(`/api/releases/${id}/pitch/${outletId}`, { method: 'PUT', body: { status: 'approved' } });
      close(); toast('Marked approved'); renderRelease(id, true);
    };
    $('#pSubject', dr).focus();
  }

  // -- Content
  function tabContent() {
    const c = REL.content;
    const body = $('#tabBody');
    body.innerHTML = `
      <div class="cards-2">
        <section class="panel stack">
          <div class="section-head"><h2>Captions</h2><span class="muted">Tap to copy</span></div>
          <ul class="caption-list">${c.captions.map((x, i) => `
            <li class="caption"><div><span class="pill">${esc(x.platform)}</span><p>${esc(x.text)}</p></div>
              <button class="btn btn-ghost btn-sm" type="button" data-cap="${i}">Copy</button></li>`).join('')}</ul>
        </section>
        <section class="panel stack">
          <h2>Short-form video ideas</h2>
          <ul class="idea-list">${c.videoIdeas.map(v => `<li><strong>${esc(v.title)}</strong><p>${esc(v.detail)}</p></li>`).join('')}</ul>
        </section>
      </div>
      <section class="panel stack">
        <div class="section-head"><h2>Hashtags</h2><button class="btn btn-ghost btn-sm" type="button" id="copyTags">Copy all</button></div>
        <div class="chips">${c.hashtags.map(h => `<span class="pill pill-accent">${esc(h)}</span>`).join('')}</div>
      </section>`;
    $$('[data-cap]', body).forEach(b => b.onclick = () => copy(c.captions[b.dataset.cap].text, 'Caption copied'));
    $('#copyTags').onclick = () => copy(c.hashtags.join(' '), 'Hashtags copied');
  }

  // -- Smart link
  function tabLink() {
    const r = REL.release;
    const url = `${location.origin}/r/${r.slug}`;
    const srcs = [['TikTok bio', 'tiktok'], ['Instagram bio', 'instagram'], ['YouTube description', 'youtube'], ['Fan email', 'email'], ['Curator pitches', 'curator']];
    const platforms = Object.keys(r.links);
    $('#tabBody').innerHTML = `
      <section class="panel stack">
        <h2>Your smart link</h2>
        <p class="muted">One link for every bio and post. Fans pick their platform and can leave their email so you can reach them directly next release.</p>
        <div class="link-box"><input id="slUrl" value="${esc(url)}" readonly aria-label="Smart link"><button class="btn btn-primary" type="button" id="slCopy">Copy link</button><a class="btn btn-ghost" href="/r/${esc(r.slug)}" target="_blank" rel="noopener">Preview</a></div>
        ${platforms.length ? `<div class="chips">${platforms.map(p => `<span class="pill">${esc(META.platformLabels[p])}</span>`).join('')}</div>`
          : '<p class="error-msg">No platform links added yet, so the page will only collect emails. Add links when the release is live.</p>'}
      </section>
      <section class="panel stack">
        <h2>Tracked versions</h2>
        <p class="muted">Use a different version in each place so Results can show which post brought listeners.</p>
        <div class="table-scroll"><table class="src-table"><tbody>${srcs.map(([label, k]) => `
          <tr><td>${label}</td><td class="url">${esc(url)}?src=${k}</td><td><button class="btn btn-ghost btn-sm" type="button" data-src="${k}">Copy</button></td></tr>`).join('')}
        </tbody></table></div>
      </section>`;
    $('#slCopy').onclick = () => copy(url, 'Link copied');
    $$('[data-src]').forEach(b => b.onclick = () => copy(`${url}?src=${b.dataset.src}`, 'Link copied'));
  }

  // -- Protect
  async function tabProtect(id) {
    const body = $('#tabBody');
    const alerts = REL.results.alerts;
    const doneN = REL.protection.filter(p => p.done).length;
    body.innerHTML = `
      ${alerts.map(a => `
        <div class="alert-box" role="alert"><span class="dot"></span><div class="stack">
          <strong>Unusual spike on ${fmtLong(a.day)}</strong>
          <p>${nf.format(a.count)} clicks in one day against a recent average of ${nf.format(a.average)}. Sudden jumps from a single source can be fake traffic sent to your release. If you didn't run a campaign that day, report it to your distributor so the song isn't penalised.</p>
        </div></div>`).join('')}
      <div class="cards-2">
        <section class="panel stack">
          <h2>Promoter scanner</h2>
          <p class="muted">Got a DM offering promotion? Paste it here before you reply.</p>
          <label class="sr-only" for="scanText">Message to check</label>
          <textarea id="scanText" rows="6" placeholder="Hey! Love your sound. We guarantee 10,000 Spotify streams for $49…"></textarea>
          <div class="form-actions"><button class="btn btn-primary" type="button" id="scanBtn">Check message</button><button class="btn btn-ghost" type="button" id="scanSample">Try a sample</button></div>
          <div id="scanOut"></div>
        </section>
        <section class="panel stack">
          <div class="section-head"><h2>Account checklist</h2><span class="num muted">${doneN}/${REL.protection.length}</span></div>
          <ul class="check-list">${REL.protection.map(p => `
            <li><input type="checkbox" data-task="${esc(p.key)}" ${p.done ? 'checked' : ''} id="pc_${esc(p.key)}">
              <label for="pc_${esc(p.key)}"><span>${esc(p.t)}</span><p>${esc(p.why)}</p></label></li>`).join('')}</ul>
        </section>
      </div>
      <section class="panel stack">
        <div class="section-head"><h2>Account activity</h2><span class="muted">Sign-ins and scans on your account</span></div>
        <ul class="log" id="secLog"><li class="muted">Loading…</li></ul>
      </section>`;
    $$('[data-task]', body).forEach(cb => cb.onchange = async () => {
      try { await api(`/api/releases/${id}/tasks/${cb.dataset.task}`, { method: 'POST', body: { done: cb.checked } }); toast(cb.checked ? 'Done' : 'Unchecked'); }
      catch (err) { toast(err.message); cb.checked = !cb.checked; }
    });
    $('#scanSample').onclick = () => {
      $('#scanText').value = "Hey fam!! 🔥 Love your sound. We're official Spotify partners and we GUARANTEE 10k streams for $49. Only 3 spots left, act now. Send payment via gift card and DM us your login so we can add you to the playlist faster: bit.ly/promo-spot";
    };
    $('#scanBtn').onclick = async () => {
      const out = $('#scanOut');
      try {
        const r = await api('/api/scan', { method: 'POST', body: { text: $('#scanText').value } });
        const title = { clear: 'No red flags found', caution: 'Be careful', danger: 'Likely a scam' }[r.verdict];
        out.innerHTML = `<div class="verdict ${r.verdict}"><strong>${title}</strong><p>${esc(r.summary)}</p></div>
          ${r.findings.length ? `<ul class="findings">${r.findings.map(f => `<li><span class="sev-${f.severity} mono">${f.severity === 'high' ? 'HIGH' : 'MEDIUM'} · <code>${esc(f.match)}</code></span><span>${esc(f.why)}</span></li>`).join('')}</ul>` : ''}`;
        loadLog();
      } catch (err) { out.innerHTML = `<p class="error-msg">${esc(err.message)}</p>`; }
    };
    const LABELS = { login_success: 'Signed in', login_failed: 'Failed sign-in attempt', account_locked: 'Account locked after failed attempts', login_blocked_locked: 'Sign-in blocked while locked', signup: 'Account created', demo_login: 'Demo sign-in', promoter_scan: 'Promoter message scanned' };
    async function loadLog() {
      try {
        const { events } = await api('/api/security-log');
        $('#secLog').innerHTML = events.length ? events.map(e => `<li><span class="t">${esc(e.created_at)} UTC</span><span>${esc(LABELS[e.event] || e.event)}${e.detail ? ` <span class="muted">(${esc(e.detail)})</span>` : ''}</span></li>`).join('') : '<li class="muted">No activity yet.</li>';
      } catch { $('#secLog').innerHTML = '<li class="muted">Could not load activity.</li>'; }
    }
    loadLog();
  }

  // -- Results
  function tabResults() {
    const R = REL.results;
    const body = $('#tabBody');
    const r = REL.release;
    const max = (arr) => Math.max(1, ...arr.map(x => x.n));
    const spikeDays = new Set(R.alerts.map(a => a.day));

    // Daily clicks bar chart, drawn to scale in SVG.
    let chart = '<p class="muted">No clicks yet. Share your smart link to start seeing data.</p>';
    if (R.byDay.length) {
      const W = 720, H = 240, L = 40, B = 28, T = 16, Rr = 8;
      const days = R.byDay;
      const top = Math.ceil(max(days) / 50) * 50;
      const bw = (W - L - Rr) / days.length;
      const y = v => T + (H - T - B) * (1 - v / top);
      const ticks = [0, top / 2, top];
      const relIdx = days.findIndex(d => d.day === r.release_date);
      chart = `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Smart-link clicks per day">
        ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
        ${days.map((d, i) => `<rect class="bar ${spikeDays.has(d.day) ? 'spike' : d.day === r.release_date ? 'release' : ''}" x="${(L + i * bw + bw * 0.15).toFixed(1)}" y="${y(d.n).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(H - B - y(d.n)).toFixed(1)}" rx="2"><title>${fmtDate(d.day)}: ${d.n} clicks</title></rect>`).join('')}
        ${days.map((d, i) => { const st = Math.ceil(days.length / 7); return (i % st === 0 || (i === days.length - 1 && (days.length - 1) % st >= st / 2)); }).map((show, i) => [show, days[i], i]).map(([show, d, i]) => show ? `<text class="axis-label" x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${fmtDate(d.day)}</text>` : '').join('')}
        ${relIdx >= 0 ? `<line class="marker" x1="${(L + relIdx * bw + bw / 2).toFixed(1)}" x2="${(L + relIdx * bw + bw / 2).toFixed(1)}" y1="${T}" y2="${H - B}"/><text class="marker-label" x="${(L + relIdx * bw + bw / 2 + 6).toFixed(1)}" y="${T + 10}">Release</text>` : ''}
      </svg></div>`;
    }
    const hb = (arr, labelFn, cls = '') => {
      const tot = arr.reduce((s, x) => s + x.n, 0) || 1;
      return `<ul class="hbar-list">${arr.map(x => `<li><div class="hbar-top"><span>${esc(labelFn(x))}</span><span class="num">${nf.format(x.n)} · ${Math.round(x.n / tot * 100)}%</span></div><div class="hbar ${cls}"><span data-w="${(x.n / max(arr) * 100).toFixed(1)}"></span></div></li>`).join('')}</ul>`;
    };
    const SRC = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', email: 'Fan email', curator: 'Curators', x: 'X', facebook: 'Facebook', direct: 'Direct / unknown' };
    const funnelOrder = ['approved', 'sent', 'replied', 'added', 'passed'];
    const fmap = Object.fromEntries(R.pitchFunnel.map(f => [f.status, f.n]));
    body.innerHTML = `
      ${REL.isDemo ? '<p class="pill pill-signal">Demo account · sample data</p>' : ''}
      <section class="panel stack">
        <div class="section-head"><h2>Smart-link clicks per day</h2>
          <div class="legend"><span><i data-k="var(--accent)"></i>Clicks</span><span><i data-k="var(--signal)"></i>Release day</span>${R.alerts.length ? '<span><i data-k="var(--bad)"></i>Flagged spike</span>' : ''}</div></div>
        ${chart}
      </section>
      <div class="cards-2">
        <section class="panel stack"><h2>Where listeners went</h2>${R.byPlatform.length ? hb(R.byPlatform, x => META.platformLabels[x.platform] || x.platform) : '<p class="muted">No data yet.</p>'}</section>
        <section class="panel stack"><h2>What brought them</h2>${R.bySource.length ? hb(R.bySource, x => SRC[x.source] || x.source, 'signal') : '<p class="muted">No data yet.</p>'}</section>
      </div>
      <div class="cards-2">
        <section class="panel stack"><div class="section-head"><h2>Fans you own</h2><span class="num">${nf.format(R.fans)}</span></div>
          ${R.fansBySource.length ? hb(R.fansBySource, x => SRC[x.source] || x.source) : '<p class="muted">Fans who leave their email on your smart link show up here.</p>'}</section>
        <section class="panel stack"><h2>Pitch pipeline</h2>
          <ul class="funnel">${funnelOrder.map(s => `<li><span class="num">${fmap[s] || 0}</span><span class="lbl">${s}</span></li>`).join('')}</ul>
          <p class="muted">Track replies on the Matches tab. A 10 to 20 percent response rate is healthy for cold pitches.</p></section>
      </div>
      ${!REL.isDemo ? `<div class="danger-zone" id="dz"><button class="btn-danger-link" type="button" id="delBtn">Delete this release</button></div>` : ''}`;
    const del = $('#delBtn');
    if (del) del.onclick = () => {
      $('#dz').innerHTML = `<div class="confirm-row"><span>Delete “${esc(r.title)}” and all its data? This can't be undone.</span><button class="btn btn-sm btn-primary" type="button" id="delYes">Delete</button><button class="btn btn-sm btn-ghost" type="button" id="delNo">Keep it</button></div>`;
      $('#delNo').onclick = () => tabResults();
      $('#delYes').onclick = async () => { try { await api('/api/releases/' + r.id, { method: 'DELETE' }); toast('Release deleted'); go('/app'); } catch (err) { toast(err.message); } };
    };
    applyVars(body);
  }

  route();
})();
