// DropRadar engine: release analysis, outlet matching, rollout plan, pitch and
// content generation, and the scam-promoter scanner.
// Everything is rule-based so the app runs free with no AI API key. Each
// function is a clean seam where a hosted model can be swapped in later.

const GENRES = [
  'Hip-Hop', 'R&B', 'Afrobeats', 'Amapiano', 'Pop', 'Dancehall', 'Gospel',
  'Neo-Soul', 'Alternative', 'Indie', 'Electronic', 'House', 'Latin', 'Reggaeton',
  'Jazz', 'Rock', 'Country', 'Lo-fi', 'Drill', 'Trap'
];

const MOODS = [
  'Uplifting', 'Romantic', 'Late-night', 'Energetic', 'Chill', 'Reflective',
  'Party', 'Spiritual', 'Moody', 'Confident', 'Summer', 'Heartbreak'
];

const PLATFORMS = ['youtube', 'bandcamp', 'apple', 'audiomack', 'soundcloud', 'tiktok', 'spotify', 'tidal', 'amazon'];
const PLATFORM_LABELS = {
  youtube: 'YouTube', bandcamp: 'Bandcamp', apple: 'Apple Music', audiomack: 'Audiomack',
  soundcloud: 'SoundCloud', tiktok: 'TikTok', spotify: 'Spotify', tidal: 'TIDAL', amazon: 'Amazon Music'
};

// Genres that sit close together, so a curator of one is a reasonable fit for another.
const NEIGHBORS = {
  'Hip-Hop': ['Trap', 'Drill', 'R&B'], 'Trap': ['Hip-Hop', 'Drill'], 'Drill': ['Hip-Hop', 'Trap'],
  'R&B': ['Neo-Soul', 'Hip-Hop', 'Pop'], 'Neo-Soul': ['R&B', 'Jazz', 'Gospel'],
  'Afrobeats': ['Amapiano', 'Dancehall', 'R&B'], 'Amapiano': ['Afrobeats', 'House'],
  'Dancehall': ['Afrobeats', 'Reggaeton'], 'Reggaeton': ['Latin', 'Dancehall'], 'Latin': ['Reggaeton', 'Pop'],
  'Pop': ['R&B', 'Indie', 'Electronic'], 'Indie': ['Alternative', 'Pop', 'Rock'],
  'Alternative': ['Indie', 'Rock'], 'Rock': ['Alternative', 'Indie'],
  'Electronic': ['House', 'Pop', 'Lo-fi'], 'House': ['Electronic', 'Amapiano'],
  'Gospel': ['Neo-Soul', 'R&B'], 'Jazz': ['Neo-Soul', 'Lo-fi'], 'Lo-fi': ['Jazz', 'Electronic'],
  'Country': ['Rock', 'Indie']
};

function tempoBand(bpm) {
  if (!bpm) return { band: 'Unknown', label: 'Add a BPM for tighter matching' };
  if (bpm < 85) return { band: 'Slow', label: 'Slow, suited to late-night and mood playlists' };
  if (bpm < 110) return { band: 'Mid', label: 'Mid-tempo, the sweet spot for most editorial lists' };
  if (bpm < 128) return { band: 'Upbeat', label: 'Upbeat, works for workout and party lists' };
  return { band: 'Fast', label: 'Fast, strong for dance, club and short-form video' };
}

// Short-form video fit: how naturally the track lends itself to TikTok / Reels / Shorts.
function shortFormScore(release) {
  let s = 50;
  const moods = release.moods || [];
  if (['Energetic', 'Party', 'Confident', 'Summer'].some(m => moods.includes(m))) s += 18;
  if (['Afrobeats', 'Amapiano', 'Dancehall', 'Drill', 'Reggaeton', 'House', 'Pop'].includes(release.genre)) s += 15;
  if (release.bpm && release.bpm >= 95 && release.bpm <= 130) s += 10;
  if (['Reflective', 'Heartbreak', 'Romantic'].some(m => moods.includes(m))) s += 5; // storytelling trends
  return Math.min(98, s);
}

function analyzeRelease(release) {
  const tempo = tempoBand(release.bpm);
  const sf = shortFormScore(release);
  const neighbors = NEIGHBORS[release.genre] || [];
  const lanes = [];
  if (sf >= 70) lanes.push('Short-form video first: build the rollout around a 7 to 15 second hook.');
  else lanes.push('Lead with playlists, blogs and YouTube; use short-form video for story and behind-the-scenes.');
  if (['Afrobeats', 'Amapiano', 'Hip-Hop', 'Drill', 'Dancehall', 'Trap'].includes(release.genre))
    lanes.push('Audiomack and YouTube are strong discovery platforms for this genre.');
  if (['Indie', 'Alternative', 'Electronic', 'Jazz', 'Lo-fi', 'Rock'].includes(release.genre))
    lanes.push('Bandcamp and SoundCloud communities reward this sound; push direct sales there.');
  if ((release.moods || []).includes('Spiritual') || release.genre === 'Gospel')
    lanes.push('Church media teams, faith radio and worship creators are your core outlets.');
  if (release.hometown) lanes.push(`Start local: ${release.hometown} blogs, DJs and radio carry more weight than global lists early on.`);
  return {
    tempo,
    shortFormScore: sf,
    neighborGenres: neighbors,
    lanes,
    hookTip: sf >= 70
      ? 'Pick the 10 seconds people will want to dance or lip-sync to and use that exact clip everywhere.'
      : 'Pick the most quotable lyric and build text-on-screen videos around it.'
  };
}

// Score how well an outlet fits a release. Returns 0 to 100 with reasons.
function scoreOutlet(release, outlet) {
  const genres = JSON.parse(outlet.genres);
  const moods = JSON.parse(outlet.moods);
  const reasons = [];
  let score = 0;
  if (genres.includes(release.genre)) { score += 55; reasons.push(`Covers ${release.genre}`); }
  else {
    const near = (NEIGHBORS[release.genre] || []).filter(g => genres.includes(g));
    if (near.length) { score += 30; reasons.push(`Covers neighbouring ${near.join(', ')}`); }
  }
  const sharedMoods = (release.moods || []).filter(m => moods.includes(m));
  if (sharedMoods.length) { score += Math.min(25, sharedMoods.length * 12); reasons.push(`${sharedMoods.join(', ')} mood`); }
  if (release.hometown && outlet.region && outlet.region !== 'Global' &&
      release.hometown.toLowerCase().includes(outlet.region.toLowerCase().split(',')[0])) {
    score += 15; reasons.push('Local to your market');
  }
  // Smaller outlets reply more often to new artists; nudge them up.
  if (outlet.reach > 0 && outlet.reach < 15000) { score += 5; reasons.push('Small enough to answer new artists'); }
  return { score: Math.min(100, score), reasons };
}

function matchOutlets(release, outlets, limit = 24) {
  return outlets
    .map(o => ({ ...o, genres: JSON.parse(o.genres), moods: JSON.parse(o.moods), ...scoreOutlet(release, o) }))
    .filter(o => o.score >= 30)
    .sort((a, b) => b.score - a.score || a.reach - b.reach)
    .slice(0, limit);
}

// The 30-day rollout. Offsets are days relative to release day (0).
// Every step carries a short "why" so artists learn the reasoning, not just the task.
const PLAN_TEMPLATE = [
  { key: 'distro', d: -28, ch: 'Setup', t: 'Upload the release to your distributor', why: 'Editorial teams at Apple, Amazon and Spotify can only consider a song once it is delivered. Four weeks gives every store time to process it.' },
  { key: 'secure', d: -27, ch: 'Protect', t: 'Lock down your artist accounts', why: 'Turn on two-factor login for your distributor, socials and every artist dashboard. Account takeovers spike around releases because that is when a stolen login is worth the most.' },
  { key: 'splits', d: -26, ch: 'Setup', t: 'Confirm credits, splits and ISRC', why: 'Correct songwriter and producer credits get you paid and make you searchable. Fixing them after release is slow.' },
  { key: 'assets', d: -24, ch: 'Content', t: 'Make the asset kit', why: 'Cover art, a vertical 9:16 version, three short clips of the hook and two photos. Every later step pulls from this kit.' },
  { key: 'smartlink', d: -21, ch: 'Fans', t: 'Publish your DropRadar smart link', why: 'One link for every bio and post. It collects fan emails before release, so you own the relationship instead of renting it from an app.' },
  { key: 'editorial', d: -21, ch: 'Pitch', t: 'Pitch editorial from your artist dashboards', why: 'Spotify for Artists, Apple and Amazon only accept pitches from the artist or label account, and only before release day. Write the story in two sentences: who you are and why this song exists.' },
  { key: 'announce', d: -18, ch: 'Content', t: 'Announce the release', why: 'Post the cover and date. Ask for one thing only: tap the smart link to get notified.' },
  { key: 'curators1', d: -14, ch: 'Pitch', t: 'Send the first wave of curator pitches', why: 'Independent curators and blogs plan a week or two ahead. Send to your top 10 matches first, each one personalised.' },
  { key: 'tease1', d: -12, ch: 'Content', t: 'Post hook teaser #1', why: 'Short-form platforms test a clip with a small audience first. Posting the same hook several times tells you which version travels.' },
  { key: 'creators', d: -10, ch: 'Pitch', t: 'Seed the sound with five small creators', why: 'Creators with 2k to 20k followers in your niche are more likely to use a new sound and their audiences engage more.' },
  { key: 'tease2', d: -7, ch: 'Content', t: 'Post hook teaser #2 with a different visual', why: 'Same audio, new visual. Repetition is how a sound becomes familiar before it is even out.' },
  { key: 'local', d: -6, ch: 'Pitch', t: 'Reach out to local DJs, radio and blogs', why: 'Local support is easier to win and gives you a real story to tell bigger outlets.' },
  { key: 'curators2', d: -4, ch: 'Pitch', t: 'Follow up once with first-wave curators', why: 'One polite follow-up is professional. More than one is spam.' },
  { key: 'countdown', d: -1, ch: 'Content', t: 'Countdown post and go live', why: 'Remind the people who signed up. A live session or story the night before gathers your first listeners in one place.' },
  { key: 'release', d: 0, ch: 'Fans', t: 'Release day: email your fan list', why: 'Your signed-up fans are your most reliable first listeners. Early saves and replays from real fans are the signals every platform algorithm watches.' },
  { key: 'yt', d: 0, ch: 'Content', t: 'Post the visualizer or video on YouTube', why: 'YouTube keeps working for months and builds subscribers you keep. Add the song to YouTube Shorts audio too.' },
  { key: 'bandcamp', d: 0, ch: 'Fans', t: 'Open Bandcamp sales', why: 'Fans who buy give you the most money per listener and their email address.' },
  { key: 'thank', d: 1, ch: 'Content', t: 'Thank-you post with first reactions', why: 'Share screenshots of fan messages. Social proof makes the next wave more likely to listen.' },
  { key: 'curators3', d: 2, ch: 'Pitch', t: 'Send the second wave of curator pitches', why: 'Some curators only accept released songs. Now you can include early reactions.' },
  { key: 'trend', d: 4, ch: 'Content', t: 'Start a simple trend or challenge', why: 'Give people an easy reason to use your sound: a dance step, a lyric prompt, a duet.' },
  { key: 'scan', d: 5, ch: 'Protect', t: 'Check your stats for anything suspicious', why: 'A sudden spike from one country or one playlist you never pitched can be fake streams. Report it to your distributor early so the song is not penalised.' },
  { key: 'bts', d: 7, ch: 'Content', t: 'Behind-the-scenes post', why: 'How the song was made, who you made it with. Story content brings back people who scrolled past the first time.' },
  { key: 'review', d: 10, ch: 'Results', t: 'Week-one review', why: 'Look at which link, clip and outlet brought real listeners. Do more of what worked and drop what did not.' },
  { key: 'acoustic', d: 14, ch: 'Content', t: 'Alternate version or live performance clip', why: 'A stripped-down or live version gives curators and creators a fresh reason to share.' },
  { key: 'fanmail', d: 16, ch: 'Fans', t: 'Second fan email', why: 'Tell fans what happened in week one and ask them to share with one friend.' },
  { key: 'collab', d: 20, ch: 'Pitch', t: 'Pitch a remix or feature', why: 'A remix with another artist reaches their audience and restarts the release cycle.' },
  { key: 'local2', d: 24, ch: 'Fans', t: 'Book a local performance or listening party', why: 'People who see you live become your strongest supporters online.' },
  { key: 'final', d: 30, ch: 'Results', t: '30-day results report', why: 'Compare listeners, fans gained and outlets that responded. This report decides what you change for the next release.' }
];

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildPlan(release, doneKeys = new Set(), today = new Date().toISOString().slice(0, 10)) {
  const sf = shortFormScore(release);
  return PLAN_TEMPLATE
    .filter(step => !(step.key === 'trend' && sf < 60))
    .map(step => {
      const date = addDays(release.release_date, step.d);
      const done = doneKeys.has(step.key);
      let state = 'upcoming';
      if (done) state = 'done';
      else if (date < today) state = 'overdue';
      else if (date === today) state = 'today';
      return { key: step.key, offset: step.d, date, channel: step.ch, title: step.t, why: step.why, state };
    });
}

function list(arr) {
  if (arr.length <= 1) return arr.join('');
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}

function buildPitch(release, outlet, artistName, baseUrl) {
  const moods = (release.moods || []).slice(0, 2).map(m => m.toLowerCase());
  const kindLine = {
    playlist: `I think it fits the ${outlet.name} playlist`,
    blog: `I think it would suit what ${outlet.name} covers`,
    creator: `I think it could work as a sound for your videos`,
    dj: `I think it would work in your sets`,
    community: `I think the ${outlet.name} community would connect with it`,
    radio: `I think it would fit your rotation`
  }[outlet.kind] || 'I think it is a fit';
  const link = `${process.env.PUBLIC_URL || baseUrl || 'http://localhost:3000'}/r/${release.slug}`;
  const subject = `${release.genre} ${release.release_type}: "${release.title}" by ${artistName}`;
  const body = [
    `Hi ${outlet.name} team,`,
    '',
    `I'm ${artistName}${release.hometown ? `, an artist from ${release.hometown}` : ''}. My new ${release.release_type}, "${release.title}", ${release.release_date >= new Date().toISOString().slice(0, 10) ? 'comes out' : 'came out'} on ${formatDate(release.release_date)}.`,
    '',
    `It's a ${moods.length ? list(moods) + ' ' : ''}${release.genre} record${release.bpm ? ` at ${release.bpm} BPM` : ''}${release.sounds_like ? `, for fans of ${release.sounds_like}` : ''}. ${kindLine}.`,
    release.story ? '' : null,
    release.story ? release.story : null,
    '',
    `Listen here: ${link}`,
    '',
    `Thanks for taking a listen. No pressure either way.`,
    artistName
  ].filter(l => l !== null).join('\n');
  return { subject, body };
}

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function buildContent(release, artistName) {
  const t = release.title;
  const mood = (release.moods && release.moods[0] || '').toLowerCase();
  const tag = release.genre.replace(/[^A-Za-z]/g, '');
  return {
    captions: [
      { platform: 'TikTok / Reels', text: `the part of "${t}" I can't stop replaying 🔁 out ${formatDate(release.release_date)} · link in bio` },
      { platform: 'TikTok / Reels', text: `POV: you finally made the ${mood || 'song'} song you needed to hear. "${t}" is out now.` },
      { platform: 'Instagram feed', text: `"${t}" is here. ${release.story ? release.story.split('.')[0] + '.' : 'This one means a lot.'} Tap the link in bio and tell me your favourite line.` },
      { platform: 'YouTube Shorts', text: `${t} by ${artistName} (official audio) #${tag} #newmusic` },
      { platform: 'X / Threads', text: `made "${t}" for anyone who needs a ${mood || 'new'} song this week. it's out now.` }
    ],
    videoIdeas: [
      { title: 'The hook, three ways', detail: 'Film the same 10-second hook in three locations. Post one every few days and keep the one that performs.' },
      { title: 'Lyric on screen', detail: 'Static shot, the strongest lyric typed on screen, the hook playing underneath. Simple and very shareable.' },
      { title: 'How it started', detail: 'Phone footage of the voice memo or first beat, cutting to the finished song.' },
      { title: 'Reaction stitch', detail: 'Play the song for a friend or family member and film their honest first reaction.' },
      { title: 'Use my sound', detail: 'Show the move, outfit or prompt you want people to copy, then ask them to try it.' }
    ],
    hashtags: [`#${tag}`, '#newmusic', '#independentartist', `#${tag}music`, release.hometown ? `#${release.hometown.split(',')[0].replace(/\s/g, '')}music` : '#upandcoming']
  };
}

// --- Release Protection -------------------------------------------------------
// Scans a promoter's message for the red flags that usually mean fake streams
// or a scam. Artists paste the DM or email they received.
const RED_FLAGS = [
  { re: /guarantee[ds]?\s+(\d[\d,.]*\s*k?\s*)?(streams|plays|listeners|followers|views)/i, sev: 'high', why: 'Nobody can guarantee real streams. Guaranteed numbers almost always mean bots, which can get your song removed and your royalties withheld.' },
  { re: /(\d[\d,.]*\s*k?)\s*(streams|plays)\s*(for|=)\s*\$?\d/i, sev: 'high', why: 'Paying a set price per stream is buying streams. Platforms treat this as artificial streaming.' },
  { re: /\$\s?\d+.*(playlist placement|placement on|get you placed)/i, sev: 'high', why: 'Paying for a guaranteed playlist spot breaks platform rules. Legitimate services charge for a curator to listen, not for placement.' },
  { re: /(placement|placed)\s+(on|in)\s+.*\b(official|editorial)\b/i, sev: 'high', why: 'Editorial playlists are chosen by platform staff. Third parties cannot sell you a spot.' },
  { re: /(send|share|give)\s+(me\s+)?(your\s+)?(password|login|2fa|verification code|otp)/i, sev: 'high', why: 'No real promoter needs your password or login code. This is an account takeover attempt.' },
  { re: /(gift ?card|crypto|bitcoin|usdt|western union|zelle only|cash ?app only)/i, sev: 'high', why: 'Untraceable payment methods are a classic scam signal. Legitimate businesses invoice and accept refundable payments.' },
  { re: /(verify|verification|unlock|claim)\s+(your\s+)?(artist\s+)?(profile|account|blue check|badge).*(\$|fee|pay)/i, sev: 'high', why: 'Platforms do not charge to verify artist profiles. This is impersonation.' },
  { re: /\b(urgent|act now|today only|last spot|limited spots|expires in)\b/i, sev: 'medium', why: 'Pressure to decide fast is a manipulation tactic. Real opportunities let you take a day to check.' },
  { re: /\b(viral|blow up|go viral|million(s)? of (streams|views))\b/i, sev: 'medium', why: 'Promises of going viral cannot be kept. Treat big-outcome promises with suspicion.' },
  { re: /(bit\.ly|tinyurl|t\.co|cutt\.ly|rb\.gy)\//i, sev: 'medium', why: 'Shortened links hide where they go. Check the real destination before clicking or logging in.' },
  { re: /\b(spotify|apple music|youtube)\s+(team|staff|support|partner)\b/i, sev: 'medium', why: 'Messages claiming to be platform staff via DM are usually impersonation. Platforms contact you through your official dashboard.' },
  { re: /\b(bot[- ]?free|100% real|organic only|real human)\b.*\b(streams|plays)\b/i, sev: 'medium', why: 'Sellers who stress that bought streams are "real" are usually selling bot or click-farm traffic.' }
];

function scanMessage(text) {
  const input = String(text || '').slice(0, 5000);
  const findings = [];
  for (const f of RED_FLAGS) {
    const m = input.match(f.re);
    if (m) findings.push({ severity: f.sev, match: m[0].slice(0, 80), why: f.why });
  }
  const highs = findings.filter(f => f.severity === 'high').length;
  const meds = findings.filter(f => f.severity === 'medium').length;
  let verdict = 'clear', summary = 'No common red flags found. Still check their past work, ask for references and never share logins.';
  if (highs) { verdict = 'danger'; summary = 'Strong signs of a scam or fake-stream service. Do not pay or share any account access.'; }
  else if (meds >= 2) { verdict = 'caution'; summary = 'Several warning signs. Ask for proof of past results and how they reach listeners before going further.'; }
  else if (meds === 1) { verdict = 'caution'; summary = 'One warning sign. Ask questions before agreeing to anything.'; }
  return { verdict, summary, findings };
}

const PROTECTION_CHECKLIST = [
  { key: 'p_2fa', t: 'Two-factor login on your distributor account', why: 'Your distributor controls your money and your catalog. It is the account attackers want most.' },
  { key: 'p_2fa_social', t: 'Two-factor login on Instagram, TikTok and YouTube', why: 'A hijacked social account can be used to scam your fans in your name.' },
  { key: 'p_email', t: 'A separate email just for music business', why: 'If your personal email leaks, your music accounts stay safe, and the reverse.' },
  { key: 'p_pw', t: 'A password manager with unique passwords', why: 'Reused passwords are how one breach turns into five.' },
  { key: 'p_team', t: 'Give team members their own logins, not yours', why: 'Most dashboards let you add managers with limited access. Shared passwords cannot be taken back.' },
  { key: 'p_promo', t: 'Never buy guaranteed streams or placements', why: 'Platforms remove artificial streams and can withhold royalties or take the song down.' },
  { key: 'p_monitor', t: 'Check stats weekly for strange spikes', why: 'Fake streams can be sent to your song by someone else. Reporting early protects you.' }
];

module.exports = {
  GENRES, MOODS, PLATFORMS, PLATFORM_LABELS,
  analyzeRelease, matchOutlets, buildPlan, buildPitch, buildContent,
  scanMessage, PROTECTION_CHECKLIST, addDays, formatDate
};
