// Seeds sample outlets and a demo account so the app works on first load.
// All outlets are fictional examples, flagged is_sample = 1. Replace them with
// real curators, creators and DJs you have permission to contact.
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { addDays, matchOutlets } = require('./engine');

const OUTLETS = [
  // name, kind, platform, genres, moods, region, reach
  ['Late Night Lagos', 'playlist', 'Audiomack', ['Afrobeats', 'Amapiano', 'R&B'], ['Late-night', 'Romantic', 'Chill'], 'Global', 8400],
  ['Amapiano Sundays', 'playlist', 'YouTube', ['Amapiano', 'House', 'Afrobeats'], ['Party', 'Energetic', 'Summer'], 'Global', 22000],
  ['Diaspora Drive', 'radio', 'Online radio', ['Afrobeats', 'Dancehall', 'Hip-Hop'], ['Energetic', 'Confident'], 'Global', 15000],
  ['Naija New Waves', 'blog', 'Web', ['Afrobeats', 'Amapiano'], ['Uplifting', 'Party', 'Romantic'], 'Global', 31000],
  ['Broward Underground', 'blog', 'Web', ['Hip-Hop', 'Trap', 'R&B', 'Afrobeats'], ['Confident', 'Late-night', 'Moody'], 'Fort Lauderdale', 4200],
  ['305 Fresh Finds', 'playlist', 'Apple Music', ['Hip-Hop', 'Latin', 'Reggaeton', 'R&B'], ['Party', 'Summer', 'Energetic'], 'Miami', 6900],
  ['Biscayne Sound Club', 'community', 'Discord', ['Electronic', 'House', 'Afrobeats', 'Amapiano'], ['Party', 'Energetic'], 'Miami', 2300],
  ['DJ Coral Reef', 'dj', 'Live sets', ['Afrobeats', 'Dancehall', 'Amapiano', 'Reggaeton'], ['Party', 'Summer', 'Energetic'], 'Miami', 5100],
  ['Las Olas Sessions', 'creator', 'TikTok', ['R&B', 'Neo-Soul', 'Pop'], ['Romantic', 'Chill', 'Late-night'], 'Fort Lauderdale', 12800],
  ['Soft Life Soul', 'playlist', 'YouTube', ['R&B', 'Neo-Soul'], ['Romantic', 'Chill', 'Late-night'], 'Global', 9700],
  ['Velvet Hours', 'playlist', 'Apple Music', ['R&B', 'Neo-Soul', 'Jazz'], ['Late-night', 'Romantic', 'Moody'], 'Global', 14300],
  ['Heartbreak Hotel FM', 'radio', 'Online radio', ['R&B', 'Pop', 'Indie'], ['Heartbreak', 'Reflective', 'Moody'], 'Global', 11000],
  ['Atlanta Rising', 'blog', 'Web', ['Hip-Hop', 'Trap', 'R&B'], ['Confident', 'Energetic'], 'Atlanta', 18000],
  ['Trap Lab Weekly', 'playlist', 'SoundCloud', ['Trap', 'Hip-Hop', 'Drill'], ['Confident', 'Moody', 'Energetic'], 'Global', 26000],
  ['Bars Over Beats', 'creator', 'YouTube Shorts', ['Hip-Hop', 'Drill'], ['Confident', 'Reflective'], 'Global', 41000],
  ['Drill Report', 'blog', 'Web', ['Drill', 'Trap'], ['Moody', 'Confident'], 'Global', 7600],
  ['Worship Waves', 'playlist', 'YouTube', ['Gospel', 'Neo-Soul'], ['Spiritual', 'Uplifting', 'Reflective'], 'Global', 19500],
  ['Kingdom Creatives', 'community', 'Facebook group', ['Gospel'], ['Spiritual', 'Uplifting'], 'Global', 6200],
  ['Sunday Morning Radio', 'radio', 'FM + stream', ['Gospel', 'Neo-Soul', 'R&B'], ['Spiritual', 'Uplifting'], 'Global', 24000],
  ['Faith & Fire Creators', 'creator', 'TikTok', ['Gospel'], ['Spiritual', 'Energetic', 'Uplifting'], 'Global', 9300],
  ['Bedroom Pop Club', 'playlist', 'SoundCloud', ['Pop', 'Indie', 'Lo-fi'], ['Chill', 'Reflective', 'Summer'], 'Global', 8800],
  ['Indie Signal', 'blog', 'Web', ['Indie', 'Alternative', 'Rock'], ['Reflective', 'Moody', 'Uplifting'], 'Global', 13500],
  ['Garage Static', 'playlist', 'Bandcamp', ['Rock', 'Alternative', 'Indie'], ['Energetic', 'Moody'], 'Global', 3900],
  ['Study Beats Collective', 'playlist', 'YouTube', ['Lo-fi', 'Jazz', 'Electronic'], ['Chill', 'Reflective'], 'Global', 52000],
  ['Blue Note Rookies', 'blog', 'Web', ['Jazz', 'Neo-Soul'], ['Reflective', 'Late-night'], 'Global', 5400],
  ['Warehouse Notes', 'playlist', 'SoundCloud', ['House', 'Electronic'], ['Party', 'Energetic', 'Late-night'], 'Global', 17200],
  ['Synth & Sea', 'creator', 'Instagram Reels', ['Electronic', 'Pop', 'House'], ['Summer', 'Chill', 'Uplifting'], 'Miami', 10400],
  ['Pop Radar Daily', 'blog', 'Web', ['Pop', 'R&B', 'Electronic'], ['Uplifting', 'Summer', 'Party'], 'Global', 29000],
  ['Dancehall Yard', 'playlist', 'Audiomack', ['Dancehall', 'Afrobeats', 'Reggaeton'], ['Party', 'Energetic', 'Summer'], 'Global', 12100],
  ['Perreo Nuevo', 'playlist', 'YouTube', ['Reggaeton', 'Latin'], ['Party', 'Romantic', 'Summer'], 'Global', 21000],
  ['Little Havana Live', 'dj', 'Live sets', ['Latin', 'Reggaeton', 'House'], ['Party', 'Energetic'], 'Miami', 3600],
  ['Front Porch Picks', 'playlist', 'Apple Music', ['Country', 'Indie', 'Rock'], ['Reflective', 'Summer', 'Heartbreak'], 'Global', 7300],
  ['Glow Up Fitness', 'creator', 'TikTok', ['Pop', 'Hip-Hop', 'Afrobeats', 'House'], ['Energetic', 'Confident', 'Uplifting'], 'Global', 64000],
  ['Couples Content Co', 'creator', 'Instagram Reels', ['R&B', 'Afrobeats', 'Pop'], ['Romantic', 'Summer'], 'Global', 38000],
  ['Unsigned & Rising', 'community', 'Reddit', ['Hip-Hop', 'R&B', 'Pop', 'Indie', 'Afrobeats'], ['Uplifting', 'Confident', 'Reflective'], 'Global', 45000],
  ['South Florida Showcase', 'radio', 'College radio', ['Hip-Hop', 'R&B', 'Afrobeats', 'Indie', 'Latin'], ['Uplifting', 'Energetic', 'Chill'], 'Fort Lauderdale', 2800]
];

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM outlets').get().n;
  if (count === 0) {
    const ins = db.prepare('INSERT INTO outlets (name, kind, platform, genres, moods, region, reach, notes, is_sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)');
    for (const [name, kind, platform, genres, moods, region, reach] of OUTLETS) {
      ins.run(name, kind, platform, JSON.stringify(genres), JSON.stringify(moods), region, reach, 'Sample outlet for the demo');
    }
  }

  const DEMO_ARTIST = 'JXXIII';
  const demo = db.prepare('SELECT id, artist_name FROM users WHERE email = ?').get('demo@dropradar.app');
  // Re-seed when the demo release changes (new cover art or details), so existing databases pick it up.
  const current = demo && db.prepare("SELECT 1 FROM releases WHERE user_id = ? AND cover_image = '/img/covers/jxxiii-in-mind.jpg' AND hometown = 'Atlanta, GA'").get(demo.id);
  if (current) return;
  if (demo) {
    // Replace an older demo (the fictional "Ada Nova", or an earlier In Mind) on databases that already have one.
    db.prepare('DELETE FROM releases WHERE user_id = ?').run(demo.id);
    db.prepare('DELETE FROM security_log WHERE user_id = ?').run(demo.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(demo.id);
  }

  const hash = bcrypt.hashSync('DemoDrop!2026', 12);
  const userId = db.prepare('INSERT INTO users (email, password_hash, artist_name, is_demo) VALUES (?, ?, ?, 1)')
    .run('demo@dropradar.app', hash, DEMO_ARTIST).lastInsertRowid;

  // The demo runs on a real, released song: "In Mind" by JXXIII feat. S777 (originally
  // released September 7, 2022), used with the artist's permission. The links are real.
  // The campaign dates, clicks, fans and outlets are simulated so every feature has
  // something to show; the app's demo banner says so.
  const today = new Date().toISOString().slice(0, 10);
  const releaseDate = addDays(today, -6); // demo campaign is on day 7
  const demoRelease = {
    title: 'In Mind', genre: 'R&B', moods: ['Romantic', 'Confident', 'Party'], bpm: 108,
    sounds_like: '', hometown: 'Atlanta, GA',
    story: "I wrote it about staying open to new possibilities in life and love, and raising each other's vibration. A funky, melodic exchange of genius and beautiful knowledge, featuring S777."
  };
  const relId = db.prepare(`INSERT INTO releases
    (user_id, slug, title, release_type, release_date, genre, moods, bpm, sounds_like, hometown, story, links, cover_color, cover_image)
    VALUES (?, ?, ?, 'single', ?, ?, ?, ?, ?, ?, ?, ?, '#B8865A', '/img/covers/jxxiii-in-mind.jpg')`).run(
    userId, 'jxxiii-in-mind', demoRelease.title, releaseDate, demoRelease.genre,
    JSON.stringify(demoRelease.moods), demoRelease.bpm, demoRelease.sounds_like, demoRelease.hometown, demoRelease.story,
    JSON.stringify({
      youtube: 'https://www.youtube.com/watch?v=eEUX3Sojp1s',
      apple: 'https://music.apple.com/us/album/in-mind-feat-s777-single/1771585489',
      spotify: 'https://open.spotify.com/track/0BPHmBWhXubdBE9sSPzeuE'
    })
  ).lastInsertRowid;

  // Plan steps already completed in the demo.
  const done = ['distro', 'secure', 'splits', 'assets', 'smartlink', 'editorial', 'announce', 'curators1', 'tease1', 'creators', 'tease2', 'local', 'curators2', 'countdown', 'release', 'yt', 'thank', 'curators3', 'p_2fa', 'p_2fa_social', 'p_email'];
  const insDone = db.prepare('INSERT INTO tasks_done (release_id, task_key) VALUES (?, ?)');
  done.forEach(k => insDone.run(relId, k));

  // Pitch pipeline: the song's nine best-matched outlets, at different stages.
  const outlets = db.prepare('SELECT * FROM outlets').all();
  const top = matchOutlets({ ...demoRelease, release_type: 'single' }, outlets).slice(0, 9);
  const stages = ['added', 'replied', 'added', 'sent', 'sent', 'passed', 'added', 'sent', 'approved'];
  const insPitch = db.prepare('INSERT INTO pitches (release_id, outlet_id, status) VALUES (?, ?, ?)');
  top.forEach((o, i) => insPitch.run(relId, o.id, stages[i]));

  // Smart-link clicks and fan sign-ups over the past three weeks (demo data).
  const insClick = db.prepare('INSERT INTO clicks (release_id, platform, source, day) VALUES (?, ?, ?, ?)');
  const insFan = db.prepare("INSERT OR IGNORE INTO fans (release_id, email, source, created_at, unsub_token, consent) VALUES (?, ?, ?, ?, lower(hex(randomblob(16))), 'sample')");
  const platforms = ['spotify', 'youtube', 'apple', 'spotify', 'youtube', 'spotify', 'apple', 'youtube'];
  const sources = ['tiktok', 'tiktok', 'instagram', 'email', 'curator', 'direct', 'tiktok', 'instagram'];
  let rng = 7;
  const rand = () => { rng = (rng * 9301 + 49297) % 233280; return rng / 233280; };
  let fanN = 0;
  for (let d = -21; d <= 0; d++) {
    const day = addDays(today, d);
    const rel = d - (-6); // days relative to release
    const base = rel < 0 ? 3 + (21 + d) * 0.4 : 14 + Math.max(0, 6 - Math.abs(rel - 1)) * 4;
    const n = Math.round(base + rand() * 6);
    for (let i = 0; i < n; i++) {
      insClick.run(relId, platforms[Math.floor(rand() * platforms.length)], sources[Math.floor(rand() * sources.length)], day);
    }
    const fans = Math.round(n * (rel < 0 ? 0.35 : 0.18));
    for (let i = 0; i < fans; i++) {
      fanN++;
      insFan.run(relId, `fan${fanN}@example.com`, sources[Math.floor(rand() * sources.length)], day + ' 12:00:00');
    }
  }
  // One suspicious spike, so the demo shows the fake-stream alert working.
  const spikeDay = addDays(today, -3);
  for (let i = 0; i < 140; i++) insClick.run(relId, 'spotify', 'direct', spikeDay);
}

if (require.main === module) { seed(); console.log('Seeded.'); }
module.exports = { seed };
