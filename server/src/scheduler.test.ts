import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Testy plánovače.
 *
 * Odesílání push je nahrazené špionem – zajímá nás, KDY a S ČÍM se volá,
 * ne jestli dojde notifikace na telefon.
 */
const sent: { title: string; body: string; tag?: string; silent?: boolean }[] = []

vi.mock('./push.js', () => ({
  sendToAll: vi.fn(async (payload: { title: string; body: string; tag?: string; silent?: boolean }) => {
    sent.push(payload)
    return { sent: 1, removed: 0, failed: 0 }
  }),
}))

import type { StateSnapshot } from './store.js'

const { tick } = await import('./scheduler.js')
const { getDb, DEFAULT_SCHEDULE } = await import('./store.js')

/** Konkrétní okamžik v pražském čase. 17. 8. 2026 je pondělí. */
function at(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+02:00`)
}

function snapshot(patch: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    date: '2026-08-17',
    steps: 0,
    stepsNeededToday: 5_000,
    stepPortionToday: 5_000,
    stepTarget: 5_000,
    blocksDone: 0,
    blocksTarget: 3,
    doneSlots: [],
    stepDebt: 0,
    stepsRemainingThisWeek: 35_000,
    streak: 0,
    openTasks: [],
    name: 'Martin',
    history: [],
    ...patch,
  }
}

beforeEach(() => {
  sent.length = 0
  const db = getDb()
  db.schedule = { ...DEFAULT_SCHEDULE, timezone: 'Europe/Prague' }
  db.subscriptions = [
    { endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' }, label: 'test', createdAt: '', failures: 0 },
  ]
  db.sent = {}
  db.muted = {}
  db.snapshot = snapshot()
  db.log = []
})

describe('plánovač', () => {
  it('v čase ranního bloku pošle připomínku', async () => {
    await tick(at('2026-08-17', '07:15'))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.tag).toBe('block-0')
  })

  it('stejnou připomínku nepošle dvakrát', async () => {
    await tick(at('2026-08-17', '07:15'))
    await tick(at('2026-08-17', '07:16'))
    expect(sent).toHaveLength(1)
  })

  it('okno tolerance dožene zmeškaný tik, po něm už ne', async () => {
    await tick(at('2026-08-17', '07:24'))
    expect(sent).toHaveLength(1)

    getDb().sent = {}
    sent.length = 0
    await tick(at('2026-08-17', '07:40'))
    expect(sent).toHaveLength(0)
  })

  it('odcvičený blok se nepřipomíná', async () => {
    getDb().snapshot = snapshot({ doneSlots: [0] })
    await tick(at('2026-08-17', '07:15'))
    expect(sent).toHaveLength(0)
  })

  it('v noci mlčí', async () => {
    await tick(at('2026-08-17', '23:00'))
    await tick(at('2026-08-18', '05:00'))
    expect(sent).toHaveLength(0)
  })

  it('bez zařízení neposílá nic', async () => {
    getDb().subscriptions = []
    await tick(at('2026-08-17', '07:15'))
    expect(sent).toHaveLength(0)
  })

  it('vypnuté notifikace nechodí', async () => {
    getDb().schedule.enabled = false
    await tick(at('2026-08-17', '07:15'))
    expect(sent).toHaveLength(0)
  })

  it('odpolední kontrola kroků chodí jen pod prahem', async () => {
    // 4 000 z porce 5 000 = 80 %, práh je 60 % → nic.
    getDb().snapshot = snapshot({ steps: 4_000, stepsNeededToday: 1_000 })
    await tick(at('2026-08-17', '17:45'))
    expect(sent).toHaveLength(0)

    getDb().sent = {}
    getDb().snapshot = snapshot({ steps: 1_000, stepsNeededToday: 4_000 })
    await tick(at('2026-08-17', '17:45'))
    expect(sent).toHaveLength(1)
    // formatNumber sází pevnou mezeru (U+00A0), proto \s a ne doslovná mezera.
    expect(sent[0]!.body).toMatch(/4\s000/)
  })

  it('v pondělí ráno otevře nový týden jinou hláškou', async () => {
    await tick(at('2026-08-17', '07:15'))
    expect(sent[0]!.title).toBe('Nový týden')
  })

  it('denní rozpočet omezí počet notifikací se zvukem', async () => {
    const db = getDb()
    // Předstírej, že už dnes odešly čtyři.
    db.sent = {
      '2026-08-17|block-0': 'sent',
      '2026-08-17|steps': 'sent',
      '2026-08-17|steps-last': 'sent',
      '2026-08-17|tasks': 'sent',
    }
    await tick(at('2026-08-17', '12:30'))
    expect(sent).toHaveLength(0)
    expect(db.sent['2026-08-17|block-1']).toBe('skip')
  })

  it('přeskočený slot rozpočet neujídá', async () => {
    const db = getDb()
    db.sent = {
      '2026-08-17|block-0': 'skip',
      '2026-08-17|steps': 'skip',
      '2026-08-17|steps-last': 'skip',
      '2026-08-17|tasks': 'skip',
    }
    await tick(at('2026-08-17', '12:30'))
    expect(sent).toHaveLength(1)
  })

  it('večerní shrnutí je tiché a do rozpočtu se nepočítá', async () => {
    await tick(at('2026-08-17', '21:00'))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.silent).toBe(true)
  })

  it('slot ignorovaný tři dny po sobě se na dva dny odmlčí', async () => {
    const db = getDb()
    // Tři předchozí dny: připomínka odešla, blok zůstal neodcvičený.
    db.sent = {
      '2026-08-14|block-0': 'sent',
      '2026-08-15|block-0': 'sent',
      '2026-08-16|block-0': 'sent',
    }
    db.snapshot = snapshot({
      history: [
        { date: '2026-08-16', slots: [], steps: 0, target: 5_000 },
        { date: '2026-08-15', slots: [], steps: 0, target: 5_000 },
        { date: '2026-08-14', slots: [], steps: 0, target: 5_000 },
      ],
    })

    await tick(at('2026-08-17', '07:15'))
    expect(sent).toHaveLength(0)
    expect(db.muted['block-0']).toBe('2026-08-19')
  })

  it('ztlumení se samo neobnovuje donekonečna', async () => {
    const db = getDb()
    db.muted = { 'block-0': '2026-08-19' }
    // Dny, kdy jsme mlčeli, jsou zapsané jako 'skip'.
    db.sent = {
      '2026-08-14|block-0': 'skip',
      '2026-08-15|block-0': 'skip',
      '2026-08-16|block-0': 'skip',
    }
    db.snapshot = snapshot({
      date: '2026-08-19',
      history: [
        { date: '2026-08-16', slots: [], steps: 0, target: 5_000 },
        { date: '2026-08-15', slots: [], steps: 0, target: 5_000 },
        { date: '2026-08-14', slots: [], steps: 0, target: 5_000 },
      ],
    })

    // 19. 8. 2026 je středa – ztlumení už vypršelo a nesmí se prodloužit.
    await tick(at('2026-08-19', '07:15'))
    expect(sent).toHaveLength(1)
    expect(db.muted['block-0']).toBeUndefined()
  })

  it('připomínají se jen bloky, které uživatel opravdu cvičí', async () => {
    getDb().schedule.blocksPerDay = 1
    await tick(at('2026-08-17', '12:30'))
    expect(sent).toHaveLength(0)
  })

  it('neaktuální snímek nezpůsobí nesmyslnou hlášku o krocích', async () => {
    getDb().snapshot = snapshot({ date: '2026-08-10' })
    await tick(at('2026-08-17', '17:45'))
    expect(sent).toHaveLength(0)
  })
})
