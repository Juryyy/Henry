import { describe, expect, it } from 'vitest'
import {
  applyRecords,
  collectAll,
  collectChanged,
  key,
  touch,
  touchEverything,
  touchSettings,
  tombstone,
  type SyncRecord,
} from './sync-records'
import { defaultState } from './storage'
import type { AppState } from './types'

/**
 * Slučování dat ze dvou zařízení.
 *
 * Modelová situace, kvůli které to celé vzniklo: ráno si na telefonu odškrtnu
 * blok, odpoledne na notebooku zapíšu kroky. Obojí musí přežít.
 */
function makeState(patch: (s: AppState) => void = () => {}): AppState {
  const s = defaultState()
  s.settings.startDate = '2026-08-17'
  patch(s)
  return s
}

const RANO = '2026-08-17T08:00:00.000Z'
const POLEDNE = '2026-08-17T12:00:00.000Z'
const VECER = '2026-08-17T20:00:00.000Z'

function setDay(s: AppState, date: string, steps: number, at: string): void {
  s.days[date] = { date, steps, stepsSource: 'manual', blocks: [] }
  touch(s, 'day', date, at)
}

function find(records: SyncRecord[], kind: string, id: string): SyncRecord | undefined {
  return records.find((r) => r.kind === kind && r.id === id)
}

/* ------------------------------------------------------------------ */
/*  Co se přenáší                                                      */
/* ------------------------------------------------------------------ */

describe('výběr záznamů', () => {
  it('pokryje všechny druhy dat', () => {
    const s = makeState((state) => {
      state.days['2026-08-17'] = { date: '2026-08-17', steps: 5_000, stepsSource: 'manual', blocks: [] }
      state.measurements.push({ date: '2026-08-17', weightKg: 92.4 })
      state.weeklyTaskLogs['2026-08-17|gym'] = { week: '2026-08-17', taskId: 'gym', dates: [], carried: 0 }
      state.bankruptcies.push({ date: '2026-08-17', kind: 'all', clearedDebt: 1_000 })
      state.achievements['first-block'] = '2026-08-17'
    })

    const kinds = new Set(collectAll(s).map((r) => r.kind))
    expect(kinds).toEqual(new Set(['day', 'measurement', 'task', 'task_log', 'bankruptcy', 'achievement', 'settings']))
  })

  it('adresa serveru a token se nikam neposílají', () => {
    const s = makeState((state) => {
      state.settings.server = { baseUrl: 'https://doma.ts.net', token: 'tajne' }
    })
    expect(JSON.stringify(collectAll(s))).not.toContain('tajne')
    expect(JSON.stringify(collectAll(s))).not.toContain('doma.ts.net')
  })

  it('dluhová kniha se nepřenáší – je odvozená', () => {
    const s = makeState((state) => {
      state.ledger.push({
        week: '2026-08-17', kind: 'steps', base: 35_000, debtIn: 0, creditIn: 0, required: 35_000,
        achieved: 30_000, debt: 5_000, rawDebt: 5_000, credit: 0, forgiven: 0, closedAt: VECER,
      })
    })
    expect(collectAll(s).some((r) => r.kind === 'ledger')).toBe(false)
  })

  it('nastavení jde po částech, ne jako jeden balík', () => {
    const ids = collectAll(makeState())
      .filter((r) => r.kind === 'settings')
      .map((r) => r.id)
      .sort()
    expect(ids).toEqual(['exercise', 'notifications', 'profile', 'steps'])
  })

  it('posílá se jen to, co se od minula změnilo', () => {
    const s = makeState()
    setDay(s, '2026-08-17', 5_000, RANO)
    setDay(s, '2026-08-18', 6_000, VECER)

    const changed = collectChanged(s, POLEDNE)
    expect(changed.map((r) => r.id)).toContain('2026-08-18')
    expect(changed.map((r) => r.id)).not.toContain('2026-08-17')
  })

  it('poprvé se posílá všechno', () => {
    const s = makeState()
    setDay(s, '2026-08-17', 5_000, RANO)
    expect(collectChanged(s, undefined).length).toBe(collectAll(s).length)
  })
})

/* ------------------------------------------------------------------ */
/*  Slučování                                                          */
/* ------------------------------------------------------------------ */

describe('slučování', () => {
  it('novější záznam ze serveru vyhraje', () => {
    const s = makeState()
    setDay(s, '2026-08-17', 3_000, RANO)

    applyRecords(s, [
      { kind: 'day', id: '2026-08-17', updatedAt: VECER, payload: { date: '2026-08-17', steps: 9_000, stepsSource: 'manual', blocks: [] } },
    ])
    expect(s.days['2026-08-17']!.steps).toBe(9_000)
  })

  it('starší záznam ze serveru lokální změnu nepřepíše', () => {
    const s = makeState()
    setDay(s, '2026-08-17', 9_000, VECER)

    const result = applyRecords(s, [
      { kind: 'day', id: '2026-08-17', updatedAt: RANO, payload: { date: '2026-08-17', steps: 3_000, stepsSource: 'manual', blocks: [] } },
    ])
    expect(result.applied).toBe(0)
    expect(s.days['2026-08-17']!.steps).toBe(9_000)
  })

  it('dvě zařízení, dvě různé změny téhož dne i dne vedle – obojí přežije', () => {
    // Telefon: ráno odškrtnutý blok. Notebook: odpoledne zapsané kroky jinam.
    const telefon = makeState()
    telefon.days['2026-08-17'] = {
      date: '2026-08-17', steps: 0, stepsSource: 'manual',
      blocks: [{ slot: 0, planId: 'p', completedAt: RANO, doneExerciseIds: [], skippedExerciseIds: [] }],
    }
    touch(telefon, 'day', '2026-08-17', RANO)

    const notebook = makeState()
    setDay(notebook, '2026-08-18', 7_000, POLEDNE)

    // Notebook nahraje svoje, telefon si to stáhne.
    applyRecords(telefon, collectAll(notebook).filter((r) => r.kind === 'day'))

    expect(telefon.days['2026-08-17']!.blocks).toHaveLength(1)
    expect(telefon.days['2026-08-18']!.steps).toBe(7_000)
  })

  it('řekne, od kterého dne se má přepočítat kniha', () => {
    const s = makeState()
    const result = applyRecords(s, [
      { kind: 'day', id: '2026-08-20', updatedAt: VECER, payload: { date: '2026-08-20', steps: 1, stepsSource: 'manual', blocks: [] } },
      { kind: 'day', id: '2026-08-12', updatedAt: VECER, payload: { date: '2026-08-12', steps: 2, stepsSource: 'manual', blocks: [] } },
    ])
    expect(result.oldestChangedDay).toBe('2026-08-12')
  })

  it('nastavení se slučuje po částech', () => {
    const s = makeState()
    touchSettings(s, 'steps', VECER)
    touchSettings(s, 'exercise', RANO)

    applyRecords(s, [
      { kind: 'settings', id: 'steps', updatedAt: POLEDNE, payload: { weeklyTarget: 99_000 } },
      { kind: 'settings', id: 'exercise', updatedAt: POLEDNE, payload: { minutesPerBlock: 20 } },
    ])

    // Kroky mám novější lokálně, cvičení starší – projít má jen cvičení.
    expect(s.settings.steps.weeklyTarget).not.toBe(99_000)
    expect(s.settings.exercise.minutesPerBlock).toBe(20)
  })

  it('nastavení se doplňuje, ne nahrazuje celé', () => {
    const s = makeState()
    s.settings.steps.rampEnabled = false
    touchSettings(s, 'steps', RANO)

    applyRecords(s, [{ kind: 'settings', id: 'steps', updatedAt: VECER, payload: { weeklyTarget: 42_000 } }])

    expect(s.settings.steps.weeklyTarget).toBe(42_000)
    // Klíč, který v záznamu nebyl, musí zůstat.
    expect(s.settings.steps.debtCapDays).toBe(defaultState().settings.steps.debtCapDays)
  })

  it('nesmyslný záznam nic nerozbije', () => {
    const s = makeState()
    const result = applyRecords(s, [
      { kind: '', id: 'x', updatedAt: VECER },
      { kind: 'day', id: '', updatedAt: VECER },
      { kind: 'day', id: 'a', updatedAt: '' },
      { kind: 'neznamy', id: 'a', updatedAt: VECER, payload: {} },
      { kind: 'day', id: 'a', updatedAt: VECER, payload: 'tohle není objekt' },
    ] as SyncRecord[])
    expect(result.applied).toBe(0)
    expect(Object.keys(s.days)).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/*  Mazání                                                             */
/* ------------------------------------------------------------------ */

describe('mazání', () => {
  it('smazané měření zmizí i na druhém zařízení', () => {
    const s = makeState((state) => {
      state.measurements.push({ date: '2026-08-01', weightKg: 95 })
    })
    touch(s, 'measurement', '2026-08-01', RANO)

    applyRecords(s, [{ kind: 'measurement', id: '2026-08-01', updatedAt: VECER, deleted: true }])
    expect(s.measurements).toHaveLength(0)
  })

  it('zastaralé zařízení smazané měření nevzkřísí', () => {
    const s = makeState()
    tombstone(s, 'measurement', '2026-08-01', VECER)

    applyRecords(s, [
      { kind: 'measurement', id: '2026-08-01', updatedAt: RANO, payload: { date: '2026-08-01', weightKg: 95 } },
    ])
    expect(s.measurements).toHaveLength(0)
  })

  it('náhrobek se posílá dál, ne jako chybějící záznam', () => {
    const s = makeState()
    tombstone(s, 'task', 'bazen', VECER)
    const record = find(collectAll(s), 'task', 'bazen')
    expect(record?.deleted).toBe(true)
  })

  it('nové zapsání po smazání náhrobek zruší', () => {
    const s = makeState()
    tombstone(s, 'measurement', '2026-08-01', RANO)
    touch(s, 'measurement', '2026-08-01', VECER)
    expect(s.meta.deleted[key('measurement', '2026-08-01')]).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/*  Odznaky                                                            */
/* ------------------------------------------------------------------ */

describe('milníky', () => {
  it('platí to dřívější odemčení', () => {
    const s = makeState((state) => {
      state.achievements['first-block'] = '2026-08-17'
    })
    touch(s, 'achievement', 'first-block', VECER)

    applyRecords(s, [{ kind: 'achievement', id: 'first-block', updatedAt: VECER, payload: { at: '2026-08-10' } }])
    expect(s.achievements['first-block']).toBe('2026-08-10')
  })

  it('pozdější odemčení to dřívější nepřepíše', () => {
    const s = makeState((state) => {
      state.achievements['first-block'] = '2026-08-10'
    })
    touch(s, 'achievement', 'first-block', RANO)

    applyRecords(s, [{ kind: 'achievement', id: 'first-block', updatedAt: VECER, payload: { at: '2026-08-17' } }])
    expect(s.achievements['first-block']).toBe('2026-08-10')
  })
})

/* ------------------------------------------------------------------ */
/*  Celý přenos                                                        */
/* ------------------------------------------------------------------ */

describe('nové zařízení', () => {
  it('dostane přesně to, co má první', () => {
    const prvni = makeState((state) => {
      state.settings.name = 'Martin'
      state.settings.steps.weeklyTarget = 42_000
      state.days['2026-08-17'] = { date: '2026-08-17', steps: 5_000, stepsSource: 'manual', blocks: [] }
      state.measurements.push({ date: '2026-08-17', weightKg: 92.4, toeTouchCm: 15 })
      state.weeklyTaskLogs['2026-08-17|gym'] = { week: '2026-08-17', taskId: 'gym', dates: ['2026-08-17'], carried: 0 }
      state.achievements['first-block'] = '2026-08-17'
    })
    touchEverything(prvni, VECER)

    const druhe = makeState()
    applyRecords(druhe, collectAll(prvni))

    expect(druhe.settings.name).toBe('Martin')
    expect(druhe.settings.steps.weeklyTarget).toBe(42_000)
    expect(druhe.days['2026-08-17']).toEqual(prvni.days['2026-08-17'])
    expect(druhe.measurements).toEqual(prvni.measurements)
    expect(druhe.weeklyTaskLogs).toEqual(prvni.weeklyTaskLogs)
    expect(druhe.achievements).toEqual(prvni.achievements)
  })

  it('opakované sloučení už nic nemění', () => {
    const prvni = makeState()
    setDay(prvni, '2026-08-17', 5_000, RANO)

    const druhe = makeState()
    applyRecords(druhe, collectAll(prvni))
    const result = applyRecords(druhe, collectAll(prvni))
    expect(result.applied).toBe(0)
  })

  it('po sloučení nemá co posílat zpátky', () => {
    const prvni = makeState()
    setDay(prvni, '2026-08-17', 5_000, RANO)
    touchEverything(prvni, RANO)

    const druhe = makeState()
    applyRecords(druhe, collectAll(prvni))

    // Vše, co druhé zařízení zná, má razítko ze serveru – nic novějšího nevzniklo.
    expect(collectChanged(druhe, RANO)).toEqual([])
  })
})
