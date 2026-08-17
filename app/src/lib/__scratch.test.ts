import { describe, expect, it } from 'vitest'
import { closeDueWeeks, summarizeWeek, streakInfo, dayStatus } from './engine'
import { defaultState } from './storage'
import { addDays, weekKeyOf, toKey, weekdayIndex } from './date'
import type { AppState } from './types'

const NAMES = ['Po','Ut','St','Ct','Pa','So','Ne']

function seedState(today: string, opts: any): AppState {
  const s = defaultState()
  s.settings.startDate = opts.startDate ?? today
  s.settings.steps.weeklyTarget = opts.weeklyTarget ?? 35000
  s.settings.steps.distribution = [13,13,13,13,14,17,17]
  s.settings.steps.rampEnabled = false
  s.settings.onboardedAt = new Date().toISOString()
  for (const [d, v] of Object.entries(opts.days ?? {})) {
    const vv: any = v
    s.days[d] = { date: d, steps: vv.steps ?? 0, stepsSource: 'manual', blocks: (vv.blocks ?? []).map((slot: number) => ({ slot, planId: 'seed', completedAt: `${d}T12:00:00.000Z`, doneExerciseIds: [], skippedExerciseIds: [] })) } as any
  }
  return s
}

// pondeli 2026-08-03 .. nedele 2026-08-09
const BASE = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-08','2026-08-09']

describe('weekday sweep', () => {
  it('steps.spec: dluh 45000', () => {
    for (const today of BASE) {
      const back = (n: number) => addDays(today, -n)
      const s = seedState(today, { startDate: back(21), days: { [back(9)]: { steps: 5000 } } })
      closeDueWeeks(s, today)
      const sum = summarizeWeek(s, weekKeyOf(today), today, 12*60)
      console.log(NAMES[weekdayIndex(today)], 'required=', sum.steps.required, 'debtIn=', sum.steps.debtIn)
    }
  })

  it('shell.spec: needed > 9000 pri cili 70000', () => {
    for (const today of BASE) {
      const s = seedState(today, { weeklyTarget: 70000 })
      closeDueWeeks(s, today)
      const sum = summarizeWeek(s, weekKeyOf(today), today, 12*60)
      console.log(NAMES[weekdayIndex(today)], 'todayShare=', sum.steps.todayShare, 'todayRemaining=', sum.steps.todayRemaining)
    }
  })

  it('progress.spec: streak 3', () => {
    for (const today of BASE) {
      const back = (n: number) => addDays(today, -n)
      const s = seedState(today, { startDate: back(10), days: {
        [back(3)]: { steps: 9000, blocks: [0,1,2] },
        [back(2)]: { steps: 300 },
        [back(1)]: { steps: 9000, blocks: [0,1,2] },
        [back(0)]: { steps: 9000, blocks: [0,1,2] },
      }})
      closeDueWeeks(s, today)
      const info = streakInfo(s, today)
      console.log(NAMES[weekdayIndex(today)], 'streak=', info.days, 'freezesLeft=', info.freezesLeft, 'used=', info.freezesUsed)
    }
  })

  it('steps.spec: bar.met count (9000 dnes)', () => {
    for (const today of BASE) {
      const s = seedState(today, { days: { [today]: { steps: 9000 } } })
      const week = weekKeyOf(today)
      let met = 0
      for (let i=0;i<7;i++) { const d = addDays(week, i); const st = dayStatus(s, d, today); if (st.steps>0 && st.steps >= st.stepTarget) met++ }
      console.log(NAMES[weekdayIndex(today)], 'met=', met)
    }
  })
})
