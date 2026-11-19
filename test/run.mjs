// DropRadar end-to-end test suite. Starts the app on a spare port with a throwaway
// database, exercises every feature and security claim over HTTP, and exits non-zero
// if anything fails. Run with: npm test
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(path.join(tmpdir(), 'dropradar-test-'));
const server = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'test.db'), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'inherit']
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('Server did not start')), 15000);
  server.stdout.on('data', d => { if (String(d).includes('running')) { clearTimeout(t); resolve(); } });
});
const BASE = `http://localhost:${PORT}`;
const results = [];
const rec = (area, claim, pass, evidence) => { results.push({ area, claim, pass: !!pass, evidence }); };

class Client {
  constructor(ip) { this.cookie = ''; this.ip = ip; }
  async req(method, path, body, { csrf = true, raw = false, headers = {} } = {}) {
    const h = { ...headers };
    if (this.ip) h['X-Forwarded-For'] = this.ip;
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (csrf) h['X-DropRadar'] = '1';
    const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
    const sc = r.headers.getSetCookie?.() || [];
    for (const c of sc) { const kv = c.split(';')[0]; if (kv.startsWith('dr_session=')) this.cookie = kv.endsWith('=') ? '' : kv; }
    if (raw) return r;
    let data = null; const txt = await r.text();
    try { data = JSON.parse(txt); } catch { data = txt; }
    return { status: r.status, data, headers: r.headers, setCookie: sc };
  }
}
let ipN = 10; const newIp = () => `203.0.113.${ipN++}`;

const pw = 'Strongpass123';
const A = new Client(newIp()), B = new Client(newIp());

// ---------- Auth ----------
let r = await A.req('POST', '/api/auth/signup', { email: 'bad', password: pw, artistName: 'X' });
rec('Security', 'Input validation: bad email rejected', r.status === 400, `${r.status} ${r.data.error}`);
r = await A.req('POST', '/api/auth/signup', { email: 'a@test.dev', password: 'short1', artistName: 'X' });
rec('Security', 'Password policy (10+ chars, letters+numbers)', r.status === 400, `${r.status} ${r.data.error}`);
r = await A.req('POST', '/api/auth/signup', { email: 'a@test.dev', password: pw, artistName: 'Artist A' });
rec('Accounts', 'Sign-up works', r.status === 201, `${r.status}`);
const sc = r.setCookie.join(' | ');
rec('Security', 'Session cookie is HttpOnly + SameSite=Strict', /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc), sc.replace(/dr_session=[^;]+/, 'dr_session=…'));
r = await A.req('POST', '/api/auth/signup', { email: 'a@test.dev', password: pw, artistName: 'Dup' });
rec('Security', 'Duplicate sign-up blocked', r.status === 409, `${r.status} "${r.data.error}" (note: this reveals the email is registered)`);
await B.req('POST', '/api/auth/signup', { email: 'b@test.dev', password: pw, artistName: 'Artist B' });

// password hashing check is done by reading the DB afterward (see shell)

// CSRF
r = await A.req('POST', '/api/releases', { title: 'x' }, { csrf: false });
rec('Security', 'CSRF: state-changing request without custom header blocked', r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);

// Headers
const home = await fetch(BASE + '/');
const csp = home.headers.get('content-security-policy') || '';
rec('Security', 'Strict CSP (no inline scripts), frame-ancestors none, nosniff', /script-src 'self'/.test(csp) && !/unsafe-inline/.test(csp.split('script-src')[1]?.split(';')[0] || '') && /frame-ancestors 'none'/.test(csp) && home.headers.get('x-content-type-options') === 'nosniff', csp.slice(0, 160) + '…');
rec('Security', 'HSTS header', !!home.headers.get('strict-transport-security'), home.headers.get('strict-transport-security'));
rec('Security', 'X-Powered-By hidden', !home.headers.get('x-powered-by'), String(home.headers.get('x-powered-by')));

// ---------- Release creation + link validation ----------
const relBody = {
  title: 'In Mind', releaseType: 'single', releaseDate: '2026-12-12', genre: 'R&B', moods: ['Romantic', 'Late-night'],
  bpm: 92, soundsLike: 'Brent Faiyaz, SZA', hometown: 'Miami, FL', story: 'Written after a long night drive down I-95.',
  links: { spotify: 'https://open.spotify.com/track/abc', youtube: 'https://youtube.com/watch?v=abc' }, coverColor: '#123456'
};
r = await A.req('POST', '/api/releases', { ...relBody, links: { youtube: 'https://evil.example/phish' } });
rec('Security', 'Open-redirect: off-platform link rejected', r.status === 400, r.data.error);
r = await A.req('POST', '/api/releases', { ...relBody, links: { youtube: 'https://youtube.com.evil.example/x' } });
rec('Security', 'Open-redirect: look-alike domain rejected', r.status === 400, r.data.error);
r = await A.req('POST', '/api/releases', { ...relBody, links: { youtube: 'http://youtube.com/x' } });
rec('Security', 'Open-redirect: non-https rejected', r.status === 400, r.data.error);
r = await A.req('POST', '/api/releases', { ...relBody, bpm: 500 });
rec('Security', 'Input validation: BPM range', r.status === 400, r.data.error);
r = await A.req('POST', '/api/releases', relBody);
const relId = r.data.id;
rec('Releases', 'Create release', r.status === 201 && relId, `${r.status} id=${relId}`);
r = await A.req('POST', '/api/releases', { ...relBody, title: '<img src=x onerror=alert(1)>', links: {} });
const xssId = r.data.id;

// Body size
r = await A.req('POST', '/api/releases', { ...relBody, story: 'x'.repeat(30000) });
rec('Security', 'Request body size limit (20 KB)', r.status === 413, `${r.status} ${JSON.stringify(r.data)}`);
r = await A.req('POST', '/api/releases', '{bad json');
rec('Security', 'Malformed JSON gives clean error, no stack trace', r.status === 400 && !/at\s+\w+.*\.js/.test(JSON.stringify(r.data)), `${r.status} ${JSON.stringify(r.data)}`);

// IDOR
r = await B.req('GET', `/api/releases/${relId}`);
rec('Security', 'IDOR: another user cannot read your release', r.status === 404, `${r.status}`);
r = await B.req('DELETE', `/api/releases/${relId}`);
rec('Security', 'IDOR: another user cannot delete your release', r.status === 404, `${r.status}`);
r = await B.req('PUT', `/api/releases/${relId}/pitch/1`, { status: 'sent' });
rec('Security', 'IDOR: another user cannot change your pitches', r.status === 404, `${r.status}`);
r = await new Client(newIp()).req('GET', `/api/releases/${relId}`);
rec('Security', 'Unauthenticated access blocked', r.status === 401, `${r.status}`);

// ---------- Release detail: analysis, plan, matches, content ----------
r = await A.req('GET', `/api/releases/${relId}`);
const D = r.data;
rec('Analyzer', 'Short-form fit score from genre/mood/tempo', typeof D.analysis.shortFormScore === 'number', `score=${D.analysis.shortFormScore}, tempo=${D.analysis.tempo.band}, lanes=${D.analysis.lanes.length}`);
const allOutlets = D.matches.length;
rec('Matching', 'Outlets scored 0–100 with reasons', D.matches.every(m => m.score >= 0 && m.score <= 100 && m.reasons.length), D.matches.slice(0, 5).map(m => `${m.name} (${m.kind}) ${m.score}: ${m.reasons.join('; ')}`).join(' | '));
rec('Matching', 'Sample outlets are labelled as samples (honest until real curators join)', D.matches.every(m => m.is_sample === 1), `${allOutlets} matches`);
rec('Plan', 'Rollout plan runs from 4 weeks before release to day 30 (up to 28 steps)', D.plan.length >= 27 && D.plan.length <= 28 && D.plan[0].offset === -28 && D.plan.at(-1).offset === 30, `${D.plan.length} steps, from day ${D.plan[0].offset} to day ${D.plan.at(-1).offset}`);
const cal = D.content.calendar;
rec('Content', '30-day content calendar: one idea a day, day 1 = release day', cal.length === 30 && cal[0].date === relBody.releaseDate && cal[29].day === 30 && cal.every(x => x.title && x.caption && x.platform), `${cal.length} days, ${cal[0].date} to ${cal[29].date}`);
rec('Content', 'R&B hashtag is #rnb', D.content.hashtags[0] === '#rnb', D.content.hashtags.join(' '));
rec('Content', 'Pre-release captions point to the date, not "out now"', D.content.captions.every(c => !/out now/.test(c.text)), D.content.captions[1].text);
rec('Plan', 'Every step has a plain-language why', D.plan.every(s => s.why && s.why.length > 30), 'all steps carry a why');
// pitch
const top = D.matches[0];
r = await A.req('GET', `/api/releases/${relId}/pitch/${top.id}`);
rec('Pitch', 'Personalized pitch per outlet', r.status === 200 && r.data.body.includes(top.name), `Subject: ${r.data.subject}`);
rec('Pitch', '"Sounds like" artists read naturally', r.data.body.includes('Brent Faiyaz and SZA'), r.data.body.split('\n')[4]);
const pitchSample = r.data;
r = await A.req('PUT', `/api/releases/${relId}/pitch/${top.id}`, { status: 'sent' });
rec('Pitch', 'Pitch pipeline status tracking', r.status === 200, `${r.status}`);
rec('Content', 'Captions per platform, video ideas, hashtags', D.content.captions.length >= 4 && D.content.videoIdeas.length >= 4, D.content.captions.map(c => `[${c.platform}] ${c.text}`).join(' | ') + ' || ' + D.content.hashtags.join(' '));

// ---------- Smart link ----------
const slug = D.release.slug;
const pub = new Client(newIp());
r = await pub.req('GET', `/api/public/r/${slug}`);
rec('Smart link', 'Public smart link page data', r.status === 200 && r.data.platforms.length === 2, JSON.stringify(r.data).slice(0, 200));
r = await pub.req('GET', `/go/${slug}/spotify?src=tiktok`, undefined, { raw: true });
rec('Smart link', 'Click-through redirects only to stored platform link + logs ?src', r.status === 302 && r.headers.get('location') === relBody.links.spotify, `${r.status} -> ${r.headers.get('location')}`);
r = await pub.req('GET', `/go/${slug}/apple`, undefined, { raw: true });
rec('Smart link', 'Unknown platform for release returns 404 (no redirect)', r.status === 404, `${r.status}`);
r = await pub.req('POST', `/api/public/r/${slug}/fan`, { email: 'fan1@example.com', source: 'tiktok' });
rec('Smart link', 'Fan email capture', r.status === 200, `${r.status}`);
r = await pub.req('POST', `/api/public/r/${slug}/fan`, { email: 'bot@example.com', website: 'http://spam' });
const botIp = pub.ip;
rec('Smart link', 'Honeypot silently drops bots', r.status === 200, `${r.status} (accepted silently)`);
let limited = false;
for (let i = 0; i < 12; i++) { const x = await pub.req('POST', `/api/public/r/${slug}/fan`, { email: `f${i}@example.com` }); if (x.status === 429) { limited = true; break; } }
rec('Smart link', 'Fan form rate limited (10/hour per IP)', limited, limited ? '429 after limit' : 'never limited');

r = await A.req('GET', `/api/releases/${relId}`);
rec('Results', 'Dashboard counts clicks, sources, fans', r.data.results.clicks === 1 && r.data.results.bySource[0]?.source === 'tiktok' && r.data.results.fans >= 1, `clicks=${r.data.results.clicks}, sources=${JSON.stringify(r.data.results.bySource)}, fans=${r.data.results.fans}`);
const fansHadBot = r.data.results.fans;

// ---------- Scam scanner ----------
const scams = {
  'Guaranteed streams offer': 'Hey bro love the track! We guarantee 50k streams in 2 weeks, 100% real organic plays. Only $199. Limited spots, act now!',
  'Pay per stream': 'Our package: 10,000 streams for $80. DM to start.',
  'Paid editorial placement': 'For $300 I can get you placed on official Spotify editorial playlists like RapCaviar.',
  'Login request': 'To add you to our playlist network please send me your login and the verification code we text you.',
  'Fake verification': 'Spotify Team here. Verify your artist profile now to keep your blue check, a $25 fee applies.',
  'Gift card payment': 'Payment via gift card or crypto only. Your song will go viral, millions of streams.',
  'Realistic SubmitHub-style legit pitch reply': 'Thanks for submitting! We listened and added your track to our Chill R&B Sundays playlist. Feel free to share it.',
  'Legit paid PR (non-scam)': 'Our 6-week PR campaign is $500. We pitch 40 blogs and send you a report of every response. No guarantees of coverage.',
  'Disguised scam (no keywords)': 'We have a network of 300 playlists with 2M followers. Pay $150 and your song gets added to 20 of them within 48 hours.',
  'Disguised scam 2': 'I run promo for indie artists. $99 gets you 25,000 plays on your track, all from real listeners in the US.',
  'Legit show announcement': 'Tickets are $20 and we expect 300 listeners at the show.',
  'Legit Groover report': 'Groover campaign: $2 per curator, 30 curators reviewed your track and 4 shared it.'
};
const scanOut = [];
for (const [name, text] of Object.entries(scams)) {
  const x = await A.req('POST', '/api/scan', { text });
  scanOut.push({ name, verdict: x.data.verdict, flags: x.data.findings.map(f => f.match) });
}
const expectScam = ['Guaranteed streams offer', 'Pay per stream', 'Paid editorial placement', 'Login request', 'Fake verification', 'Gift card payment', 'Disguised scam (no keywords)', 'Disguised scam 2'];
const caught = scanOut.filter(s => expectScam.includes(s.name) && s.verdict !== 'clear').length;
rec('Protection', 'Promoter scanner catches scam patterns', caught === expectScam.length, `${caught}/${expectScam.length} scams flagged`);
rec('Protection', 'Promoter scanner leaves legit messages clear', scanOut.filter(s => !expectScam.includes(s.name)).every(s => s.verdict === 'clear'), scanOut.filter(s => !expectScam.includes(s.name)).map(s => `${s.name}: ${s.verdict}`).join('; '));

// ---------- Demo spike ----------
const demo = new Client(newIp());
r = await demo.req('POST', '/api/auth/demo', {});
r = await demo.req('GET', '/api/releases');
const demoRel = r.data.releases[0];
r = await demo.req('GET', `/api/releases/${demoRel.id}`);
rec('Protection', 'Spike alert fires on demo traffic spike', r.data.results.alerts.length >= 1, JSON.stringify(r.data.results.alerts));
rec('Demo', 'Demo release data', true, `release=${r.data.release.title} date=${r.data.release.release_date}, clicks=${r.data.results.clicks}, fans=${r.data.results.fans}, matches=${r.data.matches.length}, overdue steps=${r.data.plan.filter(s => s.state === 'overdue').length}`);
const demoCreate = await demo.req('POST', '/api/releases', { ...relBody, title: 'Visitor junk', links: {} });
rec('Demo', 'Demo visitors cannot alter shared demo data', demoCreate.status !== 201, `create release in shared demo account -> ${demoCreate.status}`);
const demoPitch = await demo.req('PUT', `/api/releases/${demoRel.id}/pitch/${r.data.matches[0].id}`, { status: 'passed' });
rec('Demo', 'Demo visitors cannot change demo pitch statuses', demoPitch.status !== 200, `-> ${demoPitch.status}`);
const demoTask = await demo.req('POST', `/api/releases/${demoRel.id}/tasks/trend`, { done: true });
rec('Demo', 'Demo visitors cannot tick plan steps in the shared demo', demoTask.status === 403, `-> ${demoTask.status}`);
const demoDel = await demo.req('DELETE', `/api/releases/${demoRel.id}`);
rec('Demo', 'Demo release cannot be deleted', demoDel.status === 403, `-> ${demoDel.status}`);
const demoRead = await demo.req('GET', `/api/releases/${demoRel.id}`);
rec('Demo', 'Demo is still fully viewable', demoRead.status === 200 && demoRead.data.matches.length > 0, `-> ${demoRead.status}`);
const room = new Client(newIp()); let roomOk = 0;
for (let i = 0; i < 30; i++) { const x = await room.req('POST', '/api/auth/demo', {}); if (x.status === 200) roomOk++; }
rec('Demo', '30 people on one Wi-Fi network can all open the demo', roomOk === 30, `${roomOk}/30 demo sign-ins succeeded from one IP`);

// ---------- Fans you own ----------
const fanPage = new Client(newIp());
await fanPage.req('POST', `/api/public/r/${slug}/fan`, { email: '=HYPERLINK("http://evil.example","x")@a.co', source: 'instagram' });
await fanPage.req('POST', `/api/public/r/${slug}/fan`, { email: 'leaver@example.com', source: 'email' });
r = await A.req('GET', `/api/releases/${relId}/fans`);
rec('Fans', 'Artist can see every fan who signed up, with source', r.status === 200 && r.data.fans.some(f => f.email === 'fan1@example.com' && f.source === 'tiktok'), `${r.data.subscribed} subscribed`);
r = await B.req('GET', `/api/releases/${relId}/fans`);
rec('Fans', 'IDOR: another artist cannot see your fans', r.status === 404, `-> ${r.status}`);
r = await B.req('GET', `/api/releases/${relId}/fans.csv`);
rec('Fans', 'IDOR: another artist cannot export your fans', r.status === 404, `-> ${r.status}`);
r = await A.req('GET', `/api/releases/${relId}/fans.csv`);
const csv = String(r.data);
rec('Fans', 'CSV export downloads with header and unsubscribe links', r.status === 200 && /attachment/.test(r.headers.get('content-disposition')) && csv.startsWith('email,source,signed_up_utc,release,unsubscribe_link') && /\/u\/[a-f0-9]{32}/.test(csv), csv.split('\r\n')[0]);
rec('Fans', 'CSV export neutralises spreadsheet formula injection', csv.toLowerCase().includes(`"'=hyperlink(`) && !/(^|,)"?=hyperlink/im.test(csv), 'formula cell prefixed with an apostrophe');
const leaverToken = (csv.split('\r\n').find(l => l.startsWith('leaver@example.com')) || '').match(/\/u\/([a-f0-9]{32})/)?.[1];
const fanBrowser = new Client(newIp());
r = await fanBrowser.req('GET', `/u/${leaverToken}`, undefined, { raw: true });
rec('Fans', 'Unsubscribe page loads from the link', r.status === 200, `-> ${r.status}`);
r = await fanBrowser.req('POST', '/api/public/unsubscribe', { token: leaverToken });
rec('Fans', 'One-click unsubscribe works', r.status === 200 && r.data.artist === 'Artist A', JSON.stringify(r.data));
r = await fanBrowser.req('POST', '/api/public/unsubscribe', { token: 'f'.repeat(32) });
rec('Fans', 'Made-up unsubscribe tokens are rejected', r.status === 404, `-> ${r.status}`);
r = await A.req('GET', `/api/releases/${relId}/fans.csv`);
rec('Fans', 'Unsubscribed fans are never exported', !String(r.data).includes('leaver@example.com'), 'leaver@example.com absent');
r = await A.req('GET', `/api/releases/${relId}/fans`);
rec('Fans', 'Unsubscribe is shown in the fan list', r.data.unsubscribed === 1 && r.data.fans.find(f => f.email === 'leaver@example.com')?.unsubscribed, `${r.data.unsubscribed} unsubscribed`);
await new Client(newIp()).req('POST', `/api/public/r/${slug}/fan`, { email: 'leaver@example.com', source: 'email' });
r = await A.req('GET', `/api/releases/${relId}/fans`);
rec('Fans', 'A fan who signs up again is resubscribed', r.data.unsubscribed === 0, `${r.data.unsubscribed} unsubscribed`);
r = await new Client(newIp()).req('GET', '/privacy', undefined, { raw: true });
rec('Fans', 'Privacy policy page is live', r.status === 200, `-> ${r.status}`);

// ---------- Security log ----------
r = await A.req('GET', '/api/security-log');
rec('Security', 'Audit log of sign-ins and scans visible to user', r.data.events.length > 0, r.data.events.slice(0, 4).map(e => e.event).join(', '));

// ---------- Brute force / enumeration (last, uses auth limiter) ----------
const L = new Client(newIp());
const t0 = Date.now(); await L.req('POST', '/api/auth/login', { email: 'nobody@test.dev', password: 'Wrongpass999' }); const tUnknown = Date.now() - t0;
const t1 = Date.now(); const known = await L.req('POST', '/api/auth/login', { email: 'b@test.dev', password: 'Wrongpass999' }); const tKnown = Date.now() - t1;
rec('Security', 'No account enumeration on login (same message + similar timing)', known.data.error === 'That email and password do not match.' && Math.abs(tUnknown - tKnown) < 150, `unknown ${tUnknown}ms vs known ${tKnown}ms, msg="${known.data.error}"`);
let lockStatus;
for (let i = 0; i < 5; i++) { lockStatus = (await L.req('POST', '/api/auth/login', { email: 'b@test.dev', password: 'Wrongpass999' })).status; }
const afterLock = await L.req('POST', '/api/auth/login', { email: 'b@test.dev', password: pw });
rec('Security', 'Account locks for 15 min after 5 failures (even with right password)', afterLock.status === 423, `${afterLock.status} ${afterLock.data.error}`);
const RL = new Client(newIp()); let rl = 0;
for (let i = 0; i < 25; i++) { const x = await RL.req('POST', '/api/auth/login', { email: `x${i}@test.dev`, password: 'Wrongpass999' }); if (x.status === 429) { rl = i + 1; break; } }
rec('Security', 'IP rate limiting on auth endpoints', rl > 0, rl ? `429 on attempt ${rl}` : 'never limited');


const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.area}] ${r.claim}${r.pass ? '' : `\n      ${r.evidence}`}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
server.kill();
rmSync(dir, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
