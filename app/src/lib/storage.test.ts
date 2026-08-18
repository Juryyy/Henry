import { describe, expect, it } from 'vitest'
import { defaultState, exportState, importState } from './storage'

describe('načtení uloženého stavu', () => {
  it('doplní nově přidaná nastavení, aniž by přepsalo ta stará', () => {
    // Stav uložený starší verzí appky – chybí mu klíče, které přibyly později.
    const old = JSON.stringify({
      schemaVersion: 1,
      settings: {
        name: 'Martin',
        steps: { weeklyTarget: 42_000 },
        exercise: { level: 3 },
      },
      days: { '2025-08-04': { date: '2025-08-04', steps: 8000, stepsSource: 'manual', blocks: [] } },
    })

    const state = importState(old)
    expect(state.settings.name).toBe('Martin')
    expect(state.settings.steps.weeklyTarget).toBe(42_000)
    expect(state.settings.exercise.level).toBe(3)
    // Doplněné z výchozích hodnot.
    expect(state.settings.steps.goalWeeklyTarget).toBe(49_000)
    expect(state.settings.exercise.blocksPerDay).toBe(3)
    expect(state.weeklyTasks.length).toBeGreaterThan(0)
  })

  it('uživatele s daty neposílá znovu do úvodního průvodce', () => {
    const old = JSON.stringify({
      schemaVersion: 1,
      settings: { name: 'Martin' },
      days: { '2025-08-04': { date: '2025-08-04', steps: 8000, stepsSource: 'manual', blocks: [] } },
    })
    expect(importState(old).settings.onboardedAt).toBeTruthy()
  })

  it('prázdný stav průvodce nepřeskočí', () => {
    const fresh = JSON.stringify({ schemaVersion: 1, settings: { name: '' }, days: {} })
    expect(importState(fresh).settings.onboardedAt).toBeUndefined()
  })

  it('export a import se vrátí ke stejným datům', () => {
    const state = defaultState()
    state.settings.onboardedAt = '2026-01-01T00:00:00.000Z'
    state.days['2026-01-01'] = {
      date: '2026-01-01',
      steps: 7321,
      stepsSource: 'manual',
      blocks: [],
    }
    state.measurements.push({ date: '2026-01-01', weightKg: 92.4, toeTouchCm: 15 })

    const roundtrip = importState(exportState(state))
    expect(roundtrip.days['2026-01-01'].steps).toBe(7321)
    expect(roundtrip.measurements[0].weightKg).toBe(92.4)
    expect(roundtrip.settings.onboardedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('nesmyslný JSON vyhodí chybu, místo aby tiše smazal data', () => {
    expect(() => importState('{tohle není json')).toThrow()
  })
})
