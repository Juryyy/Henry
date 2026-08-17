/**
 * Jádro logiky: dluh za kroky a za bloky cvičení, uzavírání týdnů,
 * série (streak) a skóre dne.
 *
 * Všechno tady jsou čisté funkce nad `AppState` – nic nemutuje globální stav,
 * takže se to dá testovat bez prohlížeče (viz engine.test.ts).
 *
 * ── Jak funguje dluh ──────────────────────────────────────────────────
 * Týden je jeden „hrnec“. Do hrnce se nasype týdenní cíl + dluh z minulého
 * týdne − kredit z minulého týdne. Cokoli za týden nachodíš, se z hrnce
 * odečítá. V neděli o půlnoci se hrnec uzavře:
 *
 *   zbytek > 0  →  dluh do dalšího týdne (ZASTROPOVANÝ)
 *   zbytek < 0  →  kredit do dalšího týdne (taky zastropovaný)
 *
 * Strop je tam schválně. Bez něj se z aplikace po dvou zkažených týdnech
 * stane nesplatitelná hypotéka a člověk to zahodí. Se stropem je nejhorší
 * možný scénář „příští týden dva dny navíc“, což se dohnat dá.
 */

import {
  addDays,
  addWeeks,
  daysBetween,
  elapsedDaysInWeek,
  todayKey,
  weekDays,
  weekKeyOf,
  weekdayIndex,
  type DateKey,
  type WeekKey,
} from './date'
import type {
  AppState,
  DayLog,
  LedgerEntry,
  LedgerKind,
  WeeklyTask,
  WeeklyTaskLog,
} from './types'

/* ------------------------------------------------------------------ */
/*  Cíle                                                               */
/* ------------------------------------------------------------------ */

/** Průměrný denní cíl kroků (týdenní cíl / 7). */
export function averageDailyStepTarget(state: AppState): number {
  return Math.round(state.settings.steps.weeklyTarget / 7)
}

/**
 * Rozložení týdne převedené na podíly, které dávají dohromady 1.
 * Když je nastavení rozbité (samé nuly, texty z formuláře), vrací rovnoměrné.
 */
export function normalizedDistribution(state: AppState): number[] {
  const raw = state.settings.steps.distribution.map((v) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : 0
  })
  const sum = raw.reduce((a, b) => a + b, 0)
  if (sum <= 0) return Array.from({ length: 7 }, () => 1 / 7)
  return raw.map((v) => v / sum)
}

/** Cíl kroků pro konkrétní den podle rozložení Po–Ne. */
export function dailyStepTarget(state: AppState, date: DateKey): number {
  const share = normalizedDistribution(state)[weekdayIndex(date)] ?? 1 / 7
  return Math.round(state.settings.steps.weeklyTarget * share)
}

/** Kolik bloků cvičení se za týden reálně vyžaduje (dny milosti se odečítají). */
export function weeklyBlockTarget(state: AppState): number {
  const { blocksPerDay, graceDaysPerWeek } = state.settings.exercise
  const days = Math.max(1, 7 - Math.max(0, Math.min(6, graceDaysPerWeek)))
  return blocksPerDay * days
}

/**
 * Strop dluhu podle druhu.
 *
 * Proč zrovna 2 dny: dluh 2 denních dávek znamená, že příští týden ujdeš
 * devět denních dávek za sedm dní, tedy 1,29× svého běžného objemu. Přesně
 * to je horní hranice bezpečného pásma poměru akutní/chronické zátěže
 * (0,8–1,3), nad kterým v datech začíná růst riziko přetížení. Bez stropu by
 * se z týdenního výpadku stal 20tisícový nedělní pochod – metabolicky v pohodě,
 * pro nezvyklé šlachy ne.
 */
export function debtCap(state: AppState, kind: LedgerKind): number {
  if (kind === 'steps') {
    return Math.round(averageDailyStepTarget(state) * state.settings.steps.debtCapDays)
  }
  // Bloků se dá za týden odcvičit jen omezený počet. Kdyby byl strop vyšší
  // než volné místo mezi týdenním cílem a tímhle maximem, vznikl by dluh,
  // který nejde nikdy splatit – a Henry by donekonečna hlásil nesplněno.
  const headroom = Math.max(0, state.settings.exercise.blocksPerDay * 7 - weeklyBlockTarget(state))
  return Math.min(state.settings.exercise.debtCapBlocks, headroom)
}

/** Strop kreditu podle druhu. */
export function creditCap(state: AppState, kind: LedgerKind): number {
  if (kind === 'steps') {
    return state.settings.steps.carrySurplus
      ? Math.round(averageDailyStepTarget(state) * state.settings.steps.creditCapDays)
      : 0
  }
  // Přebytečné bloky se nepřenášejí – odcvičit 5 bloků v neděli není důvod
  // vynechat pondělí, protahování má smysl jen když je pravidelné.
  return 0
}

/* ------------------------------------------------------------------ */
/*  Načítání dat z týdne                                               */
/* ------------------------------------------------------------------ */

/** Počet dokončených bloků daného dne. */
export function completedBlocks(day: DayLog | undefined): number {
  if (!day) return 0
  return day.blocks.filter((b) => !!b.completedAt).length
}

/** Součet kroků za týden. */
export function weekSteps(state: AppState, week: WeekKey): number {
  return weekDays(week).reduce((sum, d) => sum + (state.days[d]?.steps ?? 0), 0)
}

/** Součet dokončených bloků za týden. */
export function weekBlocks(state: AppState, week: WeekKey): number {
  return weekDays(week).reduce((sum, d) => sum + completedBlocks(state.days[d]), 0)
}

/** Má týden vůbec nějaká data? Týden bez dat se neuzavírá jako selhání. */
export function weekHasData(state: AppState, week: WeekKey): boolean {
  return weekDays(week).some((d) => {
    const day = state.days[d]
    if (!day) return false
    // Rozdělaný blok se nepočítá. Otevřít obrazovku cvičení a hned ji zavřít
    // založí prázdný záznam bloku – kdyby stačil, změnil by se tím celý týden
    // z „appka se nepoužívala“ na „nesplněno“ a naskočil by plný dluh.
    return day.steps > 0 || day.blocks.some((b) => !!b.completedAt) || !!day.note || !!day.restDay
  })
}

/* ------------------------------------------------------------------ */
/*  Dluhová kniha                                                      */
/* ------------------------------------------------------------------ */

function findEntry(state: AppState, week: WeekKey, kind: LedgerKind): LedgerEntry | undefined {
  return state.ledger.find((e) => e.week === week && e.kind === kind)
}

/**
 * Co vstupuje do daného týdne z minulosti. Vyhlášený bankrot v tomhle týdnu
 * dluh vynuluje (kredit nechává být – ten si člověk poctivě nachodil).
 */
export function carryInto(state: AppState, week: WeekKey, kind: LedgerKind): { debt: number; credit: number } {
  const prev = findEntry(state, addWeeks(week, -1), kind)
  let debt = prev?.debt ?? 0
  const credit = prev?.credit ?? 0
  const wiped = state.bankruptcies.some(
    (b) => weekKeyOf(b.date) === week && (b.kind === kind || b.kind === 'all'),
  )
  if (wiped) debt = 0
  return { debt, credit }
}

/** Kolik se má daný týden splnit (základ + dluh − kredit, minimálně 0). */
export function requiredFor(state: AppState, week: WeekKey, kind: LedgerKind): number {
  const base = kind === 'steps' ? state.settings.steps.weeklyTarget : weeklyBlockTarget(state)
  const { debt, credit } = carryInto(state, week, kind)
  return Math.max(0, base + debt - credit)
}

/* ------------------------------------------------------------------ */
/*  Přehled týdne                                                      */
/* ------------------------------------------------------------------ */

export type PaceStatus = 'ahead' | 'on-track' | 'behind' | 'critical' | 'done'

export interface KindSummary {
  kind: LedgerKind
  /** Základní týdenní cíl bez dluhu. */
  base: number
  debtIn: number
  creditIn: number
  /** Kolik se má tenhle týden splnit celkem. */
  required: number
  achieved: number
  remaining: number
  /** Kolik zbývá na den, když to rozpočítám na zbývající dny včetně dneška. */
  perRemainingDay: number
  /**
   * Dnešní porce. Počítá se z toho, co bylo hotové *před* dneškem, takže se
   * během dne nemění – ujdeš tisíc kroků a o tisíc ti klesne „zbývá dnes“,
   * ne o sedminu.
   */
  todayShare: number
  /** Kolik z dnešní porce ještě zbývá. */
  todayRemaining: number
  /** Kolik by mělo být hotovo, kdyby šel člověk rovnoměrně. */
  expectedByNow: number
  progressPct: number
  pace: PaceStatus
}

export interface WeekSummary {
  week: WeekKey
  isCurrent: boolean
  daysElapsed: number
  /** Zbývající dny včetně dneška (v minulém týdnu 0). */
  daysRemaining: number
  steps: KindSummary
  blocks: KindSummary
  tasks: TaskSummary[]
}

export interface TaskSummary {
  task: WeeklyTask
  target: number
  carried: number
  done: number
  remaining: number
  dates: DateKey[]
}

function paceOf(achieved: number, required: number, expected: number, daysRemaining: number): PaceStatus {
  if (required <= 0 || achieved >= required) return 'done'
  if (achieved >= expected) return achieved > expected * 1.15 ? 'ahead' : 'on-track'

  const shortfall = expected - achieved
  // Poslední den je přísnější, ale ne absolutně – kdo je v neděli na 95 %,
  // nemá vidět červenou.
  if (shortfall > required * 0.25) return 'critical'
  if (daysRemaining <= 1 && shortfall > required * 0.1) return 'critical'
  return 'behind'
}

/**
 * Kolik dní týdne „už proběhlo“ pro účel očekávaného tempa.
 *
 * Celé dny + rozdělaná část dneška. Bez toho by appka v pondělí v sedm ráno
 * hlásila, že jsi pozadu, protože ještě nemáš nachozeno – a začínat den
 * červeným číslem je ta nejhorší možná motivace.
 */
function elapsedFraction(daysElapsed: number, isCurrent: boolean, minutesNow: number): number {
  if (!isCurrent) return Math.min(7, daysElapsed)
  const DAY_START = 7 * 60
  const DAY_END = 22 * 60
  const progress = Math.max(0, Math.min(1, (minutesNow - DAY_START) / (DAY_END - DAY_START)))
  return Math.max(0, daysElapsed - 1) + progress
}

interface KindInput {
  achieved: number
  achievedToday: number
  /** Jaká část týdne už uplynula, 0–7 (včetně rozdělaného dneška). */
  elapsed: number
  daysRemaining: number
  /** Podíl dnešního dne na zbytku týdne (1 = rovnoměrně). */
  todayWeight: number
  /** Součet podílů zbývajících dní včetně dneška. */
  remainingWeight: number
  /**
   * Jaká část týdenního objemu měla být hotová k tomuhle okamžiku, 0–1.
   * Počítá se z rozložení, ne lineárně – kdo má víkend nabitý a přes týden
   * volnější, není ve středu „pozadu“, jen podle plánu.
   */
  expectedFraction: number
}

function summarizeKind(
  state: AppState,
  week: WeekKey,
  kind: LedgerKind,
  input: KindInput,
): KindSummary {
  const { achieved, achievedToday, daysRemaining, todayWeight, remainingWeight, expectedFraction } = input

  // U uzavřeného týdne platí celý rozpis z knihy – jinak by změna nastavení
  // zpětně přepsala historii a řádky „základ + dluh − kredit = splnit“
  // by přestaly dávat součet.
  const closed = findEntry(state, week, kind)
  const live = carryInto(state, week, kind)
  const base = closed?.base ?? (kind === 'steps' ? state.settings.steps.weeklyTarget : weeklyBlockTarget(state))
  const debt = closed?.debtIn ?? live.debt
  const credit = closed?.creditIn ?? live.credit
  const required = closed ? closed.required : Math.max(0, base + debt - credit)
  const remaining = Math.max(0, required - achieved)
  const perRemainingDay = daysRemaining > 0 ? Math.ceil(remaining / daysRemaining) : remaining

  // Dnešní porce respektuje rozložení týdne: když má sobota v nastavení
  // vyšší podíl, dostane víc než středa.
  const beforeToday = Math.max(0, achieved - achievedToday)
  const missing = Math.max(0, required - beforeToday)
  // Podíly na konci týdne můžou být nulové (uživatel si víkend vynuloval).
  // Pak by zbytek nikam nespadl, proto rovnoměrné dělení jako záloha.
  const share = remainingWeight > 0 ? todayWeight / remainingWeight : 1 / Math.max(1, daysRemaining)
  const todayShare =
    daysRemaining > 0
      ? // Epsilon je tam kvůli dělení podílů: 1/7 v plovoucí čárce vyjde
        // o vlásek nad celé číslo a `ceil` by z 5 000 udělal 5 001.
        Math.max(0, Math.ceil(missing * share - 1e-6))
      : 0
  const todayRemaining = Math.max(0, todayShare - achievedToday)

  const expectedByNow = Math.round(required * Math.max(0, Math.min(1, expectedFraction)))
  return {
    kind,
    base,
    debtIn: debt,
    creditIn: credit,
    required,
    achieved,
    remaining,
    perRemainingDay,
    todayShare,
    todayRemaining,
    expectedByNow,
    progressPct: required > 0 ? Math.min(100, Math.round((achieved / required) * 100)) : 100,
    pace: paceOf(achieved, required, expectedByNow, daysRemaining),
  }
}

export function summarizeWeek(
  state: AppState,
  week: WeekKey,
  today: DateKey = todayKey(),
  minutesNow: number = new Date().getHours() * 60 + new Date().getMinutes(),
): WeekSummary {
  const currentWeek = weekKeyOf(today)
  const isCurrent = week === currentWeek
  const isPast = daysBetween(week, currentWeek) > 0

  const daysElapsed = isPast ? 7 : elapsedDaysInWeek(week, today)
  const daysRemaining = isCurrent ? 7 - weekdayIndex(today) : 0
  const elapsed = elapsedFraction(daysElapsed, isCurrent, minutesNow)

  const stepsToday = isCurrent ? (state.days[today]?.steps ?? 0) : 0
  const blocksToday = isCurrent ? completedBlocks(state.days[today]) : 0

  const todayIndex = weekdayIndex(today)
  const dist = normalizedDistribution(state)

  const stepWeights = {
    todayWeight: isCurrent ? (dist[todayIndex] ?? 1 / 7) : 0,
    remainingWeight: isCurrent ? dist.slice(todayIndex).reduce((a, b) => a + b, 0) : 0,
  }
  // Bloky se rozdělují rovnoměrně – nastavení rozložení se týká jen kroků.
  const blockWeights = { todayWeight: 1, remainingWeight: daysRemaining }

  // Očekávaný podíl: celé uplynulé dny podle svých vah plus rozdělaná
  // část dneška podle jeho vlastní váhy.
  const wholeDays = Math.max(0, Math.floor(elapsed))
  const todayProgress = Math.max(0, Math.min(1, elapsed - wholeDays))
  const stepExpected =
    dist.slice(0, Math.min(7, wholeDays)).reduce((a, b) => a + b, 0) +
    (wholeDays < 7 ? (dist[wholeDays] ?? 0) * todayProgress : 0)
  const blockExpected = Math.min(1, elapsed / 7)

  return {
    week,
    isCurrent,
    daysElapsed,
    daysRemaining,
    steps: summarizeKind(state, week, 'steps', {
      achieved: weekSteps(state, week),
      achievedToday: stepsToday,
      elapsed,
      daysRemaining,
      expectedFraction: stepExpected,
      ...stepWeights,
    }),
    blocks: summarizeKind(state, week, 'blocks', {
      achieved: weekBlocks(state, week),
      achievedToday: blocksToday,
      elapsed,
      daysRemaining,
      expectedFraction: blockExpected,
      ...blockWeights,
    }),
    tasks: summarizeTasks(state, week),
  }
}

/* ------------------------------------------------------------------ */
/*  Týdenní úkoly                                                      */
/* ------------------------------------------------------------------ */

export function taskLogKey(week: WeekKey, taskId: string): string {
  return `${week}|${taskId}`
}

export function getTaskLog(state: AppState, week: WeekKey, taskId: string): WeeklyTaskLog {
  return (
    state.weeklyTaskLogs[taskLogKey(week, taskId)] ?? { week, taskId, dates: [], carried: 0 }
  )
}

/**
 * Dluh u týdenních úkolů. Přenáší se jen u úkolů s `rollover` a maximálně
 * jeden kus – „třikrát do posilovny příští týden“ nikdo neudělá.
 */
export function carriedTaskCount(state: AppState, week: WeekKey, task: WeeklyTask): number {
  if (!task.rollover) return 0
  const prevWeek = addWeeks(week, -1)
  // Před začátkem sledování se nic nepřenáší – jinak by první týden startoval
  // s dluhem z doby, kdy appka ještě neexistovala.
  if (daysBetween(weekKeyOf(state.settings.startDate), prevWeek) < 0) return 0

  // Týden, ve kterém uživatel appku vůbec neotevřel, neúčtujeme ani
  // u úkolů – stejně jako u kroků a bloků.
  if (!weekHasData(state, prevWeek)) return 0

  // Chybějící záznam znamená „minulý týden se s tím vůbec nehnulo“,
  // což je ten nejběžnější způsob, jak úkol nesplnit.
  const prev = state.weeklyTaskLogs[taskLogKey(prevWeek, task.id)] ?? { dates: [], carried: 0 }
  const prevRequired = task.target + prev.carried
  const missed = prevRequired - prev.dates.length
  return Math.max(0, Math.min(1, missed))
}

export function summarizeTasks(state: AppState, week: WeekKey): TaskSummary[] {
  return state.weeklyTasks
    .filter((t) => t.active)
    .map((task) => {
      const log = getTaskLog(state, week, task.id)
      const carried = log.carried || carriedTaskCount(state, week, task)
      const target = task.target + carried
      const done = log.dates.length
      return { task, target, carried, done, remaining: Math.max(0, target - done), dates: log.dates }
    })
}

/* ------------------------------------------------------------------ */
/*  Uzavírání týdnů                                                    */
/* ------------------------------------------------------------------ */

function closeKind(
  state: AppState,
  week: WeekKey,
  kind: LedgerKind,
  now: string,
): LedgerEntry {
  const achieved = kind === 'steps' ? weekSteps(state, week) : weekBlocks(state, week)
  const required = requiredFor(state, week, kind)
  const { debt: debtIn } = carryInto(state, week, kind)
  const leftover = required - achieved

  // Týden bez jediného záznamu = uživatel appku nepoužíval (dovolená, nemoc).
  // Nedostatek dat není důkaz nečinnosti, takže z toho nový dluh neděláme –
  // jen protáhneme dál to, co už dlužil.
  const base = kind === 'steps' ? state.settings.steps.weeklyTarget : weeklyBlockTarget(state)
  const { credit: creditInNow } = carryInto(state, week, kind)

  if (!weekHasData(state, week)) {
    const creditIn = creditInNow
    return {
      week, kind, required, achieved, base, debtIn, creditIn,
      debt: Math.min(debtIn, debtCap(state, kind)),
      // Kredit se protahuje dál stejně jako dluh – nachodil si ho poctivě
      // a týden bez dat není důvod mu ho sebrat. Když má ale uživatel přenos
      // přebytku vypnutý, nemá se objevit ani tudy.
      rawDebt: debtIn, credit: creditCap(state, kind) > 0 ? creditIn : 0,
      forgiven: 0, closedAt: now, skipped: true,
    }
  }

  if (leftover > 0) {
    const cap = debtCap(state, kind)
    const debt = Math.min(leftover, cap)
    return {
      week, kind, required, achieved, base, debtIn, creditIn: creditInNow,
      debt, rawDebt: leftover, credit: 0, forgiven: leftover - debt, closedAt: now,
    }
  }

  const credit = Math.min(-leftover, creditCap(state, kind))
  return {
    week, kind, required, achieved, base, debtIn, creditIn: creditInNow,
    debt: 0, rawDebt: 0, credit, forgiven: 0, closedAt: now,
  }
}

/**
 * Uzavře všechny týdny, které už skončily a ještě nejsou v knize.
 * Vrací nové (mutovaný stav se nevrací – funkce zapisuje přímo do `state`,
 * protože se volá nad reaktivním storem).
 */
export interface CloseOptions {
  /**
   * Nezvedat laťku. Používá se při přepočtu už jednou uzavřených týdnů,
   * kdy se zvýšení nepodařilo vrátit zpět – jinak by se přičetlo podruhé.
   */
  skipRamp?: boolean
}

export function closeDueWeeks(
  state: AppState,
  today: DateKey = todayKey(),
  options: CloseOptions = {},
): LedgerEntry[] {
  const currentWeek = weekKeyOf(today)
  const firstWeek = weekKeyOf(state.settings.startDate)
  const added: LedgerEntry[] = []
  const now = new Date().toISOString()

  // Ochrana proti nesmyslně staré startDate (např. po importu cizích dat).
  const maxWeeksBack = 260
  let week = state.lastClosedWeek ? addWeeks(state.lastClosedWeek, 1) : firstWeek
  if (daysBetween(week, currentWeek) / 7 > maxWeeksBack) {
    week = addWeeks(currentWeek, -maxWeeksBack)
  }

  while (daysBetween(week, currentWeek) > 0) {
    for (const kind of ['steps', 'blocks'] as LedgerKind[]) {
      if (!findEntry(state, week, kind)) {
        const entry = closeKind(state, week, kind, now)
        if (kind === 'steps' && !options.skipRamp) applyRamp(state, entry)
        state.ledger.push(entry)
        added.push(entry)
      }
    }
    // Přenos nesplněných týdenních úkolů do dalšího týdne.
    rolloverTasks(state, week)
    state.lastClosedWeek = week
    week = addWeeks(week, 1)
  }
  return added
}

/**
 * Zvýšení laťky po splněném týdnu. Laťka roste jen tehdy, když týden vyšel –
 * zvyšovat cíl někomu, kdo ho zrovna nesplnil, je nejjistější způsob, jak ho
 * odradit. Krok +500 kroků/den odpovídá doporučenému nárůstu 10–20 % týdně.
 */
function applyRamp(state: AppState, entry: LedgerEntry): void {
  const s = state.settings.steps
  if (!s.rampEnabled || entry.skipped) return
  if (entry.achieved < entry.required) return
  if (s.weeklyTarget >= s.goalWeeklyTarget) return
  const next = Math.min(s.goalWeeklyTarget, s.weeklyTarget + s.rampStep)
  if (next === s.weeklyTarget) return
  entry.raisedTargetFrom = s.weeklyTarget
  s.weeklyTarget = next
  entry.raisedTargetTo = next
}

/**
 * Zruší uzávěrky od daného týdne dál, aby se přepočítaly.
 *
 * Volá se, když ze serveru dorazí kroky za den, který spadá do už uzavřeného
 * týdne. Bez toho by appka po týdnu nepoužívání uzavřela týdny s nulou dřív,
 * než se stihnou stáhnout data z Health, a vyrobila by dluh z ničeho.
 */
export interface ReopenResult {
  /** Byly mezi zahozenými uzávěrkami nějaké, které zvedly laťku? */
  hadRaises: boolean
  /** Podařilo se zvýšení vrátit zpět? */
  reverted: boolean
}

export function reopenWeeksFrom(state: AppState, week: WeekKey): ReopenResult {
  const removed = state.ledger.filter((e) => daysBetween(week, e.week) >= 0)
  if (removed.length === 0) return { hadRaises: false, reverted: false }

  const result = revertRaises(state, removed)

  state.ledger = state.ledger.filter((e) => daysBetween(week, e.week) < 0)
  const previous = addWeeks(week, -1)
  state.lastClosedWeek = state.ledger.some((e) => e.week === previous) ? previous : undefined
  return result
}

/**
 * Přepočítá dluhovou knihu od týdne, do kterého spadá `date`.
 *
 * Volá se, když se dodatečně změní data v už uzavřeném týdnu – ať už je
 * dotáhne synchronizace ze serveru, nebo je uživatel dopíše ručně.
 */
export function recalculateFrom(state: AppState, date: DateKey, today: DateKey = todayKey()): void {
  const week = weekKeyOf(date)
  if (!state.lastClosedWeek || daysBetween(week, state.lastClosedWeek) < 0) return
  const { hadRaises, reverted } = reopenWeeksFrom(state, week)
  closeDueWeeks(state, today, { skipRamp: hadRaises && !reverted })
}

/**
 * Vrátí zvýšení laťky, které se chystáme přepočítat.
 *
 * Dělá se to jen tehdy, když je to bezpečné:
 *  – automatické zvyšování je zapnuté (jinak by se laťka snížila a už nikdy
 *    nezvedla, protože přepočet ji zpátky nezvedne),
 *  – aktuální cíl pořád odpovídá tomu, co naposledy nastavilo zvýšení
 *    (jinak by se přepsala ruční změna od uživatele).
 */
function revertRaises(state: AppState, removed: LedgerEntry[]): ReopenResult {
  const raises = removed
    .filter((e) => e.raisedTargetTo !== undefined)
    .sort((a, b) => a.week.localeCompare(b.week))
  if (raises.length === 0) return { hadRaises: false, reverted: false }

  if (!state.settings.steps.rampEnabled) return { hadRaises: true, reverted: false }

  const last = raises[raises.length - 1] as LedgerEntry
  // Cíl mezitím někdo změnil ručně – přepsat mu ho historickou hodnotou
  // by bylo horší než nechat laťku být.
  if (state.settings.steps.weeklyTarget !== last.raisedTargetTo) {
    return { hadRaises: true, reverted: false }
  }

  const first = raises[0] as LedgerEntry
  // Starší záznamy `raisedTargetFrom` nemají – dopočítá se z kroku zvyšování.
  const from =
    first.raisedTargetFrom ??
    Math.max(0, (first.raisedTargetTo as number) - state.settings.steps.rampStep)
  state.settings.steps.weeklyTarget = from
  return { hadRaises: true, reverted: true }
}

function rolloverTasks(state: AppState, week: WeekKey): void {
  const next = addWeeks(week, 1)
  for (const task of state.weeklyTasks) {
    if (!task.active || !task.rollover) continue
    const carried = carriedTaskCount(state, next, task)
    if (carried <= 0) continue
    const key = taskLogKey(next, task.id)
    const existing = state.weeklyTaskLogs[key]
    state.weeklyTaskLogs[key] = existing
      ? { ...existing, carried }
      : { week: next, taskId: task.id, dates: [], carried }
  }
}

/* ------------------------------------------------------------------ */
/*  Skóre dne a série                                                  */
/* ------------------------------------------------------------------ */

export interface DayStatus {
  date: DateKey
  steps: number
  stepTarget: number
  stepPct: number
  blocksDone: number
  blocksTarget: number
  /** 0–100, kroky a bloky půl na půl. */
  score: number
  /** Den se počítá do série. */
  counts: boolean
  restDay: boolean
  isFuture: boolean
}

/** Práh skóre, od kterého se den počítá jako splněný. */
export const DAY_SCORE_THRESHOLD = 60

export function dayStatus(state: AppState, date: DateKey, today: DateKey = todayKey()): DayStatus {
  const day = state.days[date]
  const stepTarget = dailyStepTarget(state, date)
  const blocksTarget = state.settings.exercise.blocksPerDay
  const steps = day?.steps ?? 0
  const blocksDone = completedBlocks(day)
  const stepPct = stepTarget > 0 ? Math.min(100, (steps / stepTarget) * 100) : 100
  const blockPct = blocksTarget > 0 ? Math.min(100, (blocksDone / blocksTarget) * 100) : 100
  const score = Math.round(stepPct * 0.5 + blockPct * 0.5)
  const restDay = !!day?.restDay
  return {
    date,
    steps,
    stepTarget,
    stepPct: Math.round(stepPct),
    blocksDone,
    blocksTarget,
    score,
    counts: restDay || score >= DAY_SCORE_THRESHOLD,
    restDay,
    isFuture: daysBetween(today, date) > 0,
  }
}

/**
 * Série splněných dní – se záchranami.
 *
 * Jeden vynechaný den sérii neshodí. Za každých sedm dní se smí propadnout
 * tolikrát, kolik je nastaveno „dnů milosti“; teprve další propadnutí sérii
 * ukončí. Bez téhle pojistky by první nemoc nebo služebka shodila měsíc práce
 * na nulu – a přesně v tu chvíli lidi appky mažou.
 *
 * Dnešek je zvláštní případ: dokud neskončil, může být rozdělaný. Do série
 * se započítá, až když je splněný, ale nesplněný ji nepřeruší.
 */
export interface StreakInfo {
  /** Délka série ve dnech. */
  days: number
  /** Kolik záchran je ještě k dispozici v posledních sedmi dnech. */
  freezesLeft: number
  /** Kolik jich už série spotřebovala. */
  freezesUsed: number
  /** Je dnešek splněný? */
  todayDone: boolean
}

/** Kolik propadnutí za sedm dní série unese. */
function freezeBudget(state: AppState): number {
  return Math.max(0, Math.min(6, state.settings.exercise.graceDaysPerWeek))
}

export function streakInfo(state: AppState, today: DateKey = todayKey()): StreakInfo {
  const budget = freezeBudget(state)
  const first = state.settings.startDate
  const todayDone = dayStatus(state, today, today).counts

  let days = todayDone ? 1 : 0
  let freezesUsed = 0
  /** Propadlé dny, které série „zaplatila“ záchranou, od nejnovějšího. */
  let misses: DateKey[] = []
  /** Propadnutí v posledních sedmi dnech – z nich se počítá zbytek záchran. */
  let recentMisses = 0

  let cursor = addDays(today, -1)
  // Pojistka proti nesmyslně staré startDate po importu cizích dat.
  for (let guard = 0; guard < 3660 && daysBetween(first, cursor) >= 0; guard++) {
    if (dayStatus(state, cursor, today).counts) {
      days++
    } else {
      // V okně se drží jen propadnutí, která leží do šesti dnů po zkoumaném
      // dni – to je právě to sedmidenní okno.
      misses = misses.filter((m) => daysBetween(cursor, m) <= 6)
      if (misses.length >= budget) break
      misses.push(cursor)
      freezesUsed++
      // Počítá se zvlášť: pole `misses` se průběžně prořezává, takže by
      // z něj čerstvá propadnutí zmizela.
      if (daysBetween(cursor, today) <= 6) recentMisses++
    }
    cursor = addDays(cursor, -1)
  }

  return {
    days,
    freezesUsed,
    freezesLeft: Math.max(0, budget - recentMisses),
    todayDone,
  }
}

/** Zkratka pro místa, kde stačí samotné číslo. */
export function currentStreak(state: AppState, today: DateKey = todayKey()): number {
  return streakInfo(state, today).days
}

/**
 * Nejdelší série v historii, počítaná stejnými pravidly včetně záchran.
 *
 * Prochází se dopředu od začátku sledování. Rozsah je omezený na deset let
 * dozadu OD DNEŠKA (ne od `startDate`) – po importu cizích dat může být
 * začátek klidně v roce 1990 a ořez od začátku by k dnešku nikdy nedošel.
 */
export function longestStreak(state: AppState, today: DateKey = todayKey()): number {
  const budget = freezeBudget(state)
  const MAX_DAYS = 3660
  const earliest = addDays(today, -MAX_DAYS)
  const first = daysBetween(state.settings.startDate, earliest) > 0 ? earliest : state.settings.startDate
  const total = daysBetween(first, today)
  if (total < 0) return 0

  let best = 0
  let run = 0
  let misses: DateKey[] = []

  for (let i = 0; i <= total; i++) {
    const date = addDays(first, i)
    if (dayStatus(state, date, today).counts) {
      run++
      best = Math.max(best, run)
      continue
    }
    misses = misses.filter((m) => daysBetween(m, date) <= 6)
    if (misses.length >= budget) {
      run = 0
      misses = []
    } else {
      misses.push(date)
    }
  }

  // Obě funkce chodí po týdenním okně z opačných stran, takže se na hraně
  // můžou o jeden den rozejít. Nejdelší série nesmí být kratší než ta právě
  // běžící – to by vypadalo jako chyba i kdyby to chyba nebyla.
  return Math.max(best, streakInfo(state, today).days)
}

/* ------------------------------------------------------------------ */
/*  Míry                                                               */
/* ------------------------------------------------------------------ */

/** Vývoj jedné veličiny v čase, seřazeno vzestupně. */
export function measurementSeries(
  state: AppState,
  field: 'weightKg' | 'waistCm' | 'toeTouchCm' | 'plankSec',
): { date: DateKey; value: number }[] {
  return state.measurements
    .filter((m) => typeof m[field] === 'number')
    .map((m) => ({ date: m.date, value: m[field] as number }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
