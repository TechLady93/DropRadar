// DropRadar API server.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { db, logSecurity } = require('./db');
const { seed } = require('./seed');
const E = require('./engine');

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
// In production set JWT_SECRET in the host's environment settings. Locally a
// random secret is generated per run, which simply logs everyone out on restart.
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
if (IS_PROD && !process.env.JWT_SECRET) console.warn('WARNING: JWT_SECRET is not set. Sessions reset on every restart.');

seed();
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

const app = express();
app.set('trust proxy', 1); // behind the hosting provider's proxy, so rate limits see the real IP
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: IS_PROD ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());

// --- Rate limits ---------------------------------------------------------------
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
const authLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many sign-in attempts from this network. Wait 15 minutes and try again.' }
});
const fanLimiter = rateLimit({
  windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many sign-ups from this network. Try again later.' }
});
app.use('/api/', apiLimiter);

// --- CSRF defence: state-changing API calls must carry a custom header.
// Browsers will not send custom headers cross-site without a CORS preflight,
// which this server never approves. Combined with SameSite=Strict cookies.
app.use('/api/', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('X-DropRadar') !== '1') {
    return res.status(403).json({ error: 'Request blocked.' });
  }
  next();
});

// --- Helpers -------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
const ip = req => req.ip || '';

// Links may only point at the platform they claim to be, over https.
// This stops the smart link from being used as an open redirect to phishing pages.
const LINK_HOSTS = {
  youtube: ['youtube.com', 'youtu.be', 'music.youtube.com'],
  bandcamp: ['bandcamp.com'],
  apple: ['music.apple.com', 'apple.co'],
  audiomack: ['audiomack.com'],
  soundcloud: ['soundcloud.com', 'on.soundcloud.com'],
  tiktok: ['tiktok.com'],
  spotify: ['open.spotify.com', 'spotify.link'],
  tidal: ['tidal.com', 'listen.tidal.com'],
  amazon: ['music.amazon.com', 'amazon.com']
};
function validLink(platform, url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return (LINK_HOSTS[platform] || []).some(h => host === h || host.endsWith('.' + h));
  } catch { return false; }
}

function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('dr_session', token, {
    httpOnly: true, sameSite: 'strict', secure: IS_PROD, maxAge: 7 * 24 * 3600 * 1000, path: '/'
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies.dr_session;
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, artist_name, role, is_demo FROM users WHERE id = ?').get(sub);
    if (!user) throw new Error('missing');
    req.user = user;
    next();
  } catch {
    res.clearCookie('dr_session');
    return res.status(401).json({ error: 'Your session ended. Sign in again.' });
  }
}

// Load a release only if it belongs to the signed-in user (prevents IDOR).
function ownRelease(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid release.' }); return null; }
  const r = db.prepare('SELECT * FROM releases WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!r) { res.status(404).json({ error: 'Release not found.' }); return null; }
  r.moods = JSON.parse(r.moods);
  r.links = JSON.parse(r.links);
  return r;
}

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'release';
}

// --- Auth ----------------------------------------------------------------------
app.post('/api/auth/signup', authLimiter, (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase();
  const password = String(req.body.password ?? '');
  const artist = clean(req.body.artistName, 60);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!artist) return res.status(400).json({ error: 'Enter your artist name.' });
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    return res.status(400).json({ error: 'Use a password of at least 10 characters with letters and numbers.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });
  const hash = bcrypt.hashSync(password, 12);
  const id = db.prepare('INSERT INTO users (email, password_hash, artist_name) VALUES (?, ?, ?)').run(email, hash, artist).lastInsertRowid;
  logSecurity(id, 'signup', '', ip(req));
  issueSession(res, { id });
  res.status(201).json({ ok: true });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase();
  const password = String(req.body.password ?? '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const generic = { error: 'That email and password do not match.' };
  // Run a hash comparison even for unknown emails so response time doesn't reveal which emails exist.
  if (!user) { bcrypt.compareSync(password, DUMMY_HASH); return res.status(401).json(generic); }
  if (user.locked_until && user.locked_until > Date.now()) {
    logSecurity(user.id, 'login_blocked_locked', '', ip(req));
    const mins = Math.ceil((user.locked_until - Date.now()) / 60000);
    return res.status(423).json({ error: `Too many failed attempts. This account is locked for ${mins} more minute${mins === 1 ? '' : 's'}.` });
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    const fails = user.failed_logins + 1;
    const lock = fails >= 5 ? Date.now() + 15 * 60_000 : null;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, user.id);
    logSecurity(user.id, lock ? 'account_locked' : 'login_failed', `attempt ${fails}`, ip(req));
    return res.status(401).json(generic);
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
  logSecurity(user.id, 'login_success', '', ip(req));
  issueSession(res, user);
  res.json({ ok: true });
});

app.post('/api/auth/demo', authLimiter, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('demo@dropradar.app');
  if (!user) return res.status(500).json({ error: 'Demo account is unavailable.' });
  logSecurity(user.id, 'demo_login', '', ip(req));
  issueSession(res, user);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('dr_session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

app.get('/api/meta', (req, res) => res.json({
  genres: E.GENRES, moods: E.MOODS, platforms: E.PLATFORMS, platformLabels: E.PLATFORM_LABELS
}));

// --- Releases ------------------------------------------------------------------
app.get('/api/releases', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT r.id, r.slug, r.title, r.release_type, r.release_date, r.genre, r.cover_color,
      (SELECT COUNT(*) FROM fans f WHERE f.release_id = r.id) AS fans,
      (SELECT COUNT(*) FROM clicks c WHERE c.release_id = r.id) AS clicks
    FROM releases r WHERE r.user_id = ? ORDER BY r.release_date DESC`).all(req.user.id);
  res.json({ releases: rows });
});

app.post('/api/releases', requireAuth, (req, res) => {
  const b = req.body || {};
  const title = clean(b.title, 100);
  const type = ['single', 'EP', 'album'].includes(b.releaseType) ? b.releaseType : 'single';
  const date = clean(b.releaseDate, 10);
  const genre = E.GENRES.includes(b.genre) ? b.genre : null;
  const moods = Array.isArray(b.moods) ? b.moods.filter(m => E.MOODS.includes(m)).slice(0, 3) : [];
  const bpm = b.bpm === '' || b.bpm == null ? null : Number(b.bpm);
  if (!title) return res.status(400).json({ error: 'Add the song title.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return res.status(400).json({ error: 'Pick a release date.' });
  if (!genre) return res.status(400).json({ error: 'Pick a genre.' });
  if (!moods.length) return res.status(400).json({ error: 'Pick at least one mood.' });
  if (bpm !== null && (!Number.isInteger(bpm) || bpm < 40 || bpm > 220)) return res.status(400).json({ error: 'BPM should be a whole number between 40 and 220.' });
  const links = {};
  for (const p of E.PLATFORMS) {
    const v = clean(b.links?.[p], 300);
    if (!v) continue;
    if (!validLink(p, v)) return res.status(400).json({ error: `The ${E.PLATFORM_LABELS[p]} link must be an https link on ${LINK_HOSTS[p][0]}.` });
    links[p] = v;
  }
  const color = /^#[0-9a-f]{6}$/i.test(b.coverColor) ? b.coverColor : '#2F4BFF';
  let slug = slugify(`${req.user.artist_name}-${title}`);
  while (db.prepare('SELECT 1 FROM releases WHERE slug = ?').get(slug)) slug = slug.slice(0, 42) + '-' + crypto.randomBytes(2).toString('hex');
  const id = db.prepare(`INSERT INTO releases (user_id, slug, title, release_type, release_date, genre, moods, bpm, sounds_like, hometown, story, links, cover_color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    req.user.id, slug, title, type, date, genre, JSON.stringify(moods), bpm,
    clean(b.soundsLike, 120), clean(b.hometown, 60), clean(b.story, 400), JSON.stringify(links), color
  ).lastInsertRowid;
  res.status(201).json({ id });
});

app.delete('/api/releases/:id', requireAuth, (req, res) => {
  const r = ownRelease(req, res); if (!r) return;
  if (req.user.is_demo) return res.status(403).json({ error: 'The demo release cannot be deleted. Create your own account to try this.' });
  db.prepare('DELETE FROM releases WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

app.get('/api/releases/:id', requireAuth, (req, res) => {
  const r = ownRelease(req, res); if (!r) return;
  const doneKeys = new Set(db.prepare('SELECT task_key FROM tasks_done WHERE release_id = ?').all(r.id).map(x => x.task_key));
  const outlets = db.prepare('SELECT * FROM outlets').all();
  const pitchRows = db.prepare('SELECT outlet_id, status FROM pitches WHERE release_id = ?').all(r.id);
  const pitchMap = Object.fromEntries(pitchRows.map(p => [p.outlet_id, p.status]));
  const matches = E.matchOutlets(r, outlets).map(o => ({ ...o, status: pitchMap[o.id] || null }));

  res.json({
    release: r,
    analysis: E.analyzeRelease(r),
    plan: E.buildPlan(r, doneKeys),
    matches,
    content: E.buildContent(r, req.user.artist_name),
    protection: E.PROTECTION_CHECKLIST.map(p => ({ ...p, done: doneKeys.has(p.key) })),
    results: buildResults(r),
    isDemo: !!req.user.is_demo
  });
});

app.post('/api/releases/:id/tasks/:key', requireAuth, (req, res) => {
  const r = ownRelease(req, res); if (!r) return;
  const key = clean(req.params.key, 40);
  if (!/^[a-z0-9_]+$/.test(key)) return res.status(400).json({ error: 'Invalid task.' });
  const done = !!req.body.done;
  if (done) db.prepare('INSERT OR IGNORE INTO tasks_done (release_id, task_key) VALUES (?, ?)').run(r.id, key);
  else db.prepare('DELETE FROM tasks_done WHERE release_id = ? AND task_key = ?').run(r.id, key);
  res.json({ ok: true });
});

app.get('/api/releases/:id/pitch/:outletId', requireAuth, (req, res) => {
  const r = ownRelease(req, res); if (!r) return;
  const outlet = db.prepare('SELECT * FROM outlets WHERE id = ?').get(Number(req.params.outletId));
  if (!outlet) return res.status(404).json({ error: 'Outlet not found.' });
  res.json(E.buildPitch(r, outlet, req.user.artist_name, `${req.protocol}://${req.get('host')}`));
});

const PITCH_STATES = ['draft', 'approved', 'sent', 'replied', 'added', 'passed'];
app.put('/api/releases/:id/pitch/:outletId', requireAuth, (req, res) => {
  const r = ownRelease(req, res); if (!r) return;
  const outletId = Number(req.params.outletId);
  if (!db.prepare('SELECT 1 FROM outlets WHERE id = ?').get(outletId)) return res.status(404).json({ error: 'Outlet not found.' });
  const status = req.body.status;
  if (status === null) {
    db.prepare('DELETE FROM pitches WHERE release_id = ? AND outlet_id = ?').run(r.id, outletId);
    return res.json({ ok: true });
  }
  if (!PITCH_STATES.includes(status)) return res.status(400).json({ error: 'Unknown pitch status.' });
  db.prepare(`INSERT INTO pitches (release_id, outlet_id, status) VALUES (?, ?, ?)
    ON CONFLICT(release_id, outlet_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`).run(r.id, outletId, status);
  res.json({ ok: true });
});

app.post('/api/scan', requireAuth, (req, res) => {
  const text = String(req.body.text ?? '');
  if (!text.trim()) return res.status(400).json({ error: 'Paste the message you received.' });
  const result = E.scanMessage(text);
  logSecurity(req.user.id, 'promoter_scan', result.verdict, ip(req));
  res.json(result);
});

app.get('/api/security-log', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT event, detail, created_at FROM security_log WHERE user_id = ? ORDER BY id DESC LIMIT 25').all(req.user.id);
  res.json({ events: rows });
});

// --- Results + anomaly detection -------------------------------------------------
function buildResults(r) {
  const byDay = db.prepare('SELECT day, COUNT(*) AS n FROM clicks WHERE release_id = ? GROUP BY day ORDER BY day').all(r.id);
  const byPlatform = db.prepare('SELECT platform, COUNT(*) AS n FROM clicks WHERE release_id = ? GROUP BY platform ORDER BY n DESC').all(r.id);
  const bySource = db.prepare('SELECT source, COUNT(*) AS n FROM clicks WHERE release_id = ? GROUP BY source ORDER BY n DESC').all(r.id);
  const fans = db.prepare('SELECT COUNT(*) AS n FROM fans WHERE release_id = ?').get(r.id).n;
  const fansBySource = db.prepare('SELECT source, COUNT(*) AS n FROM fans WHERE release_id = ? GROUP BY source ORDER BY n DESC').all(r.id);
  const pitchFunnel = db.prepare('SELECT status, COUNT(*) AS n FROM pitches WHERE release_id = ? GROUP BY status').all(r.id);
  const clicks = byDay.reduce((s, d) => s + d.n, 0);

  // Flag any day with more than 4x the trailing 7-day average (and at least 40 clicks).
  // A sudden spike like that is the pattern fake-stream campaigns leave behind.
  const alerts = [];
  byDay.forEach((d, i) => {
    const prev = byDay.slice(Math.max(0, i - 7), i);
    if (prev.length < 3) return;
    const avg = prev.reduce((s, x) => s + x.n, 0) / prev.length;
    if (d.n >= 40 && d.n > avg * 4) alerts.push({ day: d.day, count: d.n, average: Math.round(avg) });
  });
  return { clicks, fans, byDay, byPlatform, bySource, fansBySource, pitchFunnel, alerts };
}

// --- Public smart link -------------------------------------------------------------
app.get('/api/public/r/:slug', (req, res) => {
  const r = db.prepare(`SELECT r.slug, r.title, r.release_type, r.release_date, r.genre, r.links, r.cover_color, r.story, u.artist_name
    FROM releases r JOIN users u ON u.id = r.user_id WHERE r.slug = ?`).get(clean(req.params.slug, 80));
  if (!r) return res.status(404).json({ error: 'This release link does not exist.' });
  const links = JSON.parse(r.links);
  res.json({
    title: r.title, artist: r.artist_name, type: r.release_type, releaseDate: r.release_date,
    genre: r.genre, color: r.cover_color, story: r.story,
    platforms: Object.keys(links).map(p => ({ id: p, label: E.PLATFORM_LABELS[p] }))
  });
});

const SOURCES = ['tiktok', 'instagram', 'youtube', 'email', 'curator', 'x', 'facebook', 'direct'];
const srcOf = v => (SOURCES.includes(v) ? v : 'direct');

app.post('/api/public/r/:slug/fan', fanLimiter, (req, res) => {
  const r = db.prepare('SELECT id FROM releases WHERE slug = ?').get(clean(req.params.slug, 80));
  if (!r) return res.status(404).json({ error: 'This release link does not exist.' });
  if (req.body.website) return res.json({ ok: true }); // honeypot field: bots fill it, people never see it
  const email = clean(req.body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  db.prepare('INSERT OR IGNORE INTO fans (release_id, email, source) VALUES (?, ?, ?)').run(r.id, email, srcOf(req.body.source));
  res.json({ ok: true });
});

// Click-through: logs the platform, then redirects only to the link stored for this release.
app.get('/go/:slug/:platform', (req, res) => {
  const r = db.prepare('SELECT id, links FROM releases WHERE slug = ?').get(clean(req.params.slug, 80));
  const platform = clean(req.params.platform, 20);
  if (!r) return res.status(404).send('Not found');
  const url = JSON.parse(r.links)[platform];
  if (!url || !validLink(platform, url)) return res.status(404).send('Not found');
  db.prepare('INSERT INTO clicks (release_id, platform, source) VALUES (?, ?, ?)').run(r.id, platform, srcOf(req.query.src));
  res.redirect(302, url);
});

// --- Static front end --------------------------------------------------------------
const PUB = path.join(__dirname, '..', 'public');
app.use(express.static(PUB, { extensions: ['html'], maxAge: IS_PROD ? '1h' : 0 }));
app.get('/r/:slug', (req, res) => res.sendFile(path.join(PUB, 'link.html')));
app.get(['/app', '/app/*'], (req, res) => res.sendFile(path.join(PUB, 'app.html')));
app.use('/api/', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((req, res) => res.status(404).sendFile(path.join(PUB, '404.html')));

// Never leak stack traces to the browser.
app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
});

app.listen(PORT, () => console.log(`DropRadar running on http://localhost:${PORT}`));
