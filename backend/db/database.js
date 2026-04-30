import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'untangle.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    unt_euid     TEXT UNIQUE,
    display_name TEXT,
    role         TEXT DEFAULT 'student',
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS saved_schedules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL DEFAULT 'My Schedule',
    sections   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS courses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subject     TEXT NOT NULL,
    number      TEXT NOT NULL,
    title       TEXT NOT NULL,
    credits     INTEGER NOT NULL DEFAULT 3,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS sections (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id     INTEGER NOT NULL REFERENCES courses(id),
    section_code  TEXT NOT NULL,
    instructor    TEXT,
    days          TEXT,
    start_time    TEXT,
    end_time      TEXT,
    location      TEXT,
    building_code TEXT,
    max_seats     INTEGER DEFAULT 30,
    open_seats    INTEGER DEFAULT 15,
    term          TEXT NOT NULL DEFAULT '2025FA'
  );
`);

export default db;