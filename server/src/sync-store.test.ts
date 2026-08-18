import { beforeEach, describe, expect, it } from 'vitest'
import {
  closeSyncDb,
  currentRev,
  listSnapshots,
  openSyncDb,
  pullRecords,
  pushRecords,
  restoreSnapshot,
  saveSnapshot,
  syncStats,
  type SyncRecord,
} from './sync-store.js'

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

beforeEach(() => {
  closeSyncDb()
  openSyncDb(':memory:')
})

describe('nahrávání a stahování', () => {
  it('prázdné úložiště nemá žádnou revizi', () => {
    expect(currentRev()).toBe(0)
    expect(pullRecords(0).records).toEqual([])
  })

  it('nahraný záznam se dá stáhnout zpátky', () => {
    pushRecords([rec('day', '2026-08-17', '2026-08-17T10:00:00.000Z', { steps: 5_000 })])
    const { rev, records } = pullRecords(0)
    expect(rev).toBe(1)
    expect(records).toHaveLength(1)
    expect(records[0]!.payload).toEqual({ steps: 5_000 })
  })

  it('zařízení dostane jen to, co od minula přibylo', () => {
    pushRecords([rec('day', 'a', '2026-08-17T10:00:00.000Z')])
    const first = pullRecords(0)
    pushRecords([rec('day', 'b', '2026-08-17T11:00:00.000Z')])

    const delta = pullRecords(first.rev)
    expect(delta.records.map((r) => r.id)).toEqual(['b'])
  })

  it('nesmyslné záznamy se přeskočí, zbytek projde', () => {
    const result = pushRecords([
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
    pushRecords([rec('day', '2026-08-17', '2026-08-17T10:00:00.000Z', { steps: 3_000 })])
    pushRecords([rec('day', '2026-08-17', '2026-08-17T18:00:00.000Z', { steps: 9_000 })])
    expect(pullRecords(0).records[0]!.payload).toEqual({ steps: 9_000 })
  })

  it('starší zápis novější nepřebije', () => {
    pushRecords([rec('day', '2026-08-17', '2026-08-17T18:00:00.000Z', { steps: 9_000 })])
    const result = pushRecords([rec('day', '2026-08-17', '2026-08-17T10:00:00.000Z', { steps: 3_000 })])
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(1)
    expect(pullRecords(0).records[0]!.payload).toEqual({ steps: 9_000 })
  })

  it('zápisy do různých záznamů se navzájem nepřepisují', () => {
    // Ráno telefon odškrtne blok, odpoledne notebook zapíše kroky.
    pushRecords([rec('day', '2026-08-17', '2026-08-17T08:00:00.000Z', { blocks: [0] })])
    pushRecords([rec('measurement', '2026-08-17', '2026-08-17T15:00:00.000Z', { weightKg: 92.4 })])

    const byId = Object.fromEntries(pullRecords(0).records.map((r) => [`${r.kind}:${r.id}`, r.payload]))
    expect(byId['day:2026-08-17']).toEqual({ blocks: [0] })
    expect(byId['measurement:2026-08-17']).toEqual({ weightKg: 92.4 })
  })

  it('stejný čas se nepovažuje za změnu', () => {
    const at = '2026-08-17T10:00:00.000Z'
    pushRecords([rec('day', 'a', at, { steps: 1 })])
    const result = pushRecords([rec('day', 'a', at, { steps: 2 })])
    expect(result.applied).toBe(0)
    expect(pullRecords(0).records[0]!.payload).toEqual({ steps: 1 })
  })

  it('rozjeté hodiny na zařízení nezablokují další zápisy', () => {
    // Telefon s časem o rok napřed by jinak vyhrával nade vším až do roku 2027.
    const future = new Date(Date.now() + 365 * 24 * 3_600_000).toISOString()
    pushRecords([rec('day', 'a', future, { steps: 1 })])

    const stored = pullRecords(0).records[0]!
    expect(Date.parse(stored.updatedAt)).toBeLessThanOrEqual(Date.now() + 1_000)

    const now = new Date(Date.now() + 60_000).toISOString()
    expect(pushRecords([rec('day', 'a', now, { steps: 2 })]).applied).toBe(1)
  })
})

describe('mazání', () => {
  it('smazaný záznam se přenáší jako náhrobek, ne jako díra', () => {
    pushRecords([rec('measurement', '2026-08-01', '2026-08-01T10:00:00.000Z', { weightKg: 95 })])
    pushRecords([{ kind: 'measurement', id: '2026-08-01', updatedAt: '2026-08-02T10:00:00.000Z', deleted: true }])

    const records = pullRecords(0).records
    expect(records).toHaveLength(1)
    expect(records[0]!.deleted).toBe(true)
  })

  it('starší zařízení smazaný záznam neoživí', () => {
    pushRecords([{ kind: 'measurement', id: 'x', updatedAt: '2026-08-02T10:00:00.000Z', deleted: true }])
    const result = pushRecords([rec('measurement', 'x', '2026-08-01T10:00:00.000Z', { weightKg: 95 })])
    expect(result.applied).toBe(0)
    expect(pullRecords(0).records[0]!.deleted).toBe(true)
  })
})

describe('verze stavu', () => {
  it('uloží se a dá se k nim vrátit', () => {
    pushRecords([rec('day', '2026-08-17', '2026-08-17T10:00:00.000Z', { steps: 5_000 })])
    const snapshot = saveSnapshot()!
    expect(snapshot.records).toBe(1)

    pushRecords([rec('day', '2026-08-17', '2026-08-17T20:00:00.000Z', { steps: 0 })])
    expect(pullRecords(0).records[0]!.payload).toEqual({ steps: 0 })

    expect(restoreSnapshot(snapshot.rev)).toEqual({ restored: 1 })
    expect(pullRecords(0).records[0]!.payload).toEqual({ steps: 5_000 })
  })

  it('návrat pohřbí i to, co ve verzi nebylo', () => {
    pushRecords([rec('day', 'a', '2026-08-17T10:00:00.000Z')])
    const snapshot = saveSnapshot()!
    pushRecords([rec('day', 'b', '2026-08-18T10:00:00.000Z')])

    restoreSnapshot(snapshot.rev)
    const alive = pullRecords(0).records.filter((r) => !r.deleted)
    expect(alive.map((r) => r.id)).toEqual(['a'])
  })

  it('obnovená data se rozešlou i na ostatní zařízení', () => {
    pushRecords([rec('day', 'a', '2026-08-17T10:00:00.000Z', { steps: 1 })])
    const snapshot = saveSnapshot()!
    pushRecords([rec('day', 'a', '2026-08-18T10:00:00.000Z', { steps: 2 })])
    const before = currentRev()

    restoreSnapshot(snapshot.rev)
    // Nová revize = druhé zařízení si při dalším dotazu obnovu stáhne.
    expect(currentRev()).toBeGreaterThan(before)
    expect(pullRecords(before).records.map((r) => r.payload)).toEqual([{ steps: 1 }])
  })

  it('stejná revize se neukládá dvakrát', () => {
    pushRecords([rec('day', 'a', '2026-08-17T10:00:00.000Z')])
    saveSnapshot()
    expect(saveSnapshot()).toBeNull()
    expect(listSnapshots()).toHaveLength(1)
  })

  it('neznámá verze vrátí null', () => {
    expect(restoreSnapshot(999)).toBeNull()
  })

  it('drží se jen posledních třicet verzí', () => {
    for (let i = 1; i <= 35; i++) {
      pushRecords([rec('day', `d${i}`, `2026-08-17T10:00:${String(i).padStart(2, '0')}.000Z`)])
      saveSnapshot()
    }
    expect(listSnapshots()).toHaveLength(30)
  })
})

describe('statistika', () => {
  it('spočítá záznamy podle druhu', () => {
    pushRecords([
      rec('day', 'a', '2026-08-17T10:00:00.000Z'),
      rec('day', 'b', '2026-08-17T10:00:00.000Z'),
      rec('measurement', 'c', '2026-08-17T10:00:00.000Z'),
      { kind: 'task', id: 'd', updatedAt: '2026-08-17T10:00:00.000Z', deleted: true },
    ])
    const stats = syncStats()
    expect(stats.kinds).toEqual({ day: 2, measurement: 1 })
    expect(stats.deleted).toBe(1)
    expect(stats.records).toBe(4)
  })
})
