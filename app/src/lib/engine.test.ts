import { describe, expect, it } from 'vitest'
import {
  carryInto,
  closeDueWeeks,
  reopenWeeksFrom,
  weekHasData,
  currentStreak,
  dailyStepTarget,
  dayStatus,
  requiredFor,
  summarizeWeek,
  weeklyBlockTarget,
} from './engine'
import { defaultState } from './storage'
import { addDays, weekKeyOf } from './date'
import type { AppState, BlockSlot } from './types'

/* ------------------------------------------------------------------ */
/*  Pomocníci                                                          */
/* ------------------------------------------------------------------ */

/** Pondělí 4. 8. 2025 – pevný bod, ať testy nezávisí na dnešku. */
const MON = '2025-08-04'
const NEXT_MON = '2025-08-11'

function makeState(patch: (s: AppState) => void = () => {}): AppState {
  const s = defaultState()
  s.settings.startDate = MON
  s.settings.steps.weeklyTarget = 35_000 // 5 000 denně
  s.settings.steps.distribution = [100 / 7, 100 / 7, 100 / 7, 100 / 7, 100 / 7, 100 / 7, 100 / 7]
  s.settings.steps.rampEnabled = false
  patch(s)
  return s
}

function setSteps(s: AppState, date: string, steps: number): void {
  s.days[date] = { date, steps, stepsSource: 'manual', blocks: [] }
}

function doBlocks(s: AppState, date: string, count: number): void {
  const day = s.days[date] ?? { date, steps: 0, stepsSource: 'manual' as const, blocks: [] }
  day.blocks = Array.from({ length: count }, (_, i) => ({
    slot: i as BlockSlot,
    planId: 'test',
    completedAt: `${date}T12:00:00.000Z`,
    doneExerciseIds: [],
    skippedExerciseIds: [],
  }))
  s.days[date] = day
}

/* ------------------------------------------------------------------ */
/*  Cíle                                                               */
/* ------------------------------------------------------------------ */

describe('cíle kroků', () => {
  it('rozpočítá týdenní cíl na dny podle rozložení', () => {
    const s = makeState()
    expect(dailyStepTarget(s, MON)).toBe(5000)
  })

  it('respektuje nerovnoměrné rozložení', () => {
    const s = makeState((x) => {
      x.settings.steps.distribution = [10, 10, 10, 10, 10, 25, 25]
    })
    expect(dailyStepTarget(s, MON)).toBe(3500) // pondělí = 10 %
    expect(dailyStepTarget(s, '2025-08-09')).toBe(8750) // sobota = 25 %
  })

  it('dny milosti snižují požadovaný počet bloků', () => {
    const s = makeState()
    expect(weeklyBlockTarget(s)).toBe(18) // 3 bloky × 6 dní (1 den milosti)
    s.settings.exercise.graceDaysPerWeek = 0
    expect(weeklyBlockTarget(s)).toBe(21)
  })
})

/* ------------------------------------------------------------------ */
/*  Přenos dluhu                                                       */
/* ------------------------------------------------------------------ */

describe('uzavření týdne a přenos dluhu', () => {
  it('nesplněný týden vytvoří dluh a ten se přičte k dalšímu cíli', () => {
    const s = makeState()
    setSteps(s, MON, 20_000) // za celý týden jen 20 000 z 35 000

    closeDueWeeks(s, NEXT_MON)

    const entry = s.ledger.find((e) => e.week === MON && e.kind === 'steps')
    expect(entry).toBeDefined()
    expect(entry!.achieved).toBe(20_000)
    expect(entry!.required).toBe(35_000)
    // Chybí 15 000, ale strop je 2 dny × 5 000 = 10 000.
    expect(entry!.rawDebt).toBe(15_000)
    expect(entry!.debt).toBe(10_000)
    expect(entry!.forgiven).toBe(5_000)

    expect(requiredFor(s, NEXT_MON, 'steps')).toBe(45_000)
  })

  it('dluh se nikdy nekumuluje nad strop, ani po měsíci nicnedělání', () => {
    const s = makeState()
    // Čtyři týdny, v každém jen symbolický pohyb (aby týden nebyl „bez dat“).
    for (let w = 0; w < 4; w++) setSteps(s, addDays(MON, w * 7), 100)

    closeDueWeeks(s, addDays(MON, 28))

    const debt = carryInto(s, addDays(MON, 28), 'steps').debt
    expect(debt).toBe(10_000)
    expect(requiredFor(s, addDays(MON, 28), 'steps')).toBe(45_000)
  })

  it('přebytek se přenáší jako kredit a snižuje další cíl', () => {
    const s = makeState()
    setSteps(s, MON, 45_000)

    closeDueWeeks(s, NEXT_MON)

    const entry = s.ledger.find((e) => e.week === MON && e.kind === 'steps')!
    // Přebytek 10 000, ale strop kreditu je 1 den = 5 000.
    expect(entry.credit).toBe(5_000)
    expect(entry.debt).toBe(0)
    expect(requiredFor(s, NEXT_MON, 'steps')).toBe(30_000)
  })

  it('týden bez jediného záznamu se neúčtuje jako selhání', () => {
    const s = makeState()
    closeDueWeeks(s, NEXT_MON)

    const entry = s.ledger.find((e) => e.week === MON && e.kind === 'steps')!
    expect(entry.skipped).toBe(true)
    expect(entry.debt).toBe(0)
    expect(requiredFor(s, NEXT_MON, 'steps')).toBe(35_000)
  })

  it('bankrot dluh vynuluje', () => {
    const s = makeState()
    setSteps(s, MON, 5_000)
    closeDueWeeks(s, NEXT_MON)
    expect(carryInto(s, NEXT_MON, 'steps').debt).toBe(10_000)

    s.bankruptcies.push({ date: NEXT_MON, kind: 'all', clearedDebt: 10_000 })
    expect(carryInto(s, NEXT_MON, 'steps').debt).toBe(0)
    expect(requiredFor(s, NEXT_MON, 'steps')).toBe(35_000)
  })

  it('uzavírání je idempotentní – druhé volání nic nepřidá', () => {
    const s = makeState()
    setSteps(s, MON, 10_000)
    closeDueWeeks(s, NEXT_MON)
    const count = s.ledger.length
    closeDueWeeks(s, NEXT_MON)
    expect(s.ledger.length).toBe(count)
  })

  it('doúčtuje i několik týdnů zpětně najednou', () => {
    const s = makeState()
    setSteps(s, MON, 1_000)
    setSteps(s, addDays(MON, 7), 1_000)
    setSteps(s, addDays(MON, 14), 1_000)

    closeDueWeeks(s, addDays(MON, 21))

    const stepWeeks = s.ledger.filter((e) => e.kind === 'steps').map((e) => e.week)
    expect(stepWeeks).toEqual([MON, addDays(MON, 7), addDays(MON, 14)])
    expect(s.lastClosedWeek).toBe(addDays(MON, 14))
  })
})

/* ------------------------------------------------------------------ */
/*  Zvyšování laťky                                                    */
/* ------------------------------------------------------------------ */

describe('postupné zvyšování cíle', () => {
  it('po splněném týdnu se cíl zvedne o krok', () => {
    const s = makeState((x) => {
      x.settings.steps.rampEnabled = true
      x.settings.steps.rampStep = 3_500
      x.settings.steps.goalWeeklyTarget = 49_000
    })
    setSteps(s, MON, 40_000)

    closeDueWeeks(s, NEXT_MON)

    expect(s.settings.steps.weeklyTarget).toBe(38_500)
    expect(s.ledger.find((e) => e.week === MON && e.kind === 'steps')!.raisedTargetTo).toBe(38_500)
  })

  it('po nesplněném týdnu se laťka nezvedá', () => {
    const s = makeState((x) => {
      x.settings.steps.rampEnabled = true
    })
    setSteps(s, MON, 10_000)
    closeDueWeeks(s, NEXT_MON)
    expect(s.settings.steps.weeklyTarget).toBe(35_000)
  })

  it('nepřeleze cílovou metu', () => {
    const s = makeState((x) => {
      x.settings.steps.rampEnabled = true
      x.settings.steps.weeklyTarget = 48_000
      x.settings.steps.goalWeeklyTarget = 49_000
    })
    setSteps(s, MON, 60_000)
    closeDueWeeks(s, NEXT_MON)
    expect(s.settings.steps.weeklyTarget).toBe(49_000)
  })
})

/* ------------------------------------------------------------------ */
/*  Přehled týdne                                                      */
/* ------------------------------------------------------------------ */

describe('přehled běžícího týdne', () => {
  it('rozpočítá zbytek na zbývající dny včetně dneška', () => {
    const s = makeState()
    setSteps(s, MON, 1_000)
    // Úterý, tedy zbývá 6 dní včetně dneška.
    const summary = summarizeWeek(s, MON, '2025-08-05')

    expect(summary.daysRemaining).toBe(6)
    expect(summary.steps.remaining).toBe(34_000)
    expect(summary.steps.perRemainingDay).toBe(Math.ceil(34_000 / 6))
  })

  it('dluh z minula zvedne denní porci', () => {
    const s = makeState()
    setSteps(s, MON, 5_000)
    closeDueWeeks(s, NEXT_MON)

    const summary = summarizeWeek(s, NEXT_MON, NEXT_MON)
    expect(summary.steps.debtIn).toBe(10_000)
    expect(summary.steps.required).toBe(45_000)
    // Pondělí – zbývá 7 dní.
    expect(summary.steps.perRemainingDay).toBe(Math.ceil(45_000 / 7))
  })

  it('u minulého týdne nezbývají žádné dny', () => {
    const s = makeState()
    const summary = summarizeWeek(s, MON, NEXT_MON)
    expect(summary.daysRemaining).toBe(0)
    expect(summary.isCurrent).toBe(false)
  })

  it('splněný týden hlásí tempo „hotovo“', () => {
    const s = makeState()
    setSteps(s, MON, 40_000)
    const summary = summarizeWeek(s, MON, '2025-08-06')
    expect(summary.steps.pace).toBe('done')
    expect(summary.steps.remaining).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/*  Skóre dne a série                                                  */
/* ------------------------------------------------------------------ */

describe('skóre dne', () => {
  it('kroky a bloky mají stejnou váhu', () => {
    const s = makeState()
    setSteps(s, MON, 5_000) // 100 % kroků
    const status = dayStatus(s, MON, MON)
    expect(status.score).toBe(50)
    expect(status.counts).toBe(false)

    doBlocks(s, MON, 3)
    expect(dayStatus(s, MON, MON).score).toBe(100)
    expect(dayStatus(s, MON, MON).counts).toBe(true)
  })

  it('den volna se počítá i bez výkonu', () => {
    const s = makeState()
    s.days[MON] = { date: MON, steps: 0, stepsSource: 'manual', blocks: [], restDay: true }
    expect(dayStatus(s, MON, MON).counts).toBe(true)
  })
})

describe('série', () => {
  it('počítá po sobě jdoucí splněné dny', () => {
    const s = makeState()
    for (const date of [MON, '2025-08-05', '2025-08-06']) {
      setSteps(s, date, 5_000)
      doBlocks(s, date, 3)
    }
    expect(currentStreak(s, '2025-08-06')).toBe(3)
  })

  it('rozdělaný dnešek sérii nepřeruší', () => {
    const s = makeState()
    setSteps(s, MON, 5_000)
    doBlocks(s, MON, 3)
    setSteps(s, '2025-08-05', 5_000)
    doBlocks(s, '2025-08-05', 3)
    // Dnešek (středa) je zatím prázdný.
    expect(currentStreak(s, '2025-08-06')).toBe(2)
  })

  it('zkažený den sérii ukončí', () => {
    const s = makeState()
    setSteps(s, MON, 5_000)
    doBlocks(s, MON, 3)
    setSteps(s, '2025-08-05', 100) // nesplněno
    setSteps(s, '2025-08-06', 5_000)
    doBlocks(s, '2025-08-06', 3)
    expect(currentStreak(s, '2025-08-06')).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/*  Týdenní úkoly                                                      */
/* ------------------------------------------------------------------ */

describe('týdenní úkoly', () => {
  it('nesplněný úkol se přenese, ale jen o jeden kus', () => {
    const s = makeState()
    setSteps(s, MON, 1) // ať týden není „bez dat“
    closeDueWeeks(s, NEXT_MON)

    const gym = summarizeWeek(s, NEXT_MON, NEXT_MON).tasks.find((t) => t.task.id === 'gym')!
    expect(gym.carried).toBe(1)
    expect(gym.target).toBe(2)
  })

  it('splněný úkol se nepřenáší', () => {
    const s = makeState()
    setSteps(s, MON, 1)
    s.weeklyTaskLogs[`${MON}|gym`] = { week: MON, taskId: 'gym', dates: [MON], carried: 0 }
    closeDueWeeks(s, NEXT_MON)

    const gym = summarizeWeek(s, NEXT_MON, NEXT_MON).tasks.find((t) => t.task.id === 'gym')!
    expect(gym.carried).toBe(0)
    expect(gym.target).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/*  Bloky                                                              */
/* ------------------------------------------------------------------ */

describe('dluh v blocích', () => {
  it('nesplněné bloky se přenášejí do stropu', () => {
    const s = makeState()
    setSteps(s, MON, 1)
    doBlocks(s, MON, 2) // 2 z 18

    closeDueWeeks(s, NEXT_MON)

    const entry = s.ledger.find((e) => e.week === MON && e.kind === 'blocks')!
    expect(entry.rawDebt).toBe(16)
    expect(entry.debt).toBe(6) // strop
    expect(requiredFor(s, NEXT_MON, 'blocks')).toBe(24)
  })

  it('přebytek bloků se nepřenáší – protahování se nedá předplatit', () => {
    const s = makeState()
    for (let i = 0; i < 7; i++) doBlocks(s, addDays(MON, i), 3) // 21 z 18
    closeDueWeeks(s, NEXT_MON)

    const entry = s.ledger.find((e) => e.week === MON && e.kind === 'blocks')!
    expect(entry.credit).toBe(0)
    expect(requiredFor(s, NEXT_MON, 'blocks')).toBe(18)
  })
})

/* ------------------------------------------------------------------ */
/*  Odolnost                                                           */
/* ------------------------------------------------------------------ */

describe('odolnost proti nesmyslům', () => {
  it('nezacyklí se, když je startDate roky v minulosti', () => {
    const s = makeState((x) => {
      x.settings.startDate = '1990-01-01'
    })
    const start = Date.now()
    closeDueWeeks(s, weekKeyOf('2025-08-11'))
    expect(Date.now() - start).toBeLessThan(4000)
    expect(s.ledger.length).toBeLessThanOrEqual(260 * 2 + 4)
  })

  it('nulový týdenní cíl nerozbije procenta', () => {
    const s = makeState((x) => {
      x.settings.steps.weeklyTarget = 0
    })
    const summary = summarizeWeek(s, MON, MON)
    expect(summary.steps.progressPct).toBe(100)
    expect(Number.isFinite(summary.steps.perRemainingDay)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/*  Regrese z revize                                                   */
/* ------------------------------------------------------------------ */

describe('regrese', () => {
  it('rozdělaný blok nedělá z týdne „týden s daty“', () => {
    const s = makeState()
    // Přesně to, co vznikne otevřením obrazovky bloku a jejím zavřením.
    s.days[MON] = {
      date: MON,
      steps: 0,
      stepsSource: 'manual',
      blocks: [{ slot: 0, planId: 'p', doneExerciseIds: [], skippedExerciseIds: [] }],
    }
    expect(weekHasData(s, MON)).toBe(false)

    closeDueWeeks(s, NEXT_MON)
    expect(s.ledger.find((e) => e.week === MON && e.kind === 'steps')!.skipped).toBe(true)
    expect(requiredFor(s, NEXT_MON, 'steps')).toBe(35_000)
  })

  it('dokončený blok už týden za „použitý“ považuje', () => {
    const s = makeState()
    doBlocks(s, MON, 1)
    expect(weekHasData(s, MON)).toBe(true)
  })

  it('nečíselné rozložení nerozbije denní cíl', () => {
    const s = makeState((x) => {
      // Prázdné pole ve formuláři vrací přes `v-model.number` prázdný řetězec.
      x.settings.steps.distribution = ['' as unknown as number, 13, 13, 13, 14, 17, 17]
    })
    const target = dailyStepTarget(s, MON)
    expect(Number.isFinite(target)).toBe(true)
    expect(target).toBe(0) // pondělí má podíl 0
    expect(dailyStepTarget(s, '2025-08-09')).toBeGreaterThan(0)
  })

  it('samé nuly v rozložení spadnou zpátky na rovnoměrné dělení', () => {
    const s = makeState((x) => {
      x.settings.steps.distribution = [0, 0, 0, 0, 0, 0, 0]
    })
    expect(dailyStepTarget(s, MON)).toBe(5_000)
  })

  it('týden bez dat protáhne dál i kredit, nejen dluh', () => {
    const s = makeState()
    setSteps(s, MON, 45_000) // přebytek → kredit 5 000
    closeDueWeeks(s, NEXT_MON)
    expect(carryInto(s, NEXT_MON, 'steps').credit).toBe(5_000)

    // Další týden se appka vůbec nepoužila.
    closeDueWeeks(s, addDays(MON, 14))
    expect(carryInto(s, addDays(MON, 14), 'steps').credit).toBe(5_000)
    expect(requiredFor(s, addDays(MON, 14), 'steps')).toBe(30_000)
  })

  it('reopenWeeksFrom zahodí uzávěrky od daného týdne dál', () => {
    const s = makeState()
    setSteps(s, MON, 1_000)
    setSteps(s, addDays(MON, 7), 1_000)
    closeDueWeeks(s, addDays(MON, 14))
    expect(s.ledger.length).toBe(4)

    reopenWeeksFrom(s, addDays(MON, 7))
    expect(s.ledger.every((e) => e.week === MON)).toBe(true)
    expect(s.lastClosedWeek).toBe(MON)
  })

  it('dopočtené kroky z minulého týdne dluh zase smažou', () => {
    const s = makeState()
    // Appka se týden neotevřela, uzávěrka proběhla skoro s nulou.
    setSteps(s, MON, 100)
    closeDueWeeks(s, NEXT_MON)
    expect(carryInto(s, NEXT_MON, 'steps').debt).toBe(10_000)

    // Teprve teď dorazí kroky ze serveru.
    for (let i = 0; i < 7; i++) setSteps(s, addDays(MON, i), 5_500)
    reopenWeeksFrom(s, MON)
    closeDueWeeks(s, NEXT_MON)

    expect(carryInto(s, NEXT_MON, 'steps').debt).toBe(0)
  })

  it('opětovné uzavření nezvedne laťku dvakrát', () => {
    const s = makeState((x) => {
      x.settings.steps.rampEnabled = true
      x.settings.steps.rampStep = 3_500
      x.settings.steps.goalWeeklyTarget = 49_000
    })
    for (let i = 0; i < 14; i++) setSteps(s, addDays(MON, i), 6_000)

    closeDueWeeks(s, addDays(MON, 14))
    const afterFirst = s.settings.steps.weeklyTarget
    expect(afterFirst).toBe(42_000) // dva splněné týdny, dvakrát +3 500

    // Simulace opravy kroků ze serveru: týdny se otevřou a zavřou znovu.
    reopenWeeksFrom(s, MON)
    expect(s.settings.steps.weeklyTarget).toBe(35_000) // zvýšení vzato zpět
    closeDueWeeks(s, addDays(MON, 14))
    expect(s.settings.steps.weeklyTarget).toBe(afterFirst)
  })

  it('reopenWeeksFrom u týdne, který v knize není, nic nerozbije', () => {
    const s = makeState()
    setSteps(s, MON, 1_000)
    closeDueWeeks(s, NEXT_MON)
    const before = s.lastClosedWeek
    reopenWeeksFrom(s, addDays(MON, 70))
    expect(s.lastClosedWeek).toBe(before)
    expect(s.ledger.length).toBe(2)
  })
})
