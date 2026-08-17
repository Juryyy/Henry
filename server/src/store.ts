import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
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
  /** Denní cíl kroků. */
  stepTarget: number
  /** Dokončené bloky dnes. */
  blocksDone: number
  blocksTarget: number
  /** Indexy bloků, které už jsou dnes hotové – ať nepřipomínáme odcvičené. */
  doneSlots: number[]
  /** Dluh kroků do tohoto týdne. */
  stepDebt: number
  /** Zbývá do splnění týdne. */
  stepsRemainingThisWeek: number
  streak: number
  /** Nesplněné týdenní úkoly (názvy). */
  openTasks: string[]
  /** Jméno pro oslovení. */
  name: string
  /**
   * Posledních pár dní – server z toho pozná, že konkrétní připomínku
   * uživatel opakovaně ignoruje, a na chvíli ji ztlumí.
   */
  history: { date: string; slots: number[]; steps: number; target: number }[]
}

export interface ScheduleConfig {
  enabled: boolean
  timezone: string
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

export interface Database {
  version: number
  subscriptions: StoredSubscription[]
  snapshot: StateSnapshot | null
  schedule: ScheduleConfig
  steps: Record<string, StepEntry>
  /** Klíč `${date}|${slotId}` -> ISO timestamp odeslání. Brání duplicitám. */
  sent: Record<string, string>
  /** Ztlumené sloty: id slotu -> datum, do kterého se nemá posílat. */
  muted: Record<string, string>
  log: { at: string; kind: string; detail: string }[]
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  enabled: true,
  timezone: config.timezone,
  blockTimes: ['07:15', '12:30', '20:00'],
  stepCheckTime: '17:45',
  stepCheckThreshold: 60,
  eveningReviewTime: '21:00',
  weeklyReviewTime: '19:00',
  quietFrom: '21:30',
  quietTo: '07:00',
  tone: 'coach',
}

function emptyDb(): Database {
  return {
    version: 1,
    subscriptions: [],
    snapshot: null,
    schedule: { ...DEFAULT_SCHEDULE },
    steps: {},
    sent: {},
    muted: {},
    log: [],
  }
}

/* ------------------------------------------------------------------ */
/*  Perzistence                                                        */
/* ------------------------------------------------------------------ */

let db: Database = emptyDb()
let dirty = false

export function loadDb(): Database {
  try {
    if (existsSync(config.dataFile)) {
      const parsed = JSON.parse(readFileSync(config.dataFile, 'utf8')) as Partial<Database>
      db = { ...emptyDb(), ...parsed, schedule: { ...DEFAULT_SCHEDULE, ...parsed.schedule } }
    }
  } catch (err) {
    console.error('[henry] databázi se nepodařilo načíst, začínám na čisto:', err)
    db = emptyDb()
  }
  return db
}

export function getDb(): Database {
  return db
}

export function markDirty(): void {
  dirty = true
}

/** Atomický zápis přes dočasný soubor – ať se při pádu nerozbije JSON. */
export function persist(force = false): void {
  if (!dirty && !force) return
  try {
    mkdirSync(dirname(config.dataFile), { recursive: true })
    const tmp = `${config.dataFile}.tmp`
    writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
    renameSync(tmp, config.dataFile)
    dirty = false
  } catch (err) {
    console.error('[henry] databázi se nepodařilo uložit:', err)
  }
}

/* ------------------------------------------------------------------ */
/*  Pomocné operace                                                    */
/* ------------------------------------------------------------------ */

export function addLog(kind: string, detail: string): void {
  db.log.unshift({ at: new Date().toISOString(), kind, detail })
  db.log = db.log.slice(0, 200)
  markDirty()
}

export function upsertSubscription(sub: {
  endpoint: string
  keys: { p256dh: string; auth: string }
  label?: string
}): StoredSubscription {
  const existing = db.subscriptions.find((s) => s.endpoint === sub.endpoint)
  if (existing) {
    existing.keys = sub.keys
    if (sub.label) existing.label = sub.label
    existing.failures = 0
    markDirty()
    return existing
  }
  const created: StoredSubscription = {
    endpoint: sub.endpoint,
    keys: sub.keys,
    label: sub.label ?? 'neznámé zařízení',
    createdAt: new Date().toISOString(),
    failures: 0,
  }
  db.subscriptions.push(created)
  markDirty()
  return created
}

export function removeSubscription(endpoint: string): boolean {
  const before = db.subscriptions.length
  db.subscriptions = db.subscriptions.filter((s) => s.endpoint !== endpoint)
  if (db.subscriptions.length !== before) {
    markDirty()
    return true
  }
  return false
}

export function recordSteps(date: string, steps: number, source: string): StepEntry {
  const entry: StepEntry = { date, steps, source, updatedAt: new Date().toISOString() }
  db.steps[date] = entry
  markDirty()
  return entry
}

/** Zaznamenané kroky za posledních `days` dní, nejnovější první. */
export function recentSteps(days: number): StepEntry[] {
  return Object.values(db.steps)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days)
}

export function wasSent(key: string): boolean {
  return !!db.sent[key]
}

export function markSent(key: string): void {
  db.sent[key] = new Date().toISOString()
  // Úklid: držíme jen posledních ~400 záznamů, ať soubor neroste donekonečna.
  const keys = Object.keys(db.sent)
  if (keys.length > 400) {
    for (const k of keys.sort().slice(0, keys.length - 400)) delete db.sent[k]
  }
  markDirty()
}
