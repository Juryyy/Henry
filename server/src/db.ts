/**
 * Databáze.
 *
 * Jeden SQLite soubor pro všechno: účty, sezení, synchronizovaná data
 * i provozní stav (odběry notifikací, rozvrh, co už dnes odešlo). Dřív byl
 * provozní stav v JSONu, což šlo, dokud byl server pro jednoho člověka –
 * s účty by z toho byl jeden velký globální objekt, ve kterém se dá snadno
 * splést vlastník.
 *
 * `node:sqlite` je vestavěné v Nodu, takže na Raspberry se nic nekompiluje.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from './config.js'

let db: DatabaseSync | null = null

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Id sezení se ukládá zahašované. Kdyby někdo získal soubor s databází,
-- nedostane tím použitelné přihlášení, jen otisk.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash      TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  label        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS invites (
  code_hash  TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by    TEXT,
  used_at    TEXT
);

-- Token pro Apple Shortcuts. Zkratka neumí cookie, takže tudy vede druhá
-- cesta dovnitř – vázaná na uživatele a kdykoli zrušitelná.
CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens (user_id);

/* --- synchronizovaná data ------------------------------------------ */

CREATE TABLE IF NOT EXISTS records (
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  rev        INTEGER NOT NULL,
  updated_at TEXT    NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  payload    TEXT,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS records_rev ON records (user_id, rev);

CREATE TABLE IF NOT EXISTS versions (
  user_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rev     INTEGER NOT NULL,
  at      TEXT    NOT NULL,
  records INTEGER NOT NULL,
  payload TEXT    NOT NULL,
  PRIMARY KEY (user_id, rev)
);

/* --- provoz notifikací --------------------------------------------- */

CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint        TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  last_success_at TEXT,
  failures        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions (user_id);

CREATE TABLE IF NOT EXISTS steps (
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  steps      INTEGER NOT NULL,
  source     TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, date)
);

-- Snímek dneška, ze kterého plánovač skládá konkrétní hlášku.
CREATE TABLE IF NOT EXISTS snapshots (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL
);

-- Co už ten den odešlo. 'sent' = doopravdy odešlo, 'skip' = vyřízeno bez
-- odeslání (podmínka nesplněna nebo ztlumeno).
CREATE TABLE IF NOT EXISTS sent (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  status  TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS muted (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot    TEXT NOT NULL,
  until   TEXT NOT NULL,
  PRIMARY KEY (user_id, slot)
);

CREATE TABLE IF NOT EXISTS log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL,
  detail  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS log_user ON log (user_id, id DESC);
`

export function openDb(file = config.dbFile): DatabaseSync {
  if (db) return db
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  db = new DatabaseSync(file)
  db.exec(SCHEMA)
  return db
}

export function getDb(): DatabaseSync {
  return db ?? openDb()
}

/** Jen pro testy – zavře spojení, ať jde začít na čisto. */
export function closeDb(): void {
  db?.close()
  db = null
}

/** Zabalí zápisy do transakce. Při výjimce se nic neuloží. */
export function transact<T>(fn: () => T): T {
  const database = getDb()
  database.exec('BEGIN')
  try {
    const result = fn()
    database.exec('COMMIT')
    return result
  } catch (err) {
    database.exec('ROLLBACK')
    throw err
  }
}
