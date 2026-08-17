import { computed, reactive, ref, watch } from 'vue'
import {
  addDays,
  addWeeks,
  todayKey,
  weekKeyOf,
  type DateKey,
  type WeekKey,
} from '@/lib/date'
import {
  closeDueWeeks,
  currentStreak,
  dailyStepTarget,
  dayStatus,
  latestMeasurement,
  longestStreak,
  summarizeWeek,
} from '@/lib/engine'
import { exportState, flushState, importState, loadState, saveState } from '@/lib/storage'
import type {
  AppState,
  BlockLog,
  BlockSlot,
  DayLog,
  LedgerKind,
  Measurement,
  Settings,
  StepSource,
  WeeklyTask,
} from '@/lib/types'

/* ------------------------------------------------------------------ */
/*  Stav                                                               */
/* ------------------------------------------------------------------ */

export const state = reactive<AppState>(loadState())

/** Dnešní datum jako reaktivní hodnota – přepne se i když appka zůstane otevřená přes půlnoc. */
export const today = ref<DateKey>(todayKey())

export const currentWeek = computed<WeekKey>(() => weekKeyOf(today.value))

let persistPaused = false

watch(
  state,
  () => {
    if (!persistPaused) saveState(state)
  },
  { deep: true },
)

/* ------------------------------------------------------------------ */
/*  Životní cyklus                                                     */
/* ------------------------------------------------------------------ */

/** Zkontroluje, jestli nezačal nový den / týden, a doúčtuje dluhovou knihu. */
export function refreshClock(): void {
  const key = todayKey()
  if (key !== today.value) today.value = key
  closeDueWeeks(state, today.value)
}

export function initStore(): void {
  refreshClock()
  // Kontrola každou minutu pokryje i případ, kdy telefon usne a probudí se
  // druhý den s otevřenou appkou.
  setInterval(refreshClock, 60_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshClock()
    // Uložit i při odchodu do pozadí. iOS umí appku na pozadí zabít bez toho,
    // aby stihla přijít událost `pagehide`, a rozdělaná změna by se ztratila.
    else flushState(state)
  })
  window.addEventListener('pagehide', () => flushState(state))
}

/* ------------------------------------------------------------------ */
/*  Odvozené hodnoty                                                   */
/* ------------------------------------------------------------------ */

export const settings = computed<Settings>(() => state.settings)

export const todayLog = computed<DayLog | undefined>(() => state.days[today.value])

export const todayStatus = computed(() => dayStatus(state, today.value, today.value))

export const weekSummary = computed(() => summarizeWeek(state, currentWeek.value, today.value))

export const streak = computed(() => currentStreak(state, today.value))

export const bestStreak = computed(() => longestStreak(state, today.value))

export const lastMeasurement = computed(() => latestMeasurement(state))

/**
 * Kolik kroků má uživatel dnes ujít. Bere v úvahu dluh: zbytek týdne se
 * rozpočítá na zbývající dny, takže po zkaženém pondělí cíl vyskočí.
 */
export const stepsNeededToday = computed(() => {
  // `remaining` už dnešní nachozené kroky odečítá, takže po rozpočítání
  // na zbývající dny vyjde přímo „kolik ještě dnes“.
  return Math.max(0, weekSummary.value.steps.perRemainingDay)
})

/** Základní denní cíl podle rozložení, bez vlivu dluhu. */
export const baseStepTarget = computed(() => dailyStepTarget(state, today.value))

/* ------------------------------------------------------------------ */
/*  Akce – dny a kroky                                                 */
/* ------------------------------------------------------------------ */

export function ensureDay(date: DateKey): DayLog {
  let day = state.days[date]
  if (!day) {
    day = { date, steps: 0, stepsSource: 'manual', blocks: [] }
    state.days[date] = day
  }
  return day
}

export function setSteps(date: DateKey, steps: number, source: StepSource = 'manual'): void {
  const day = ensureDay(date)
  day.steps = Math.max(0, Math.round(steps))
  day.stepsSource = source
  day.stepsUpdatedAt = new Date().toISOString()
}

export function addSteps(date: DateKey, delta: number): void {
  const day = ensureDay(date)
  setSteps(date, day.steps + delta, day.stepsSource)
}

export function setRestDay(date: DateKey, rest: boolean): void {
  ensureDay(date).restDay = rest
}

export function setNote(date: DateKey, note: string): void {
  ensureDay(date).note = note.trim() || undefined
}

/* ------------------------------------------------------------------ */
/*  Akce – bloky cvičení                                               */
/* ------------------------------------------------------------------ */

export function getBlockLog(date: DateKey, slot: BlockSlot, planId: string): BlockLog {
  const day = ensureDay(date)
  let block = day.blocks.find((b) => b.slot === slot)
  if (!block) {
    block = { slot, planId, doneExerciseIds: [], skippedExerciseIds: [] }
    day.blocks.push(block)
    day.blocks.sort((a, b) => a.slot - b.slot)
  }
  // Plán se mohl změnit (jiná úroveň, jiný den) – zahodíme staré odškrtnutí.
  if (block.planId !== planId && !block.completedAt) {
    block.planId = planId
    block.doneExerciseIds = []
    block.skippedExerciseIds = []
  }
  return block
}

export function toggleExerciseDone(
  date: DateKey,
  slot: BlockSlot,
  planId: string,
  exerciseId: string,
): void {
  const block = getBlockLog(date, slot, planId)
  const idx = block.doneExerciseIds.indexOf(exerciseId)
  if (idx >= 0) block.doneExerciseIds.splice(idx, 1)
  else {
    block.doneExerciseIds.push(exerciseId)
    const skipped = block.skippedExerciseIds.indexOf(exerciseId)
    if (skipped >= 0) block.skippedExerciseIds.splice(skipped, 1)
  }
}

export function skipExercise(
  date: DateKey,
  slot: BlockSlot,
  planId: string,
  exerciseId: string,
): void {
  const block = getBlockLog(date, slot, planId)
  if (!block.skippedExerciseIds.includes(exerciseId)) block.skippedExerciseIds.push(exerciseId)
  const done = block.doneExerciseIds.indexOf(exerciseId)
  if (done >= 0) block.doneExerciseIds.splice(done, 1)
}

export function completeBlock(
  date: DateKey,
  slot: BlockSlot,
  planId: string,
  durationSec?: number,
): void {
  const block = getBlockLog(date, slot, planId)
  block.completedAt = new Date().toISOString()
  if (durationSec !== undefined) block.durationSec = Math.round(durationSec)
}

export function uncompleteBlock(date: DateKey, slot: BlockSlot): void {
  const day = state.days[date]
  const block = day?.blocks.find((b) => b.slot === slot)
  if (block) {
    block.completedAt = undefined
    block.durationSec = undefined
  }
}

export function isBlockDone(date: DateKey, slot: BlockSlot): boolean {
  return !!state.days[date]?.blocks.find((b) => b.slot === slot)?.completedAt
}

/* ------------------------------------------------------------------ */
/*  Akce – týdenní úkoly                                               */
/* ------------------------------------------------------------------ */

export function toggleTaskDone(taskId: string, date: DateKey = today.value): void {
  const week = weekKeyOf(date)
  const key = `${week}|${taskId}`
  const log = state.weeklyTaskLogs[key] ?? { week, taskId, dates: [], carried: 0 }
  const idx = log.dates.indexOf(date)
  if (idx >= 0) log.dates.splice(idx, 1)
  else log.dates.push(date)
  log.dates.sort()
  state.weeklyTaskLogs[key] = log
}

export function upsertTask(task: WeeklyTask): void {
  const idx = state.weeklyTasks.findIndex((t) => t.id === task.id)
  if (idx >= 0) state.weeklyTasks[idx] = task
  else state.weeklyTasks.push(task)
}

export function removeTask(taskId: string): void {
  state.weeklyTasks = state.weeklyTasks.filter((t) => t.id !== taskId)
}

/* ------------------------------------------------------------------ */
/*  Akce – míry                                                        */
/* ------------------------------------------------------------------ */

export function saveMeasurement(m: Measurement): void {
  const idx = state.measurements.findIndex((x) => x.date === m.date)
  const clean: Measurement = { ...m }
  if (idx >= 0) state.measurements[idx] = { ...state.measurements[idx], ...clean }
  else state.measurements.push(clean)
  state.measurements.sort((a, b) => a.date.localeCompare(b.date))
}

export function removeMeasurement(date: DateKey): void {
  state.measurements = state.measurements.filter((m) => m.date !== date)
}

/* ------------------------------------------------------------------ */
/*  Akce – dluh                                                        */
/* ------------------------------------------------------------------ */

/**
 * Vyhlášení bankrotu. Vědomé, jednorázové smazání dluhu – lepší než
 * appku smazat z telefonu. Víc než jednou za 30 dní to nejde.
 */
export function canDeclareBankruptcy(): boolean {
  const last = state.bankruptcies.at(-1)
  if (!last) return true
  const days = (Date.parse(today.value) - Date.parse(last.date)) / 86_400_000
  return days >= 30
}

export function declareBankruptcy(kind: LedgerKind | 'all', reason?: string): boolean {
  if (!canDeclareBankruptcy()) return false
  const week = currentWeek.value
  const prev = addWeeks(week, -1)
  const cleared = state.ledger
    .filter((e) => e.week === prev && (kind === 'all' || e.kind === kind))
    .reduce((sum, e) => sum + e.debt, 0)
  state.bankruptcies.push({ date: today.value, kind, clearedDebt: cleared, reason })
  return true
}

/* ------------------------------------------------------------------ */
/*  Akce – nastavení a data                                            */
/* ------------------------------------------------------------------ */

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(state.settings, patch)
}

export function exportJson(): string {
  return exportState(state)
}

export function importJson(json: string): void {
  const next = importState(json)
  persistPaused = true
  Object.assign(state, next)
  persistPaused = false
  flushState(state)
  refreshClock()
}

export function resetAll(): void {
  localStorage.removeItem('henry.state.v1')
  location.reload()
}

/* ------------------------------------------------------------------ */
/*  Snímek pro server                                                  */
/* ------------------------------------------------------------------ */

/** Data, která server potřebuje, aby uměl napsat konkrétní notifikaci. */
export function buildSnapshot() {
  const week = weekSummary.value
  const status = todayStatus.value

  // Posledních pět dní: server z toho pozná, kterou připomínku uživatel
  // opakovaně ignoruje, a na pár dní ji ztlumí.
  const history = Array.from({ length: 5 }, (_, i) => {
    const date = addDays(today.value, -i)
    const day = state.days[date]
    return {
      date,
      slots: (day?.blocks ?? []).filter((b) => b.completedAt).map((b) => b.slot),
      steps: day?.steps ?? 0,
      target: dailyStepTarget(state, date),
    }
  })

  return {
    history,
    date: today.value,
    steps: status.steps,
    stepsNeededToday: week.steps.perRemainingDay,
    stepTarget: status.stepTarget,
    blocksDone: status.blocksDone,
    blocksTarget: status.blocksTarget,
    doneSlots: (todayLog.value?.blocks ?? []).filter((b) => b.completedAt).map((b) => b.slot),
    stepDebt: week.steps.debtIn,
    stepsRemainingThisWeek: week.steps.remaining,
    streak: streak.value,
    openTasks: week.tasks.filter((t) => t.remaining > 0).map((t) => t.task.title),
    name: state.settings.name,
  }
}
