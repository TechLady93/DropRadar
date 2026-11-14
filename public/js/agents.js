// Agent Squad front-end logic.
(async function () {
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  // --- Auth check -----------------------------------------------------------
  let user = null;
  try {
    const r = await fetch('/api/me', { headers: { 'X-DropRadar': '1' } });
    if (r.ok) { const d = await r.json(); user = d.user; }
  } catch {}
  if (!user) {
    const hero = document.querySelector('.agents-hero');
    if (hero) hero.innerHTML = '<h1>Agent Squad</h1><p class="muted">Sign in to use the Agent Squad. <a href="/app?signup=1">Create a free account</a> or <a href="/app?demo=1">try the demo</a>.</p>';
    return;
  }
  $('#userName').textContent = user.artist_name;
  $('#userbar').hidden = false;

  // --- Load meta (genres, moods) -------------------------------------------
  let meta;
  try { meta = await (await fetch('/api/meta')).json(); } catch { meta = { genres: [], moods: [] }; }

  // Pre-fill artist name
  const artistInput = $('#artistName');
  if (artistInput) artistInput.value = user.artist_name;

  // Build genre dropdown with fallback
  const genreSel = $('#genre');
  if (genreSel) {
    if (Array.isArray(meta.genres) && meta.genres.length) {
      genreSel.innerHTML = '<option value="">Select genre…</option>' +
        meta.genres.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    } else {
      genreSel.outerHTML = '<input type="text" name="genre" id="genre" placeholder="e.g. Indie" required maxlength="40">';
    }
  }

  // Build mood chips
  const moodWrap = $('#moodChips');
  if (moodWrap && Array.isArray(meta.moods) && meta.moods.length) {
    moodWrap.innerHTML = meta.moods.map(m =>
      `<label class="chip-toggle"><input type="checkbox" name="moods" value="${esc(m)}"><span>${esc(m)}</span></label>`
    ).join('');
  } else if (moodWrap) {
    moodWrap.innerHTML = '<input type="text" name="moods" placeholder="e.g. Dreamy, Energetic" maxlength="60" class="fallback-mood">';
  }

  // Helper: read moods from chips or fallback input
  function getMoods() {
    const chips = $$('input[name="moods"]:checked');
    if (chips.length) return Array.from(chips).map(el => el.value);
    const fallback = $('input[name="moods"].fallback-mood');
    if (fallback) return fallback.value.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  }

  // --- Form submission ------------------------------------------------------
  async function runAgents() {
    const form = $('#agentForm');
    const formData = new FormData(form);
    const genre = formData.get('genre');
    const moods = getMoods();
    const payload = {
      title: formData.get('title'),
      artist: formData.get('artist'),
      genre,
      moods,
      releaseDate: formData.get('releaseDate'),
      bpm: formData.get('bpm') || '',
      hometown: formData.get('hometown') || '',
      soundsLike: formData.get('soundsLike') || ''
    };

    // Validate
    if (!payload.title || !payload.artist || !payload.genre || !payload.moods.length || !payload.releaseDate) {
      showToast('Fill in all required fields.');
      return;
    }

    // Show results area, reset cards
    const results = $('#agentResults');
    results.hidden = false;
    setLoading('social');
    setLoading('voice');
    setLoading('leads');
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const headers = { 'Content-Type': 'application/json', 'X-DropRadar': '1' };

    // Fire all three agents in parallel
    const [socialR, voiceR, leadsR] = await Promise.allSettled([
      fetch('/api/agents/social', { method: 'POST', headers, body: JSON.stringify(payload) }).then(r => r.json()),
      fetch('/api/agents/voice', { method: 'POST', headers, body: JSON.stringify(payload) }).then(r => r.json()),
      fetch('/api/agents/leads', { method: 'POST', headers, body: JSON.stringify(payload) }).then(r => r.json())
    ]);

    if (socialR.status === 'fulfilled' && socialR.value.calendar) renderSocial(socialR.value.calendar);
    else setLoadingError('social', socialR.reason?.message || 'Failed');

    if (voiceR.status === 'fulfilled' && voiceR.value.script) renderVoice(voiceR.value);
    else setLoadingError('voice', voiceR.reason?.message || 'Failed');

    if (leadsR.status === 'fulfilled' && leadsR.value.leads) renderLeads(leadsR.value.leads);
    else setLoadingError('leads', leadsR.reason?.message || 'Failed');
  }

  $('#agentForm').addEventListener('submit', e => {
    e.preventDefault();
    runAgents();
  });

  // --- Loading states -------------------------------------------------------
  function setLoading(agent) {
    const body = $(`#agent-${agent}-body`);
    body.innerHTML = '<div class="agent-loading"><div class="spinner"></div><p class="mono">Agent working…</p></div>';
  }
  function setLoadingError(agent, msg) {
    const body = $(`#agent-${agent}-body`);
    body.innerHTML = `<div class="voice-unavailable">Something went wrong: ${esc(msg)}</div>`;
  }

  // --- Render Social Calendar -----------------------------------------------
  function renderSocial(calendar) {
    const body = $('#agent-social-body');
    body.innerHTML = '<ul class="cal-timeline">' + calendar.map(d => `
      <li class="cal-day">
        <div class="cal-date">
          <span class="d">${fmtDate(d.date)}</span>
          <span class="label">${esc(d.label)}</span>
        </div>
        <div class="cal-content">
          <div class="cal-platform">
            <span class="dot ${d.platform.toLowerCase()}"></span>
            <strong>${esc(d.platform)}</strong>
          </div>
          <div class="cal-hook">${esc(d.hook)}</div>
          <div class="cal-hook-detail">${esc(d.hookDetail)}</div>
          <div class="cal-caption">${esc(d.caption)}</div>
          <div class="cal-hashtags">${d.hashtags.map(h => `<span>${esc(h)}</span>`).join('')}</div>
          <div class="cal-copy"><button class="btn btn-ghost btn-sm copy-btn" data-copy="${esc(d.caption + ' ' + d.hashtags.join(' '))}">Copy caption</button></div>
        </div>
      </li>`).join('') + '</ul>';
    bindCopy();
  }

  // --- Render Voice -----------------------------------------------------------
  function renderVoice(data) {
    const body = $('#agent-voice-body');
    let audioHtml = '';
    if (data.audioUrl) {
      audioHtml = `
        <div class="voice-player">
          <audio controls src="${esc(data.audioUrl)}"></audio>
        </div>
        <div class="voice-actions">
          <a class="btn btn-ghost btn-sm" href="${esc(data.audioUrl)}" download="dropradar-hype-drop.mp3">⬇ Download MP3</a>
        </div>`;
    } else if (data.unavailable) {
      audioHtml = `<div class="voice-unavailable">${esc(data.unavailable)}</div>`;
    } else {
      audioHtml = '<div class="voice-unavailable">Voice generation is unavailable. Copy the script and record it, or add an ElevenLabs API key.</div>';
    }
    body.innerHTML = `
      <div class="voice-script">${esc(data.script)}</div>
      ${audioHtml}
      <div class="voice-actions">
        <button class="btn btn-ghost btn-sm copy-btn" data-copy="${esc(data.script)}">Copy script</button>
      </div>`;
    bindCopy();
  }

  // --- Render Leads -----------------------------------------------------------
  function renderLeads(leads) {
    const body = $('#agent-leads-body');
    body.innerHTML = leads.length
      ? '<ul class="lead-list">' + leads.map(l => `
        <li class="lead">
          <div class="lead-head">
            <span class="lead-name">${esc(l.name)}</span>
            <span class="lead-kind">${esc(l.kind)}</span>
            <span class="lead-score">${l.score}% fit</span>
          </div>
          <div class="lead-reasons">${l.reasons.map(r => esc(r)).join(' · ')}</div>
          <div class="lead-pitch">
            <div class="lead-subject">Subject: ${esc(l.pitch.subject)}</div>
            <div class="lead-body">${esc(l.pitch.body)}</div>
          </div>
          <div class="lead-actions">
            <button class="btn btn-ghost btn-sm copy-btn" data-copy="Subject: ${esc(l.pitch.subject)}\n\n${esc(l.pitch.body)}">Copy email</button>
          </div>
        </li>`).join('') + '</ul>'
      : '<p class="muted">No curator matches found for this genre and mood combination. Try different values.</p>';
    bindCopy();
  }

  // --- Try Demo Song --------------------------------------------------------
  const demoSongBtn = $('#demoSongBtn');
  if (demoSongBtn) {
    demoSongBtn.addEventListener('click', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 14);
      const dateStr = tomorrow.toISOString().slice(0, 10);

      $('#title').value = 'Neon Ghost';
      $('#artistName').value = user.artist_name || 'Luna Vale';
      $('#releaseDate').value = dateStr;
      $('#bpm').value = '118';
      $('#hometown').value = 'Brooklyn, NY';
      $('#soundsLike').value = 'Phoebe Bridgers meets MUNA';

      const genreSel = $('#genre');
      if (genreSel && genreSel.tagName === 'SELECT') {
        const options = Array.from(genreSel.options).map(o => o.value);
        genreSel.value = options.includes('Indie') ? 'Indie' : (options[1] || '');
      } else if (genreSel) {
        genreSel.value = 'Indie';
      }

      $$('input[name="moods"]').forEach(el => el.checked = false);
      ['Reflective', 'Moody', 'Confident'].forEach(target => {
        const el = $(`input[name="moods"][value="${target}"]`);
        if (el) el.checked = true;
      });

      showToast('Demo song loaded — press Run Agent Squad to start');
      $('#runAgentsBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // --- Copy to clipboard ------------------------------------------------------
  function bindCopy() {
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-copy');
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = btn.dataset.origLabel || 'Copy'; }, 1200);
        });
      });
      btn.dataset.origLabel = btn.textContent;
    });
  }

  // --- Toast ------------------------------------------------------------------
  function showToast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    setTimeout(() => { t.hidden = true; }, 3000);
  }

  // --- Helpers ----------------------------------------------------------------
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function fmtDate(iso) { const d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }

  // --- Logout -----------------------------------------------------------------
  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-DropRadar': '1' } });
    window.location.href = '/app';
  });
})();
