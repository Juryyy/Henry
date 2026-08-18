/**
 * Úložiště synchronizovaných dat uživatele.
 *
 * Model je záměrně hloupý: jeden řádek = jeden záznam (den, měření, úkol…)
 * identifikovaný trojicí `user_id` + `kind` + `id`. Server nerozumí tomu, co
 * v záznamu je; jen ví, kdy naposledy vznikl, a při souběhu nechá vyhrát
 * novější zápis (last-write-wins po záznamech, ne přes celý stav – jinak by
 * odpolední zápis z notebooku přepsal dopolední odškrtnutí z telefonu).
 *
 * `rev` je čítač na uživatele. Zařízení si pamatuje, kde skončilo, a příště
 * si řekne jen o to, co od té doby přibylo.
 */

import { getDb, transact } from './db.js'

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
const MAX_VERSIONS = 30

/**
 * Zápis z budoucnosti znamená rozjeté hodiny na zařízení. Kdyby se uložil,
 * vyhrával by nad vším dalším až do chvíle, než ho reálný čas dožene.
 */
const MAX_SKEW_MS = 5 * 60 * 1000

/* ------------------------------------------------------------------ */
/*  Revize                                                             */
/* ------------------------------------------------------------------ */

export function currentRev(userId: string): number {
  const row = getDb().prepare('SELECT MAX(rev) AS rev FROM records WHERE user_id = ?').get(userId) as {
    rev: number | null
  }
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
export function pullRecords(userId: string, since = 0, limit = 5_000): { rev: number; records: SyncRecord[] } {
  const rows = getDb()
    .prepare('SELECT kind, id, rev, updated_at, deleted, payload FROM records WHERE user_id = ? AND rev > ? ORDER BY rev LIMIT ?')
    .all(userId, since, limit) as unknown as Row[]
  return { rev: currentRev(userId), records: rows.map(toRecord) }
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

/** Rozjeté hodiny na zařízení nesmí zablokovat další zápisy. */
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

export function pushRecords(userId: string, incoming: unknown[], options: PushOptions = {}): PushResult {
  const database = getDb()
  const now = Date.now()
  let rev = currentRev(userId)
  let applied = 0
  let skipped = 0

  const existing = database.prepare('SELECT updated_at FROM records WHERE user_id = ? AND kind = ? AND id = ?')
  const upsert = database.prepare(`
    INSERT INTO records (user_id, kind, id, rev, updated_at, deleted, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, kind, id) DO UPDATE SET
      rev = excluded.rev,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted,
      payload = excluded.payload
  `)

  transact(() => {
    for (const item of incoming) {
      if (!isValid(item)) {
        skipped++
        continue
      }
      const updatedAt = clampTime(item.updatedAt, now)
      const current = existing.get(userId, item.kind, item.id) as { updated_at: string } | undefined

      // Shoda na čase znamená „už to tam je“ – přepisovat nemá co přinést.
      if (!options.force && current && current.updated_at >= updatedAt) {
        skipped++
        continue
      }

      rev++
      upsert.run(
        userId,
        item.kind,
        item.id,
        rev,
        updatedAt,
        item.deleted ? 1 : 0,
        item.payload === undefined ? null : JSON.stringify(item.payload),
      )
      applied++
    }
  })

  return { rev: currentRev(userId), applied, skipped }
}

/* ------------------------------------------------------------------ */
/*  Verze stavu                                                        */
/* ------------------------------------------------------------------ */

export interface VersionInfo {
  rev: number
  at: string
  records: number
}

/**
 * Uloží celý aktuální stav stranou. Volá se po každé synchronizaci, takže
 * jde vrátit i to, co si uživatel sám rozbije – omylem naimportovaná stará
 * záloha, vyhlášený bankrot, smazané měření.
 */
export function saveVersion(userId: string): VersionInfo | null {
  const database = getDb()
  const rev = currentRev(userId)
  if (rev === 0) return null

  const existing = database.prepare('SELECT rev FROM versions WHERE user_id = ? AND rev = ?').get(userId, rev)
  if (existing) return null

  const { records } = pullRecords(userId, 0)
  const info: VersionInfo = { rev, at: new Date().toISOString(), records: records.length }
  database
    .prepare('INSERT INTO versions (user_id, rev, at, records, payload) VALUES (?, ?, ?, ?, ?)')
    .run(userId, info.rev, info.at, info.records, JSON.stringify(records))

  // Držíme jen posledních pár verzí, ať databáze neroste donekonečna.
  database
    .prepare(
      `DELETE FROM versions WHERE user_id = ? AND rev NOT IN (
         SELECT rev FROM versions WHERE user_id = ? ORDER BY rev DESC LIMIT ?
       )`,
    )
    .run(userId, userId, MAX_VERSIONS)
  return info
}

export function listVersions(userId: string): VersionInfo[] {
  return getDb()
    .prepare('SELECT rev, at, records FROM versions WHERE user_id = ? ORDER BY rev DESC')
    .all(userId) as unknown as VersionInfo[]
}

/**
 * Vrátí stav do podoby z dané verze. Záznamy se nemažou natvrdo – zapíšou se
 * s aktuálním časem, takže se změna normálně rozsype na všechna zařízení.
 */
export function restoreVersion(userId: string, rev: number): { restored: number } | null {
  const row = getDb().prepare('SELECT payload FROM versions WHERE user_id = ? AND rev = ?').get(userId, rev) as
    | { payload: string }
    | undefined
  if (!row) return null

  const records = JSON.parse(row.payload) as SyncRecord[]
  const now = new Date().toISOString()
  const revived = records.map((r) => ({ ...r, updatedAt: now }))

  // Co ve verzi nebylo, ale dnes existuje, se musí zneplatnit náhrobkem –
  // jinak by obnova nechala nová data ležet vedle starých.
  const inVersion = new Set(records.map((r) => `${r.kind} ${r.id}`))
  const tombstones = pullRecords(userId, 0)
    .records.filter((r) => !inVersion.has(`${r.kind} ${r.id}`) && !r.deleted)
    .map((r) => ({ kind: r.kind, id: r.id, updatedAt: now, deleted: true }))

  const result = pushRecords(userId, [...revived, ...tombstones], { force: true })
  return { restored: result.applied }
}

/* ------------------------------------------------------------------ */
/*  Statistika pro diagnostiku                                         */
/* ------------------------------------------------------------------ */

export function syncStats(userId: string): {
  rev: number
  records: number
  deleted: number
  kinds: Record<string, number>
} {
  const database = getDb()
  const total = database.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ?').get(userId) as { n: number }
  const gone = database.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ? AND deleted = 1').get(userId) as {
    n: number
  }
  const byKind = database
    .prepare('SELECT kind, COUNT(*) AS n FROM records WHERE user_id = ? AND deleted = 0 GROUP BY kind')
    .all(userId) as unknown as { kind: string; n: number }[]
  return {
    rev: currentRev(userId),
    records: total.n,
    deleted: gone.n,
    kinds: Object.fromEntries(byKind.map((r) => [r.kind, r.n])),
  }
}
