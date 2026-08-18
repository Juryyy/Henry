/**
 * Úložiště synchronizovaných dat.
 *
 * Proč vedle `db.json` ještě SQLite: `db.json` drží provozní stav serveru
 * (odběry notifikací, rozvrh, co už dnes odešlo) – ten patří serveru a nikam
 * se nereplikuje. Tady leží *tvoje* data, která se slévají z víc zařízení.
 * To jsou dvě různé věci s různým životním cyklem, takže dva soubory.
 *
 * Model je záměrně hloupý: jeden řádek = jeden záznam (den, měření, úkol…)
 * identifikovaný dvojicí `kind` + `id`. Server nerozumí tomu, co v záznamu je;
 * jen ví, kdy naposledy vznikl, a při souběhu nechá vyhrát novější zápis
 * (last-write-wins po záznamech, ne přes celý stav – jinak by odpolední zápis
 * z tabletu přepsal dopolední odškrtnutí z telefonu).
 *
 * `rev` je čítač serveru. Zařízení si pamatuje, kde skončilo, a příště si
 * řekne jen o to, co přibylo.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from './config.js'

export interface SyncRecord {
  kind: string
  id: string
  /** ISO čas poslední změny na zařízení. Rozhoduje o tom, kdo vyhraje. */
  updatedAt: string
  /** Smazaný záznam se nepřenáší jako „chybí“, ale jako náhrobek. */
  deleted?: boolean
  payload?: unknown
  /** Doplňuje server při čtení. */
  rev?: number
}

/** Kolik verzí stavu se drží pro případ, že si uživatel něco rozbije. */
const MAX_SNAPSHOTS = 30

/**
 * Zápis z budoucnosti znamená rozjeté hodiny na zařízení. Kdyby se uložil,
 * vyhrával by nad vším dalším až do chvíle, než ho reálný čas dožene.
 */
const MAX_SKEW_MS = 5 * 60 * 1000

let db: DatabaseSync | null = null

export function openSyncDb(file = config.syncFile): DatabaseSync {
  if (db) return db
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS records (
      kind       TEXT    NOT NULL,
      id         TEXT    NOT NULL,
      rev        INTEGER NOT NULL,
      updated_at TEXT    NOT NULL,
      deleted    INTEGER NOT NULL DEFAULT 0,
      payload    TEXT,
      PRIMARY KEY (kind, id)
    );
    CREATE INDEX IF NOT EXISTS records_rev ON records (rev);
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      rev     INTEGER PRIMARY KEY,
      at      TEXT    NOT NULL,
      records INTEGER NOT NULL,
      payload TEXT    NOT NULL
    );
  `)
  return db
}

/** Jen pro testy – zahodí otevřené spojení, ať jde začít na čisto. */
export function closeSyncDb(): void {
  db?.close()
  db = null
}

function conn(): DatabaseSync {
  return db ?? openSyncDb()
}

/* ------------------------------------------------------------------ */
/*  Revize                                                             */
/* ------------------------------------------------------------------ */

export function currentRev(): number {
  const row = conn().prepare('SELECT MAX(rev) AS rev FROM records').get() as { rev: number | null }
  return row?.rev ?? 0
}

/* ------------------------------------------------------------------ */
/*  Čtení                                                              */
/* ------------------------------------------------------------------ */

interface Row {
  kind: string
  id: string
  rev: number
  updated_at: string
  deleted: number
  payload: string | null
}

function toRecord(row: Row): SyncRecord {
  return {
    kind: row.kind,
    id: row.id,
    rev: row.rev,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
    payload: row.payload === null ? undefined : (JSON.parse(row.payload) as unknown),
  }
}

/**
 * Záznamy, které přibyly od revize `since`. `since = 0` vrátí všechno –
 * tak si nové zařízení stáhne celou historii.
 */
export function pullRecords(since = 0, limit = 5_000): { rev: number; records: SyncRecord[] } {
  const rows = conn()
    .prepare('SELECT * FROM records WHERE rev > ? ORDER BY rev LIMIT ?')
    .all(since, limit) as unknown as Row[]
  return { rev: currentRev(), records: rows.map(toRecord) }
}

/* ------------------------------------------------------------------ */
/*  Zápis                                                              */
/* ------------------------------------------------------------------ */

export interface PushResult {
  rev: number
  /** Kolik záznamů se opravdu uložilo. */
  applied: number
  /** Kolik jich prohrálo souboj s novější verzí na serveru. */
  skipped: number
}

function isValid(record: unknown): record is SyncRecord {
  if (!record || typeof record !== 'object') return false
  const r = record as Record<string, unknown>
  return typeof r.kind === 'string' && !!r.kind && typeof r.id === 'string' && !!r.id && typeof r.updatedAt === 'string'
}

/** Rozjeté hodiny na zařízení nesmí zablokovat všechny další zápisy. */
function clampTime(iso: string, now = Date.now()): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return new Date(now).toISOString()
  return time > now + MAX_SKEW_MS ? new Date(now).toISOString() : new Date(time).toISOString()
}

export interface PushOptions {
  /**
   * Přepsat i záznam se stejným nebo novějším časem. Používá jen návrat
   * k verzi – ten není slučování, ale vědomé „vrať to tam, jak to bylo“.
   */
  force?: boolean
}

export function pushRecords(incoming: unknown[], options: PushOptions = {}): PushResult {
  const database = conn()
  const now = Date.now()
  let rev = currentRev()
  let applied = 0
  let skipped = 0

  const existing = database.prepare('SELECT updated_at FROM records WHERE kind = ? AND id = ?')
  const upsert = database.prepare(`
    INSERT INTO records (kind, id, rev, updated_at, deleted, payload)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (kind, id) DO UPDATE SET
      rev = excluded.rev,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted,
      payload = excluded.payload
  `)

  database.exec('BEGIN')
  try {
    for (const item of incoming) {
      if (!isValid(item)) {
        skipped++
        continue
      }
      const updatedAt = clampTime(item.updatedAt, now)
      const current = existing.get(item.kind, item.id) as { updated_at: string } | undefined

      // Shoda na čase znamená „už to tam je“ – přepisovat nemá co přinést.
      if (!options.force && current && current.updated_at >= updatedAt) {
        skipped++
        continue
      }

      rev++
      upsert.run(
        item.kind,
        item.id,
        rev,
        updatedAt,
        item.deleted ? 1 : 0,
        item.payload === undefined ? null : JSON.stringify(item.payload),
      )
      applied++
    }
    database.exec('COMMIT')
  } catch (err) {
    database.exec('ROLLBACK')
    throw err
  }

  return { rev: currentRev(), applied, skipped }
}

/* ------------------------------------------------------------------ */
/*  Verze stavu                                                        */
/* ------------------------------------------------------------------ */

export interface SnapshotInfo {
  rev: number
  at: string
  records: number
}

/**
 * Uloží celý aktuální stav stranou. Volá se po každé synchronizaci, takže
 * jde vrátit i to, co si uživatel sám rozbije – omylem naimportovaná stará
 * záloha, vyhlášený bankrot, smazané měření.
 */
export function saveSnapshot(): SnapshotInfo | null {
  const database = conn()
  const rev = currentRev()
  if (rev === 0) return null

  const existing = database.prepare('SELECT rev FROM snapshots WHERE rev = ?').get(rev)
  if (existing) return null

  const { records } = pullRecords(0)
  const info: SnapshotInfo = { rev, at: new Date().toISOString(), records: records.length }
  database
    .prepare('INSERT INTO snapshots (rev, at, records, payload) VALUES (?, ?, ?, ?)')
    .run(info.rev, info.at, info.records, JSON.stringify(records))

  // Držíme jen posledních pár verzí, ať soubor neroste donekonečna.
  database
    .prepare('DELETE FROM snapshots WHERE rev NOT IN (SELECT rev FROM snapshots ORDER BY rev DESC LIMIT ?)')
    .run(MAX_SNAPSHOTS)
  return info
}

export function listSnapshots(): SnapshotInfo[] {
  const rows = conn()
    .prepare('SELECT rev, at, records FROM snapshots ORDER BY rev DESC')
    .all() as unknown as SnapshotInfo[]
  return rows
}

/**
 * Vrátí stav do podoby z dané verze. Záznamy se nemažou natvrdo – zapíšou se
 * s aktuálním časem, takže se změna normálně rozsype na všechna zařízení.
 */
export function restoreSnapshot(rev: number): { restored: number } | null {
  const row = conn().prepare('SELECT payload FROM snapshots WHERE rev = ?').get(rev) as
    | { payload: string }
    | undefined
  if (!row) return null

  const records = JSON.parse(row.payload) as SyncRecord[]
  const now = new Date().toISOString()
  const revived = records.map((r) => ({ ...r, updatedAt: now }))

  // Co ve verzi nebylo, ale dnes existuje, se musí zneplatnit náhrobkem –
  // jinak by obnova nechala nová data ležet vedle starých.
  const inSnapshot = new Set(records.map((r) => `${r.kind} ${r.id}`))
  const tombstones = pullRecords(0)
    .records.filter((r) => !inSnapshot.has(`${r.kind} ${r.id}`) && !r.deleted)
    .map((r) => ({ kind: r.kind, id: r.id, updatedAt: now, deleted: true }))

  const result = pushRecords([...revived, ...tombstones], { force: true })
  return { restored: result.applied }
}

/* ------------------------------------------------------------------ */
/*  Statistika pro diagnostiku                                         */
/* ------------------------------------------------------------------ */

export function syncStats(): { rev: number; records: number; deleted: number; kinds: Record<string, number> } {
  const database = conn()
  const total = database.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }
  const gone = database.prepare('SELECT COUNT(*) AS n FROM records WHERE deleted = 1').get() as { n: number }
  const byKind = database
    .prepare('SELECT kind, COUNT(*) AS n FROM records WHERE deleted = 0 GROUP BY kind')
    .all() as unknown as { kind: string; n: number }[]
  return {
    rev: currentRev(),
    records: total.n,
    deleted: gone.n,
    kinds: Object.fromEntries(byKind.map((r) => [r.kind, r.n])),
  }
}
