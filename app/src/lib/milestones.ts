/**
 * Milníky.
 *
 * Schválně ne „odznaky za všechno“. Cíl (dostat se na zem, zhubnout) je
 * vzdálený a mezi ním a dneškem je několik měsíců, ve kterých se nic
 * viditelného neděje. Milník je bod, kde se dá zastavit a vidět, že se
 * něco stalo – a odemyká se jen za věci, které něco znamenají.
 *
 * Jednou odemčený milník už nezmizí, i kdyby čísla později klesla.
 */

import { completedBlocks, longestStreak } from './engine'
import type { AppState } from './types'
import type { DateKey } from './date'

export interface Milestone {
  id: string
  title: string
  detail: string
  emoji: string
  /** Splněno? Vyhodnocuje se nad aktuálním stavem. */
  reached: (state: AppState, today: DateKey) => boolean
  /** 0–1, kolik z milníku je hotovo (pro ukazatel u nesplněných). */
  progress?: (state: AppState, today: DateKey) => number
}

function totalSteps(state: AppState): number {
  return Object.values(state.days).reduce((sum, d) => sum + d.steps, 0)
}

function totalBlocks(state: AppState): number {
  return Object.values(state.days).reduce((sum, d) => sum + completedBlocks(d), 0)
}

function bestMeasurement(state: AppState, field: 'plankSec' | 'toeTouchCm', mode: 'max' | 'min'): number | null {
  const values = state.measurements
    .map((m) => m[field])
    .filter((v): v is number => typeof v === 'number')
  if (values.length === 0) return null
  return mode === 'max' ? Math.max(...values) : Math.min(...values)
}

function firstToeTouch(state: AppState): number | null {
  const sorted = state.measurements
    .filter((m) => typeof m.toeTouchCm === 'number')
    .sort((a, b) => a.date.localeCompare(b.date))
  return sorted.length > 0 ? (sorted[0]!.toeTouchCm as number) : null
}

function ratio(value: number, target: number): number {
  return Math.max(0, Math.min(1, value / target))
}

export const MILESTONES: Milestone[] = [
  {
    id: 'first-block',
    title: 'První blok',
    detail: 'Nejtěžší je začít. To máš za sebou.',
    emoji: '🌱',
    reached: (s) => totalBlocks(s) >= 1,
  },
  {
    id: 'week-clean',
    title: 'Sedm dní v řadě',
    detail: 'Týden bez díry. Tady se z toho stává zvyk.',
    emoji: '🔥',
    reached: (s, t) => longestStreak(s, t) >= 7,
    progress: (s, t) => ratio(longestStreak(s, t), 7),
  },
  {
    id: 'month-clean',
    title: 'Třicet dní v řadě',
    detail: 'Měsíc. Tohle už není náhoda.',
    emoji: '🏔️',
    reached: (s, t) => longestStreak(s, t) >= 30,
    progress: (s, t) => ratio(longestStreak(s, t), 30),
  },
  {
    id: 'blocks-50',
    title: '50 odcvičených bloků',
    detail: 'Dvanáct hodin práce na středu těla.',
    emoji: '💪',
    reached: (s) => totalBlocks(s) >= 50,
    progress: (s) => ratio(totalBlocks(s), 50),
  },
  {
    id: 'steps-100k',
    title: '100 000 kroků',
    detail: 'Zhruba 75 kilometrů. Praha–Kolín pěšky.',
    emoji: '🚶',
    reached: (s) => totalSteps(s) >= 100_000,
    progress: (s) => ratio(totalSteps(s), 100_000),
  },
  {
    id: 'steps-500k',
    title: 'Půl milionu kroků',
    detail: 'Kolem 375 km. Praha–Ostrava a ještě kus.',
    emoji: '🗺️',
    reached: (s) => totalSteps(s) >= 500_000,
    progress: (s) => ratio(totalSteps(s), 500_000),
  },
  {
    id: 'gym-first',
    title: 'První posilovna',
    detail: 'Nejhorší je vstoupit dovnitř. Podruhé je to snazší.',
    emoji: '🏋️',
    reached: (s) =>
      Object.values(s.weeklyTaskLogs).some((log) => log.taskId === 'gym' && log.dates.length > 0),
  },
  {
    id: 'plank-60',
    title: 'Minuta v prkně',
    detail: 'Nad minutu už se netrénuje stabilita, ale trpělivost. Přidej těžší variantu.',
    emoji: '⏱️',
    reached: (s) => (bestMeasurement(s, 'plankSec', 'max') ?? 0) >= 60,
    progress: (s) => ratio(bestMeasurement(s, 'plankSec', 'max') ?? 0, 60),
  },
  {
    id: 'toe-halfway',
    title: 'Půl cesty k zemi',
    detail: 'Od prvního měření jsi ušetřil polovinu vzdálenosti.',
    emoji: '📏',
    reached: (s) => {
      const first = firstToeTouch(s)
      const best = bestMeasurement(s, 'toeTouchCm', 'min')
      if (first === null || best === null || first <= 0) return false
      return best <= first / 2
    },
    progress: (s) => {
      const first = firstToeTouch(s)
      const best = bestMeasurement(s, 'toeTouchCm', 'min')
      if (first === null || best === null || first <= 0) return 0
      return ratio(first - best, first / 2)
    },
  },
  {
    id: 'toe-floor',
    title: 'Dlaně na zemi',
    detail: 'Tohle byl ten hlavní důvod, proč jsi začal.',
    emoji: '🙌',
    reached: (s) => (bestMeasurement(s, 'toeTouchCm', 'min') ?? 99) <= 0,
    progress: (s) => {
      const first = firstToeTouch(s)
      const best = bestMeasurement(s, 'toeTouchCm', 'min')
      if (first === null || best === null || first <= 0) return 0
      return ratio(first - best, first)
    },
  },
  {
    id: 'no-debt-4',
    title: 'Čtyři týdny bez dluhu',
    detail: 'Cíl je nastavený tak akorát. Zvedni laťku.',
    emoji: '📈',
    reached: (s) => {
      const closed = s.ledger
        .filter((e) => e.kind === 'steps' && !e.skipped)
        .sort((a, b) => b.week.localeCompare(a.week))
        .slice(0, 4)
      return closed.length === 4 && closed.every((e) => e.debt === 0)
    },
  },
  {
    id: 'target-reached',
    title: '7 000 kroků denně',
    detail: 'Číslo, za kterým se křivka zdravotního přínosu už jen mírně ohýbá.',
    emoji: '🎯',
    reached: (s) => s.settings.steps.weeklyTarget >= s.settings.steps.goalWeeklyTarget,
    progress: (s) => ratio(s.settings.steps.weeklyTarget, s.settings.steps.goalWeeklyTarget),
  },
]

/**
 * Projde milníky a zapíše nově odemčené. Vrací ty, které padly právě teď,
 * aby je šlo uživateli ukázat.
 */
export function checkMilestones(state: AppState, today: DateKey): Milestone[] {
  const fresh: Milestone[] = []
  for (const milestone of MILESTONES) {
    if (state.achievements[milestone.id]) continue
    if (!milestone.reached(state, today)) continue
    state.achievements[milestone.id] = today
    fresh.push(milestone)
  }
  return fresh
}

export function unlockedCount(state: AppState): number {
  return MILESTONES.filter((m) => state.achievements[m.id]).length
}
