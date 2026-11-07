// Database layer: Node's built-in SQLite (no native build step, free to host).
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dropradar.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  artist_name   TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'artist',
  is_demo       INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS releases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  release_type  TEXT NOT NULL DEFAULT 'single',
  release_date  TEXT NOT NULL,
  genre         TEXT NOT NULL,
  moods         TEXT NOT NULL DEFAULT '[]',
  bpm           INTEGER,
  sounds_like   TEXT NOT NULL DEFAULT '',
  hometown      TEXT NOT NULL DEFAULT '',
  story         TEXT NOT NULL DEFAULT '',
  links         TEXT NOT NULL DEFAULT '{}',
  cover_color   TEXT NOT NULL DEFAULT '#2F4BFF',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks_done (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  task_key   TEXT NOT NULL,
  done_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (release_id, task_key)
);

CREATE TABLE IF NOT EXISTS outlets (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,          -- playlist | blog | creator | dj | community | radio
  platform  TEXT NOT NULL,
  genres    TEXT NOT NULL,          -- JSON array
  moods     TEXT NOT NULL,          -- JSON array
  region    TEXT NOT NULL DEFAULT 'Global',
  reach     INTEGER NOT NULL DEFAULT 0,
  notes     TEXT NOT NULL DEFAULT '',
  is_sample INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pitches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id  INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  outlet_id   INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'draft', -- draft | approved | sent | replied | added | passed
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (release_id, outlet_id)
);

CREATE TABLE IF NOT EXISTS fans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id  INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'direct',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (release_id, email)
);

CREATE TABLE IF NOT EXISTS clicks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id  INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'direct',
  day         TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS security_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  event       TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function logSecurity(userId, event, detail = '', ip = '') {
  db.prepare('INSERT INTO security_log (user_id, event, detail, ip) VALUES (?, ?, ?, ?)')
    .run(userId ?? null, event, String(detail).slice(0, 300), String(ip).slice(0, 64));
}

module.exports = { db, logSecurity };
