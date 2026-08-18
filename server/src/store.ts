/**
 * Provozní stav serveru – všechno vázané na uživatele.
 *
 * Odběry notifikací, rozvrh, snímek dneška, co už dnes odešlo a záznamy
 * v logu. Dřív to byl jeden globální JSON; s účty by se v takovém objektu
 * dalo snadno splést, čí data se právě čtou, takže je to v SQLite s `user_id`
 * v každé tabulce.
 *
 * Každá funkce tady bere `userId` jako první parametr. Je to trochu ukecané,
 * ale zapomenout na něj pak nejde – typy to nedovolí.
 */

import { getDb } from './db.js'
import { config } from './config.js'

/* ------------------------------------------------------------------ */
/*  Datový model                                                       */
/* ------------------------------------------------------------------ */

export interface StoredSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
  label: string
  createdAt: string
  lastSuccessAt?: string
  failures: number
}

/**
 * Snímek stavu, který si appka nahrává na server. Server ho potřebuje,
 * aby uměl napsat konkrétní hlášku („chybí ti 3 200 kroků“) místo obecné.
 */
export interface StateSnapshot {
  updatedAt: string
  date: string
  /** Kroky dnes. */
  steps: number
  /** Kolik kroků má dnes ještě ujít. */
  stepsNeededToday: number
  /** Celá dnešní porce včetně nachozených – stabilní po celý den. */
  stepPortionToday: number
  /** Denní cíl kroků. */
  stepTarget: number
  blocksDone: number
  blocksTarget: number
  /** Indexy bloků, které už jsou dnes hotové – ať nepřipomínáme odcvičené. */
  doneSlots: number[]
  stepDebt: number
  stepsRemainingThisWeek: number
  streak: number
  /** Nesplněné týdenní úkoly (názvy). */
  openTasks: string[]
  /** Jméno pro oslovení. */
  name: string
  /** Posledních pár dní – z toho server pozná opakovaně ignorovanou připomínku. */
  history: { date: string; slots: number[]; steps: number; target: number }[]
}

export interface ScheduleConfig {
  enabled: boolean
  timezone: string
  /** Kolik bloků uživatel denně cvičí – tolik připomínek smí odejít. */
  blocksPerDay: number
  blockTimes: string[]
  stepCheckTime: string
  stepCheckThreshold: number
  eveningReviewTime: string
  weeklyReviewTime: string
  quietFrom: string
  quietTo: string
  tone: 'kind' | 'coach' | 'drsny'
}

export interface StepEntry {
  date: string
  steps: number
  source: string
  updatedAt: string
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  enabled: true,
  timezone: config.timezone,
  blocksPerDay: 3,
  blockTimes: ['07:15', '12:30', '20:00'],
  stepCheckTime: '17:45',
  stepCheckThreshold: 60,
  eveningReviewTime: '21:00',
  weeklyReviewTime: '19:00',
  quietFrom: '21:30',
  quietTo: '07:00',
  tone: 'coach',
}

/* ------------------------------------------------------------------ */
/*  Rozvrh                                                             */
/* ------------------------------------------------------------------ */

export function getSchedule(userId: string): ScheduleConfig {
  const row = getDb().prepare('SELECT payload FROM schedules WHERE user_id = ?').get(userId) as
    | { payload: string }
    | undefined
  if (!row) return { ...DEFAULT_SCHEDULE }
  try {
    return { ...DEFAULT_SCHEDULE, ...(JSON.parse(row.payload) as Partial<ScheduleConfig>) }
  } catch {
    return { ...DEFAULT_SCHEDULE }
  }
}

export function setSchedule(userId: string, patch: Partial<ScheduleConfig>): ScheduleConfig {
  const next = { ...getSchedule(userId), ...patch }
  const blocks = Number(next.blocksPerDay)
  next.blocksPerDay = Math.max(1, Math.min(3, Math.round(Number.isFinite(blocks) ? blocks : 3)))
  getDb()
    .prepare(
      'INSERT INTO schedules (user_id, payload) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET payload = excluded.payload',
    )
    .run(userId, JSON.stringify(next))
  return next
}

/* ------------------------------------------------------------------ */
/*  Snímek dneška                                                      */
/* ------------------------------------------------------------------ */

export function getSnapshot(userId: string): StateSnapshot | null {
  const row = getDb().prepare('SELECT payload FROM snapshots WHERE user_id = ?').get(userId) as
    | { payload: string }
    | undefined
  if (!row) return null
  try {
    return JSON.parse(row.payload) as StateSnapshot
  } catch {
    return null
  }
}

export function setSnapshot(userId: string, snapshot: StateSnapshot): void {
  getDb()
    .prepare(
      'INSERT INTO snapshots (user_id, payload) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET payload = excluded.payload',
    )
    .run(userId, JSON.stringify(snapshot))
}

/* ------------------------------------------------------------------ */
/*  Odběry notifikací                                                  */
/* ------------------------------------------------------------------ */

interface SubRow {
  endpoint: string
  user_id: string
  p256dh: string
  auth: string
  label: string
  created_at: string
  last_success_at: string | null
  failures: number
}

function toSub(row: SubRow): StoredSubscription {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
    label: row.label,
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at ?? undefined,
    failures: row.failures,
  }
}

export function listSubscriptions(userId: string): StoredSubscription[] {
  const rows = getDb()
    .prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at')
    .all(userId) as unknown as SubRow[]
  return rows.map(toSub)
}

export function countSubscriptions(userId: string): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?').get(userId) as { n: number }
  return row.n
}

export function upsertSubscription(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string }; label?: string },
): StoredSubscription {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM subscriptions WHERE endpoint = ?').get(sub.endpoint) as unknown as
    | SubRow
    | undefined

  if (existing) {
    // Odběr může přejít k jinému účtu – když si appku na tomtéž telefonu
    // otevře někdo další, push služba vrátí tentýž endpoint.
    db.prepare(
      'UPDATE subscriptions SET user_id = ?, p256dh = ?, auth = ?, label = ?, failures = 0 WHERE endpoint = ?',
    ).run(userId, sub.keys.p256dh, sub.keys.auth, sub.label ?? existing.label, sub.endpoint)
  } else {
    db.prepare(
      'INSERT INTO subscriptions (endpoint, user_id, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      sub.endpoint,
      userId,
      sub.keys.p256dh,
      sub.keys.auth,
      sub.label ?? 'neznámé zařízení',
      new Date().toISOString(),
    )
  }

  return toSub(db.prepare('SELECT * FROM subscriptions WHERE endpoint = ?').get(sub.endpoint) as unknown as SubRow)
}

export function removeSubscription(userId: string, endpoint: string): boolean {
  const result = getDb().prepare('DELETE FROM subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId)
  return Number(result.changes) > 0
}

/** Mazání kvůli odpovědi push služby (404/410) – endpoint je unikátní sám o sobě. */
export function dropSubscription(endpoint: string): void {
  getDb().prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint)
}

export function markSubscriptionSuccess(endpoint: string): void {
  getDb()
    .prepare('UPDATE subscriptions SET last_success_at = ?, failures = 0 WHERE endpoint = ?')
    .run(new Date().toISOString(), endpoint)
}

/** Vrátí nový počet selhání. */
export function markSubscriptionFailure(endpoint: string): number {
  const db = getDb()
  db.prepare('UPDATE subscriptions SET failures = failures + 1 WHERE endpoint = ?').run(endpoint)
  const row = db.prepare('SELECT failures FROM subscriptions WHERE endpoint = ?').get(endpoint) as
    | { failures: number }
    | undefined
  return row?.failures ?? 0
}

/* ------------------------------------------------------------------ */
/*  Kroky ze Zkratky                                                   */
/* ------------------------------------------------------------------ */

export function recordSteps(userId: string, date: string, steps: number, source: string): StepEntry {
  const entry: StepEntry = { date, steps, source, updatedAt: new Date().toISOString() }
  getDb()
    .prepare(
      `INSERT INTO steps (user_id, date, steps, source, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET
         steps = excluded.steps, source = excluded.source, updated_at = excluded.updated_at`,
    )
    .run(userId, date, entry.steps, entry.source, entry.updatedAt)
  return entry
}

export function getSteps(userId: string, date: string): StepEntry | null {
  const row = getDb()
    .prepare('SELECT date, steps, source, updated_at FROM steps WHERE user_id = ? AND date = ?')
    .get(userId, date) as { date: string; steps: number; source: string; updated_at: string } | undefined
  return row ? { date: row.date, steps: row.steps, source: row.source, updatedAt: row.updated_at } : null
}

export function recentSteps(userId: string, days: number): StepEntry[] {
  const rows = getDb()
    .prepare('SELECT date, steps, source, updated_at FROM steps WHERE user_id = ? ORDER BY date DESC LIMIT ?')
    .all(userId, Math.max(1, Math.min(400, Math.round(days)))) as unknown as {
    date: string
    steps: number
    source: string
    updated_at: string
  }[]
  return rows.map((r) => ({ date: r.date, steps: r.steps, source: r.source, updatedAt: r.updated_at }))
}

/* ------------------------------------------------------------------ */
/*  Co už dnes odešlo                                                  */
/* ------------------------------------------------------------------ */

export function wasSent(userId: string, key: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM sent WHERE user_id = ? AND key = ?').get(userId, key)
}

export function wasDelivered(userId: string, key: string): boolean {
  const row = getDb().prepare('SELECT status FROM sent WHERE user_id = ? AND key = ?').get(userId, key) as
    | { status: string }
    | undefined
  return row?.status === 'sent'
}

export function markSent(userId: string, key: string, delivered: boolean): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO sent (user_id, key, status) VALUES (?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET status = excluded.status`,
  ).run(userId, key, delivered ? 'sent' : 'skip')

  // Úklid: držíme jen posledních ~400 záznamů na uživatele.
  db.prepare(
    `DELETE FROM sent WHERE user_id = ? AND key NOT IN (
       SELECT key FROM sent WHERE user_id = ? ORDER BY key DESC LIMIT 400
     )`,
  ).run(userId, userId)
}

/** Kolik notifikací už dnes doopravdy odešlo (podle zápisů, ne podle slotů). */
export function deliveredOn(userId: string, date: string, ignore: string[] = []): number {
  const rows = getDb()
    .prepare("SELECT key FROM sent WHERE user_id = ? AND status = 'sent' AND key LIKE ?")
    .all(userId, `${date}|%`) as unknown as { key: string }[]
  return rows.filter((r) => !ignore.includes(r.key.slice(date.length + 1))).length
}

/* ------------------------------------------------------------------ */
/*  Ztlumené sloty                                                     */
/* ------------------------------------------------------------------ */

export function getMuted(userId: string, slot: string): string | null {
  const row = getDb().prepare('SELECT until FROM muted WHERE user_id = ? AND slot = ?').get(userId, slot) as
    | { until: string }
    | undefined
  return row?.until ?? null
}

export function setMuted(userId: string, slot: string, until: string): void {
  getDb()
    .prepare(
      'INSERT INTO muted (user_id, slot, until) VALUES (?, ?, ?) ON CONFLICT (user_id, slot) DO UPDATE SET until = excluded.until',
    )
    .run(userId, slot, until)
}

export function clearMuted(userId: string, slot: string): void {
  getDb().prepare('DELETE FROM muted WHERE user_id = ? AND slot = ?').run(userId, slot)
}

/* ------------------------------------------------------------------ */
/*  Log                                                                */
/* ------------------------------------------------------------------ */

export interface LogEntry {
  at: string
  kind: string
  detail: string
}

export function addLog(userId: string | null, kind: string, detail: string): void {
  const db = getDb()
  db.prepare('INSERT INTO log (user_id, at, kind, detail) VALUES (?, ?, ?, ?)').run(
    userId,
    new Date().toISOString(),
    kind,
    detail.slice(0, 500),
  )
  // Log je diagnostika, ne archiv – držíme posledních 500 řádků.
  db.prepare('DELETE FROM log WHERE id NOT IN (SELECT id FROM log ORDER BY id DESC LIMIT 500)').run()
}

export function listLog(userId: string, limit = 100): LogEntry[] {
  const rows = getDb()
    .prepare('SELECT at, kind, detail FROM log WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, Math.max(1, Math.min(500, limit))) as unknown as LogEntry[]
  return rows
}

/* ------------------------------------------------------------------ */
/*  Pro plánovač                                                       */
/* ------------------------------------------------------------------ */

/** Uživatelé, kterým má smysl něco posílat – tedy ti s aspoň jedním zařízením. */
export function usersWithSubscriptions(): string[] {
  const rows = getDb().prepare('SELECT DISTINCT user_id FROM subscriptions').all() as unknown as { user_id: string }[]
  return rows.map((r) => r.user_id)
}
