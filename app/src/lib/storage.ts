import type { AppState, Settings, WeeklyTask } from './types'
import { todayKey } from './date'

const STORAGE_KEY = 'henry.state.v1'
export const SCHEMA_VERSION = 1

/* ------------------------------------------------------------------ */
/*  Výchozí hodnoty                                                    */
/* ------------------------------------------------------------------ */

/**
 * Rozložení týdenního cíle kroků na dny. Víkend má vyšší podíl – přes týden
 * je člověk v práci a nachodí míň, o víkendu je prostor to dohnat.
 * Součet musí být 100.
 */
export const DEFAULT_DISTRIBUTION = [13, 13, 13, 13, 14, 17, 17]

export function defaultSettings(): Settings {
  return {
    name: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Prague',
    startDate: todayKey(),
    steps: {
      // Začínáme nízko schválně. Průměrný „sedavý“ dospělý má 3–5 tisíc kroků
      // denně; skočit rovnou na 10 000 je nejrychlejší cesta k tomu appku smazat.
      weeklyTarget: 35_000,
      // Meta: 7 000 kroků/den. Nad tímhle číslem se křivka úmrtnosti v datech
      // z Lancet Public Health (2025) už jen mírně ohýbá – 10 000 je marketing.
      goalWeeklyTarget: 49_000,
      rampEnabled: true,
      // +500 kroků/den po každém splněném týdnu = doporučených 10–20 % nárůstu.
      rampStep: 3_500,
      distribution: [...DEFAULT_DISTRIBUTION],
      debtCapDays: 2,
      carrySurplus: true,
      creditCapDays: 1,
    },
    exercise: {
      blocksPerDay: 3,
      minutesPerBlock: 15,
      level: 1,
      debtCapBlocks: 6,
      graceDaysPerWeek: 1,
      excludedExerciseIds: [],
    },
    notifications: {
      enabled: false,
      blockTimes: ['07:15', '12:30', '20:00'],
      stepCheckTime: '17:45',
      stepCheckThreshold: 60,
      eveningReviewTime: '21:00',
      weeklyReviewTime: '19:00',
      quietFrom: '21:30',
      quietTo: '07:00',
      tone: 'coach',
    },
    server: {
      baseUrl: '',
      token: '',
    },
  }
}

export function defaultWeeklyTasks(): WeeklyTask[] {
  return [
    { id: 'gym', title: 'Posilovna', target: 1, emoji: '🏋️', active: true, rollover: true,
      note: 'Full-body okruh – dřep, tlak, tah, mrtvý tah s lehkou vahou.' },
    { id: 'long-walk', title: 'Dlouhá procházka (60+ min)', target: 1, emoji: '🥾', active: true, rollover: true },
    { id: 'weigh-in', title: 'Zvážit se a změřit pas', target: 1, emoji: '⚖️', active: true, rollover: false },
    { id: 'toe-test', title: 'Test předklonu (cm od země)', target: 1, emoji: '📏', active: true, rollover: false },
    { id: 'no-alcohol', title: '5 dní bez alkoholu', target: 5, emoji: '🚱', active: false, rollover: false },
  ]
}

export function defaultState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(),
    days: {},
    weeklyTasks: defaultWeeklyTasks(),
    weeklyTaskLogs: {},
    measurements: [],
    ledger: [],
    bankruptcies: [],
    achievements: {},
  }
}

/* ------------------------------------------------------------------ */
/*  Načtení / uložení                                                  */
/* ------------------------------------------------------------------ */

/**
 * Hluboké doplnění chybějících klíčů z výchozího objektu. Díky tomu přežije
 * uložený stav přidání nového nastavení bez migrace.
 */
function mergeDefaults<T>(fallback: T, incoming: unknown): T {
  if (incoming === null || incoming === undefined) return fallback
  if (Array.isArray(fallback)) {
    return (Array.isArray(incoming) ? incoming : fallback) as T
  }
  if (typeof fallback === 'object' && typeof incoming === 'object') {
    const out: Record<string, unknown> = { ...(incoming as Record<string, unknown>) }
    for (const [key, value] of Object.entries(fallback as Record<string, unknown>)) {
      out[key] = mergeDefaults(value, (incoming as Record<string, unknown>)[key])
    }
    return out as T
  }
  return (typeof incoming === typeof fallback ? incoming : fallback) as T
}

/** Postupné migrace uloženého stavu na aktuální schéma. */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const state = { ...raw }
  // Zatím jen jedna verze schématu. Až přibude v2, přidá se sem krok:
  //   if ((state.schemaVersion ?? 0) < 2) { …; state.schemaVersion = 2 }
  state.schemaVersion = SCHEMA_VERSION
  return state
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = migrate(JSON.parse(raw) as Record<string, unknown>)
    return mergeDefaults(defaultState(), parsed)
  } catch (err) {
    console.error('[henry] stav se nepodařilo načíst, začínám na čisto', err)
    return defaultState()
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Uloží stav (debounced, aby se při psaní do inputu netrhal UI thread). */
export function saveState(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (err) {
      console.error('[henry] stav se nepodařilo uložit', err)
    }
  }, 250)
}

/** Okamžitý zápis – volá se před zavřením stránky. */
export function flushState(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (err) {
    console.error('[henry] stav se nepodařilo uložit', err)
  }
}

/* ------------------------------------------------------------------ */
/*  Export / import                                                    */
/* ------------------------------------------------------------------ */

export function exportState(state: AppState): string {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)
}

export function importState(json: string): AppState {
  const parsed = migrate(JSON.parse(json) as Record<string, unknown>)
  return mergeDefaults(defaultState(), parsed)
}
