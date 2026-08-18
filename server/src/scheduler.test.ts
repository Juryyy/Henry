import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Testy plánovače.
 *
 * Odesílání push je nahrazené špionem – zajímá nás, KDY a S ČÍM se volá,
 * ne jestli dojde notifikace na telefon.
 */
const sent: { title: string; body: string; tag?: string; url?: string; silent?: boolean; userId?: string }[] = []

vi.mock('./push.js', () => ({
  sendToUser: vi.fn(
    async (userId: string, payload: { title: string; body: string; tag?: string; silent?: boolean }) => {
      sent.push({ ...payload, userId })
      return { sent: 1, removed: 0, failed: 0 }
    },
  ),
}))

import type { StateSnapshot } from './store.js'

const { tick } = await import('./scheduler.js')
const { DEFAULT_SCHEDULE, setSchedule, setSnapshot, upsertSubscription, markSent, setMuted, getMuted } =
  await import('./store.js')
const { closeDb, openDb } = await import('./db.js')
const { createUser } = await import('./users.js')

let userId = ''

/** Konkrétní okamžik v pražském čase. 17. 8. 2026 je pondělí. */
function at(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+02:00`)
}

/** Stav zápisu v tabulce `sent` – testy na rozpočet ho potřebují vidět. */
function sentStatus(key: string): string | undefined {
  const row = openDb(':memory:').prepare('SELECT status FROM sent WHERE user_id = ? AND key = ?').get(userId, key) as
    | { status: string }
    | undefined
  return row?.status
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

beforeEach(async () => {
  sent.length = 0
  closeDb()
  openDb(':memory:')
  userId = (await createUser('ja@example.com', 'dost-dlouhe-heslo')).id
  setSchedule(userId, { ...DEFAULT_SCHEDULE, timezone: 'Europe/Prague' })
  upsertSubscription(userId, {
    endpoint: 'https://push.example/1',
    keys: { p256dh: 'a', auth: 'b' },
    label: 'test',
  })
  setSnapshot(userId, snapshot())
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

    sent.length = 0
    markSent(userId, '2026-08-17|block-0', false)
    await tick(at('2026-08-17', '07:40'))
    expect(sent).toHaveLength(0)
  })

  it('odcvičený blok se nepřipomíná', async () => {
    setSnapshot(userId, snapshot({ doneSlots: [0] }))
    await tick(at('2026-08-17', '07:15'))
    expect(sent).toHaveLength(0)
  })

  it('v noci mlčí', async () => {
    await tick(at('2026-08-17', '23:00'))
    await tick(at('2026-08-18', '05:00'))
    expect(sent).toHaveLength(0)
  })

  it('bez zařízení neposílá nic', async () => {
    openDb(':memory:').prepare('DELETE FROM subscriptions').run()
    await tick(at('2026-08-17', '07:15'))
    expect(sent).toHaveLength(0)
  })

  it('vypnuté notifikace nechodí', async () => {
    setSchedule(userId, { enabled: false })
    await tick(at('2026-08-17', '07:15'))
    expect(sent).toHaveLength(0)
  })

  it('odpolední kontrola kroků chodí jen pod prahem', async () => {
    // 4 000 z porce 5 000 = 80 %, práh je 60 % → nic.
    setSnapshot(userId, snapshot({ steps: 4_000, stepsNeededToday: 1_000 }))
    await tick(at('2026-08-17', '17:45'))
    expect(sent).toHaveLength(0)

    setSnapshot(userId, snapshot({ steps: 1_000, stepsNeededToday: 4_000 }))
    markSent(userId, '2026-08-17|steps', false)
    openDb(':memory:').prepare('DELETE FROM sent').run()
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
    // Předstírej, že už dnes odešly čtyři.
    for (const key of ['block-0', 'steps', 'steps-last', 'tasks']) {
      markSent(userId, `2026-08-17|${key}`, true)
    }
    await tick(at('2026-08-17', '12:30'))
    expect(sent).toHaveLength(0)
    expect(sentStatus('2026-08-17|block-1')).toBe('skip')
  })

  it('přeskočený slot rozpočet neujídá', async () => {
    for (const key of ['block-0', 'steps', 'steps-last', 'tasks']) {
      markSent(userId, `2026-08-17|${key}`, false)
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
    // Tři předchozí dny: připomínka odešla, blok zůstal neodcvičený.
    for (const day of ['2026-08-14', '2026-08-15', '2026-08-16']) {
      markSent(userId, `${day}|block-0`, true)
    }
    setSnapshot(userId, snapshot({
      history: [
        { date: '2026-08-16', slots: [], steps: 0, target: 5_000 },
        { date: '2026-08-15', slots: [], steps: 0, target: 5_000 },
        { date: '2026-08-14', slots: [], steps: 0, target: 5_000 },
      ],
    }))

    await tick(at('2026-08-17', '07:15'))
    expect(sent).toHaveLength(0)
    expect(getMuted(userId, 'block-0')).toBe('2026-08-19')
  })

  it('ztlumení se samo neobnovuje donekonečna', async () => {
    setMuted(userId, 'block-0', '2026-08-19')
    // Dny, kdy jsme mlčeli, jsou zapsané jako 'skip'.
    for (const day of ['2026-08-14', '2026-08-15', '2026-08-16']) {
      markSent(userId, `${day}|block-0`, false)
    }
    setSnapshot(userId, snapshot({
      date: '2026-08-19',
      history: [
        { date: '2026-08-16', slots: [], steps: 0, target: 5_000 },
        { date: '2026-08-15', slots: [], steps: 0, target: 5_000 },
        { date: '2026-08-14', slots: [], steps: 0, target: 5_000 },
      ],
    }))

    // 19. 8. 2026 je středa – ztlumení už vypršelo a nesmí se prodloužit.
    await tick(at('2026-08-19', '07:15'))
    expect(sent).toHaveLength(1)
    expect(getMuted(userId, 'block-0')).toBeNull()
  })

  it('připomínají se jen bloky, které uživatel opravdu cvičí', async () => {
    setSchedule(userId, { activeSlots: [0] })
    await tick(at('2026-08-17', '12:30'))
    expect(sent).toHaveLength(0)
  })

  it('kdo cvičí jen večer, ráno nic nedostane – a večer ano', async () => {
    setSchedule(userId, { activeSlots: [2] })
    await tick(at('2026-08-17', '07:15'))
    expect(sent).toHaveLength(0)

    await tick(at('2026-08-17', '20:00'))
    expect(sent).toHaveLength(1)
    // Odkaz míří na pozici bloku, ne na pořadí mezi zapnutými.
    expect(sent[0]?.url).toBe('#/cviceni/2')
  })

  it('vlastní název bloku se propíše do notifikace', async () => {
    setSchedule(userId, { activeSlots: [0], blockTitles: ['Rozcvička u kafe', '', ''] })
    await tick(at('2026-08-18', '07:15'))
    expect(sent[0]?.title).toBe('Rozcvička u kafe')
  })

  it('prázdný seznam bloků neumlčí všechno – vrátí se výchozí', async () => {
    setSchedule(userId, { activeSlots: [] })
    await tick(at('2026-08-17', '12:30'))
    expect(sent).toHaveLength(1)
  })

  it('neaktuální snímek nezpůsobí nesmyslnou hlášku o krocích', async () => {
    setSnapshot(userId, snapshot({ date: '2026-08-10' }))
    await tick(at('2026-08-17', '17:45'))
    expect(sent).toHaveLength(0)
  })

  it('každý účet dostane jen svoje notifikace', async () => {
    // Druhý účet se svým vlastním zařízením a jiným časem ranního bloku.
    const druhy = (await createUser('nekdo@example.com', 'dost-dlouhe-heslo')).id
    setSchedule(druhy, { ...DEFAULT_SCHEDULE, timezone: 'Europe/Prague', blockTimes: ['08:30', '12:30', '20:00'] })
    upsertSubscription(druhy, { endpoint: 'https://push.example/2', keys: { p256dh: 'c', auth: 'd' }, label: 'druhý' })
    setSnapshot(druhy, snapshot())

    await tick(at('2026-08-17', '07:15'))
    expect(sent.map((m) => m.userId)).toEqual([userId])

    sent.length = 0
    await tick(at('2026-08-17', '08:30'))
    expect(sent.map((m) => m.userId)).toEqual([druhy])
  })

  it('vypnuté notifikace jednoho účtu neumlčí druhý', async () => {
    const druhy = (await createUser('nekdo@example.com', 'dost-dlouhe-heslo')).id
    setSchedule(druhy, { ...DEFAULT_SCHEDULE, timezone: 'Europe/Prague' })
    upsertSubscription(druhy, { endpoint: 'https://push.example/2', keys: { p256dh: 'c', auth: 'd' }, label: 'druhý' })
    setSnapshot(druhy, snapshot())
    setSchedule(userId, { enabled: false })

    await tick(at('2026-08-17', '07:15'))
    expect(sent.map((m) => m.userId)).toEqual([druhy])
  })
})
