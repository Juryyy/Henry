/**
 * Převod stavu na záznamy a zpátky.
 *
 * Server nerozumí tomu, co posíláme – vidí jen dvojici `kind` + `id`, čas
 * poslední změny a kus JSONu. Celá logika slučování je tady: každý záznam se
 * porovnává sám za sebe, takže ranní odškrtnutý blok z telefonu a odpolední
 * zápis kroků z notebooku přežijí oba.
 *
 * Co se **nesynchronizuje** a proč:
 *
 *  - `ledger` a `lastClosedWeek` – dluhová kniha je odvozená z dnů a nastavení.
 *    Kdyby se přenášela, dvě zařízení by si přetahovala uzávěrku téhož týdne.
 *    Po sloučení se prostě přepočítá (`recalculateFrom`).
 *  - přihlášení – to patří zařízení, ne datům. Cookie se nikam nekopíruje.
 */

import type { AppState, Measurement, Settings, WeeklyTask, WeeklyTaskLog, DayLog } from './types'
import type { DateKey } from './date'

export type RecordKind =
  | 'day'
  | 'measurement'
  | 'task'
  | 'task_log'
  | 'bankruptcy'
  | 'achievement'
  | 'settings'

export interface SyncRecord {
  kind: RecordKind | string
  id: string
  updatedAt: string
  deleted?: boolean
  payload?: unknown
  rev?: number
}

/** Části nastavení, které se přenášejí zvlášť – ať se nepřepisují navzájem. */
const SETTINGS_SECTIONS = ['profile', 'steps', 'exercise', 'notifications'] as const
type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export function key(kind: string, id: string): string {
  return `${kind}:${id}`
}

/* ------------------------------------------------------------------ */
/*  Razítkování změn                                                   */
/* ------------------------------------------------------------------ */

/** Zaznamená, že se záznam právě změnil. Volá se z každé mutace ve storu. */
export function touch(state: AppState, kind: RecordKind, id: string, at = new Date().toISOString()): void {
  state.meta.updatedAt[key(kind, id)] = at
  delete state.meta.deleted[key(kind, id)]
}

/** Náhrobek. Bez něj by smazané měření druhé zařízení vzkřísilo. */
export function tombstone(state: AppState, kind: RecordKind, id: string, at = new Date().toISOString()): void {
  state.meta.deleted[key(kind, id)] = at
  state.meta.updatedAt[key(kind, id)] = at
}

/** Razítko pro celou sekci nastavení. */
export function touchSettings(state: AppState, section: SettingsSection, at?: string): void {
  touch(state, 'settings', section, at)
}

/** Po importu nebo migraci je potřeba orazítkovat všechno naráz. */
export function touchEverything(state: AppState, at = new Date().toISOString()): void {
  for (const record of collectAll(state)) {
    state.meta.updatedAt[key(record.kind, record.id)] = at
  }
}

/* ------------------------------------------------------------------ */
/*  Stav -> záznamy                                                    */
/* ------------------------------------------------------------------ */

function settingsPayload(settings: Settings, section: SettingsSection): unknown {
  if (section === 'steps') return settings.steps
  if (section === 'exercise') return settings.exercise
  if (section === 'notifications') return settings.notifications
  // Profil je to, co zbývá – jméno, pásmo, začátek. `server` schválně ne.
  return {
    name: settings.name,
    timezone: settings.timezone,
    startDate: settings.startDate,
    onboardedAt: settings.onboardedAt,
  }
}

/** Všechny záznamy, které stav obsahuje – bez ohledu na to, kdy se změnily. */
export function collectAll(state: AppState): SyncRecord[] {
  const stamp = (kind: RecordKind, id: string): string =>
    state.meta.updatedAt[key(kind, id)] ?? new Date(0).toISOString()

  const out: SyncRecord[] = []

  for (const [date, day] of Object.entries(state.days)) {
    out.push({ kind: 'day', id: date, updatedAt: stamp('day', date), payload: day })
  }
  for (const m of state.measurements) {
    out.push({ kind: 'measurement', id: m.date, updatedAt: stamp('measurement', m.date), payload: m })
  }
  for (const task of state.weeklyTasks) {
    out.push({ kind: 'task', id: task.id, updatedAt: stamp('task', task.id), payload: task })
  }
  for (const [id, log] of Object.entries(state.weeklyTaskLogs)) {
    out.push({ kind: 'task_log', id, updatedAt: stamp('task_log', id), payload: log })
  }
  for (const b of state.bankruptcies) {
    const id = `${b.date}|${b.kind}`
    out.push({ kind: 'bankruptcy', id, updatedAt: stamp('bankruptcy', id), payload: b })
  }
  for (const [id, at] of Object.entries(state.achievements)) {
    out.push({ kind: 'achievement', id, updatedAt: stamp('achievement', id), payload: { at } })
  }
  for (const section of SETTINGS_SECTIONS) {
    out.push({
      kind: 'settings',
      id: section,
      updatedAt: stamp('settings', section),
      payload: settingsPayload(state.settings, section),
    })
  }

  // Náhrobky za smazané záznamy.
  for (const [k, at] of Object.entries(state.meta.deleted)) {
    const separator = k.indexOf(':')
    out.push({ kind: k.slice(0, separator), id: k.slice(separator + 1), updatedAt: at, deleted: true })
  }

  return out
}

/**
 * Záznamy změněné od zadaného času. `since` prázdné = poprvé, posílá se
 * všechno.
 */
export function collectChanged(state: AppState, since?: string): SyncRecord[] {
  const all = collectAll(state)
  if (!since) return all
  return all.filter((r) => r.updatedAt > since)
}

/* ------------------------------------------------------------------ */
/*  Záznamy -> stav                                                    */
/* ------------------------------------------------------------------ */

export interface ApplyResult {
  /** Kolik záznamů se opravdu promítlo. */
  applied: number
  /** Nejstarší dotčený den – od něj je potřeba přepočítat dluhovou knihu. */
  oldestChangedDay: DateKey | null
  /** Změnilo se nastavení? Pak se musí přepočítat celá kniha. */
  settingsChanged: boolean
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Promítne záznamy ze serveru do stavu. Lokální změna vyhrává jen tehdy,
 * když je novější – jinak by se nikdy nic nestáhlo.
 */
export function applyRecords(state: AppState, records: SyncRecord[]): ApplyResult {
  const result: ApplyResult = { applied: 0, oldestChangedDay: null, settingsChanged: false }

  for (const record of records) {
    if (!record?.kind || !record.id || !record.updatedAt) continue

    const k = key(record.kind, record.id)
    const local = state.meta.updatedAt[k]
    // Odznaky se neslučují časem, ale nejstarším odemčením – viz níž.
    if (local && local >= record.updatedAt && record.kind !== 'achievement') continue

    if (record.deleted) {
      if (applyDeletion(state, record)) result.applied++
      state.meta.deleted[k] = record.updatedAt
      state.meta.updatedAt[k] = record.updatedAt
      if (record.kind === 'day') result.oldestChangedDay = older(result.oldestChangedDay, record.id)
      continue
    }

    if (!applyValue(state, record, result)) continue

    state.meta.updatedAt[k] = record.updatedAt
    delete state.meta.deleted[k]
    result.applied++
  }

  return result
}

function older(current: DateKey | null, candidate: DateKey): DateKey {
  return !current || candidate < current ? candidate : current
}

function applyDeletion(state: AppState, record: SyncRecord): boolean {
  switch (record.kind) {
    case 'day': {
      if (!state.days[record.id]) return false
      delete state.days[record.id]
      return true
    }
    case 'measurement': {
      const before = state.measurements.length
      state.measurements = state.measurements.filter((m) => m.date !== record.id)
      return state.measurements.length !== before
    }
    case 'task': {
      const before = state.weeklyTasks.length
      state.weeklyTasks = state.weeklyTasks.filter((t) => t.id !== record.id)
      return state.weeklyTasks.length !== before
    }
    case 'task_log': {
      if (!state.weeklyTaskLogs[record.id]) return false
      delete state.weeklyTaskLogs[record.id]
      return true
    }
    default:
      return false
  }
}

function applyValue(state: AppState, record: SyncRecord, result: ApplyResult): boolean {
  const payload = record.payload
  if (payload === undefined || payload === null) return false

  switch (record.kind) {
    case 'day': {
      if (!isObject(payload)) return false
      state.days[record.id] = { ...(payload as unknown as DayLog), date: record.id }
      result.oldestChangedDay = older(result.oldestChangedDay, record.id)
      return true
    }
    case 'measurement': {
      if (!isObject(payload)) return false
      const value = { ...(payload as unknown as Measurement), date: record.id }
      const index = state.measurements.findIndex((m) => m.date === record.id)
      if (index >= 0) state.measurements[index] = value
      else state.measurements.push(value)
      state.measurements.sort((a, b) => a.date.localeCompare(b.date))
      return true
    }
    case 'task': {
      if (!isObject(payload)) return false
      const value = { ...(payload as unknown as WeeklyTask), id: record.id }
      const index = state.weeklyTasks.findIndex((t) => t.id === record.id)
      if (index >= 0) state.weeklyTasks[index] = value
      else state.weeklyTasks.push(value)
      return true
    }
    case 'task_log': {
      if (!isObject(payload)) return false
      state.weeklyTaskLogs[record.id] = payload as unknown as WeeklyTaskLog
      return true
    }
    case 'bankruptcy': {
      if (!isObject(payload)) return false
      const index = state.bankruptcies.findIndex((b) => `${b.date}|${b.kind}` === record.id)
      if (index >= 0) state.bankruptcies[index] = payload as never
      else state.bankruptcies.push(payload as never)
      return true
    }
    case 'achievement': {
      // Milník se odemyká jednou. Když ho dvě zařízení hlásí s různým datem,
      // platí to dřívější – gratulace přišla tehdy, ne po synchronizaci.
      const at = isObject(payload) ? String(payload.at ?? '') : String(payload)
      if (!at) return false
      const current = state.achievements[record.id]
      if (current && current <= at) return false
      state.achievements[record.id] = at
      return true
    }
    case 'settings': {
      if (!isObject(payload)) return false
      if (!applySettings(state, record.id, payload)) return false
      result.settingsChanged = true
      return true
    }
    default:
      return false
  }
}

function applySettings(state: AppState, section: string, payload: Record<string, unknown>): boolean {
  switch (section) {
    case 'steps':
      state.settings.steps = { ...state.settings.steps, ...(payload as object) }
      return true
    case 'exercise':
      state.settings.exercise = { ...state.settings.exercise, ...(payload as object) }
      return true
    case 'notifications':
      state.settings.notifications = { ...state.settings.notifications, ...(payload as object) }
      return true
    case 'profile': {
      if (typeof payload.name === 'string') state.settings.name = payload.name
      if (typeof payload.timezone === 'string') state.settings.timezone = payload.timezone
      if (typeof payload.startDate === 'string') state.settings.startDate = payload.startDate
      if (typeof payload.onboardedAt === 'string') state.settings.onboardedAt = payload.onboardedAt
      return true
    }
    default:
      return false
  }
}
