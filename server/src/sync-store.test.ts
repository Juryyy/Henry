import { beforeEach, describe, expect, it } from 'vitest'
import {
  currentRev,
  listVersions,
  pullRecords,
  pushRecords,
  restoreVersion,
  saveVersion,
  syncStats,
  type SyncRecord,
} from './sync-store.js'
import { closeDb, openDb } from './db.js'
import { createUser } from './users.js'

/**
 * Slučování dat ze dvou zařízení.
 *
 * Pravidlo je jediné: u každého záznamu vyhraje novější zápis. Testy hlídají,
 * že se to opravdu děje po záznamech – ne přes celý stav, protože pak by
 * odpolední zápis z notebooku smazal ranní odškrtnutý blok z telefonu.
 */
function rec(kind: string, id: string, updatedAt: string, payload?: unknown): SyncRecord {
  return { kind, id, updatedAt, payload: payload ?? { id } }
}

/** Dva účty, ať je na čem ukázat, že si do sebe navzájem nevidí. */
let ja = ''
let nekdo = ''

beforeEach(async () => {
  closeDb()
  openDb(':memory:')
  ja = (await createUser('ja@example.com', 'dost-dlouhe-heslo')).id
  nekdo = (await createUser('nekdo@example.com', 'dost-dlouhe-heslo')).id
})

describe('nahrávání a stahování', () => {
  it('prázdné úložiště nemá žádnou revizi', () => {
    expect(currentRev(ja)).toBe(0)
    expect(pullRecords(ja, 0).records).toEqual([])
  })

  it('nahraný záznam se dá stáhnout zpátky', () => {
    pushRecords(ja, [rec('day', '2026-08-17', '2026-08-17T10:00:00.000Z', { steps: 5_000 })])
    const { rev, records } = pullRecords(ja, 0)
    expect(rev).toBe(1)
    expect(records).toHaveLength(1)
    expect(records[0]!.payload).toEqual({ steps: 5_000 })
  })

  it('zařízení dostane jen to, co od minula přibylo', () => {
    pushRecords(ja, [rec('day', 'a', '2026-08-17T10:00:00.000Z')])
    const first = pullRecords(ja, 0)
    pushRecords(ja, [rec('day', 'b', '2026-08-17T11:00:00.000Z')])

    const delta = pullRecords(ja, first.rev)
    expect(delta.records.map((r) => r.id)).toEqual(['b'])
  })

  it('nesmyslné záznamy se přeskočí, zbytek projde', () => {
    const result = pushRecords(ja, [
      rec('day', 'a', '2026-08-17T10:00:00.000Z'),
      { kind: 'day' },
      null,
      'ne',
      { kind: '', id: 'x', updatedAt: '2026-08-17T10:00:00.000Z' },
    ])
    expect(result.applied).toBe(1)
    expect(result.skipped).toBe(4)
  })
})

describe('souběh dvou zařízení', () => {
  it('novější zápis přepíše starší', () => {
    pushRecords(ja, [rec('day', '2026-08-17', '2026-08-17T10:00:00.000Z', { steps: 3_000 })])
    pushRecords(ja, [rec('day', '2026-08-17', '2026-08-17T18:00:00.000Z', { steps: 9_000 })])
    expect(pullRecords(ja, 0).records[0]!.payload).toEqual({ steps: 9_000 })
  })

  it('starší zápis novější nepřebije', () => {
    pushRecords(ja, [rec('day', '2026-08-17', '2026-08-17T18:00:00.000Z', { steps: 9_000 })])
    const result = pushRecords(ja, [rec('day', '2026-08-17', '2026-08-17T10:00:00.000Z', { steps: 3_000 })])
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(1)
    expect(pullRecords(ja, 0).records[0]!.payload).toEqual({ steps: 9_000 })
  })

  it('zápisy do různých záznamů se navzájem nepřepisují', () => {
    // Ráno telefon odškrtne blok, odpoledne notebook zapíše kroky.
    pushRecords(ja, [rec('day', '2026-08-17', '2026-08-17T08:00:00.000Z', { blocks: [0] })])
    pushRecords(ja, [rec('measurement', '2026-08-17', '2026-08-17T15:00:00.000Z', { weightKg: 92.4 })])

    const byId = Object.fromEntries(pullRecords(ja, 0).records.map((r) => [`${r.kind}:${r.id}`, r.payload]))
    expect(byId['day:2026-08-17']).toEqual({ blocks: [0] })
    expect(byId['measurement:2026-08-17']).toEqual({ weightKg: 92.4 })
  })

  it('stejný čas se nepovažuje za změnu', () => {
    const at = '2026-08-17T10:00:00.000Z'
    pushRecords(ja, [rec('day', 'a', at, { steps: 1 })])
    const result = pushRecords(ja, [rec('day', 'a', at, { steps: 2 })])
    expect(result.applied).toBe(0)
    expect(pullRecords(ja, 0).records[0]!.payload).toEqual({ steps: 1 })
  })

  it('rozjeté hodiny na zařízení nezablokují další zápisy', () => {
    // Telefon s časem o rok napřed by jinak vyhrával nade vším až do roku 2027.
    const future = new Date(Date.now() + 365 * 24 * 3_600_000).toISOString()
    pushRecords(ja, [rec('day', 'a', future, { steps: 1 })])

    const stored = pullRecords(ja, 0).records[0]!
    expect(Date.parse(stored.updatedAt)).toBeLessThanOrEqual(Date.now() + 1_000)

    const now = new Date(Date.now() + 60_000).toISOString()
    expect(pushRecords(ja, [rec('day', 'a', now, { steps: 2 })]).applied).toBe(1)
  })
})

describe('mazání', () => {
  it('smazaný záznam se přenáší jako náhrobek, ne jako díra', () => {
    pushRecords(ja, [rec('measurement', '2026-08-01', '2026-08-01T10:00:00.000Z', { weightKg: 95 })])
    pushRecords(ja, [{ kind: 'measurement', id: '2026-08-01', updatedAt: '2026-08-02T10:00:00.000Z', deleted: true }])

    const records = pullRecords(ja, 0).records
    expect(records).toHaveLength(1)
    expect(records[0]!.deleted).toBe(true)
  })

  it('starší zařízení smazaný záznam neoživí', () => {
    pushRecords(ja, [{ kind: 'measurement', id: 'x', updatedAt: '2026-08-02T10:00:00.000Z', deleted: true }])
    const result = pushRecords(ja, [rec('measurement', 'x', '2026-08-01T10:00:00.000Z', { weightKg: 95 })])
    expect(result.applied).toBe(0)
    expect(pullRecords(ja, 0).records[0]!.deleted).toBe(true)
  })
})

describe('verze stavu', () => {
  it('uloží se a dá se k nim vrátit', () => {
    pushRecords(ja, [rec('day', '2026-08-17', '2026-08-17T10:00:00.000Z', { steps: 5_000 })])
    const snapshot = saveVersion(ja)!
    expect(snapshot.records).toBe(1)

    pushRecords(ja, [rec('day', '2026-08-17', '2026-08-17T20:00:00.000Z', { steps: 0 })])
    expect(pullRecords(ja, 0).records[0]!.payload).toEqual({ steps: 0 })

    expect(restoreVersion(ja, snapshot.rev)).toEqual({ restored: 1 })
    expect(pullRecords(ja, 0).records[0]!.payload).toEqual({ steps: 5_000 })
  })

  it('návrat pohřbí i to, co ve verzi nebylo', () => {
    pushRecords(ja, [rec('day', 'a', '2026-08-17T10:00:00.000Z')])
    const snapshot = saveVersion(ja)!
    pushRecords(ja, [rec('day', 'b', '2026-08-18T10:00:00.000Z')])

    restoreVersion(ja, snapshot.rev)
    const alive = pullRecords(ja, 0).records.filter((r) => !r.deleted)
    expect(alive.map((r) => r.id)).toEqual(['a'])
  })

  it('obnovená data se rozešlou i na ostatní zařízení', () => {
    pushRecords(ja, [rec('day', 'a', '2026-08-17T10:00:00.000Z', { steps: 1 })])
    const snapshot = saveVersion(ja)!
    pushRecords(ja, [rec('day', 'a', '2026-08-18T10:00:00.000Z', { steps: 2 })])
    const before = currentRev(ja)

    restoreVersion(ja, snapshot.rev)
    // Nová revize = druhé zařízení si při dalším dotazu obnovu stáhne.
    expect(currentRev(ja)).toBeGreaterThan(before)
    expect(pullRecords(ja, before).records.map((r) => r.payload)).toEqual([{ steps: 1 }])
  })

  it('stejná revize se neukládá dvakrát', () => {
    pushRecords(ja, [rec('day', 'a', '2026-08-17T10:00:00.000Z')])
    saveVersion(ja)
    expect(saveVersion(ja)).toBeNull()
    expect(listVersions(ja)).toHaveLength(1)
  })

  it('neznámá verze vrátí null', () => {
    expect(restoreVersion(ja, 999)).toBeNull()
  })

  it('drží se jen posledních třicet verzí', () => {
    for (let i = 1; i <= 35; i++) {
      pushRecords(ja, [rec('day', `d${i}`, `2026-08-17T10:00:${String(i).padStart(2, '0')}.000Z`)])
      saveVersion(ja)
    }
    expect(listVersions(ja)).toHaveLength(30)
  })
})

describe('statistika', () => {
  it('spočítá záznamy podle druhu', () => {
    pushRecords(ja, [
      rec('day', 'a', '2026-08-17T10:00:00.000Z'),
      rec('day', 'b', '2026-08-17T10:00:00.000Z'),
      rec('measurement', 'c', '2026-08-17T10:00:00.000Z'),
      { kind: 'task', id: 'd', updatedAt: '2026-08-17T10:00:00.000Z', deleted: true },
    ])
    const stats = syncStats(ja)
    expect(stats.kinds).toEqual({ day: 2, measurement: 1 })
    expect(stats.deleted).toBe(1)
    expect(stats.records).toBe(4)
  })
})

describe('oddělení účtů', () => {
  it('data jednoho účtu nejsou vidět z druhého', () => {
    pushRecords(ja, [rec('day', '2026-08-17', '2026-08-17T10:00:00.000Z', { steps: 5_000 })])
    pushRecords(nekdo, [rec('day', '2026-08-17', '2026-08-17T10:00:00.000Z', { steps: 1 })])

    expect(pullRecords(ja, 0).records[0]!.payload).toEqual({ steps: 5_000 })
    expect(pullRecords(nekdo, 0).records[0]!.payload).toEqual({ steps: 1 })
  })

  it('revize si každý účet počítá vlastní', () => {
    pushRecords(ja, [rec('day', 'a', '2026-08-17T10:00:00.000Z')])
    pushRecords(ja, [rec('day', 'b', '2026-08-17T11:00:00.000Z')])
    pushRecords(nekdo, [rec('day', 'a', '2026-08-17T10:00:00.000Z')])

    expect(currentRev(ja)).toBe(2)
    expect(currentRev(nekdo)).toBe(1)
  })

  it('návrat k verzi sáhne jen na vlastní data', () => {
    pushRecords(ja, [rec('day', 'a', '2026-08-17T10:00:00.000Z', { steps: 1 })])
    const version = saveVersion(ja)!
    pushRecords(ja, [rec('day', 'a', '2026-08-18T10:00:00.000Z', { steps: 2 })])
    pushRecords(nekdo, [rec('day', 'a', '2026-08-18T10:00:00.000Z', { steps: 99 })])

    restoreVersion(ja, version.rev)

    expect(pullRecords(ja, 0).records[0]!.payload).toEqual({ steps: 1 })
    expect(pullRecords(nekdo, 0).records[0]!.payload).toEqual({ steps: 99 })
  })

  it('cizí verze se obnovit nedá', () => {
    pushRecords(nekdo, [rec('day', 'a', '2026-08-17T10:00:00.000Z')])
    const version = saveVersion(nekdo)!
    expect(restoreVersion(ja, version.rev)).toBeNull()
  })

  it('statistika počítá jen vlastní záznamy', () => {
    pushRecords(ja, [rec('day', 'a', '2026-08-17T10:00:00.000Z')])
    pushRecords(nekdo, [
      rec('day', 'b', '2026-08-17T10:00:00.000Z'),
      rec('day', 'c', '2026-08-17T10:00:00.000Z'),
    ])
    expect(syncStats(ja).kinds).toEqual({ day: 1 })
    expect(syncStats(nekdo).kinds).toEqual({ day: 2 })
  })
})
