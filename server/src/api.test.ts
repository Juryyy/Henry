import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'

/**
 * Testy HTTP rozhraní.
 *
 * Jedou proti opravdové Express aplikaci na náhodném portu – tedy včetně
 * pořadí middlewarů, CORS a parsování těla. Odesílání push je nahrazené,
 * jinak by test volal ven na push službu.
 */
vi.mock('./push.js', () => ({
  sendToAll: vi.fn(async () => ({ sent: 1, removed: 0, failed: 0 })),
}))

const { app } = await import('./app.js')
const { getDb, DEFAULT_SCHEDULE } = await import('./store.js')

const TOKEN = 'testovaci-token'

let server: Server
let base: string

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server nedostal port')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  const db = getDb()
  db.subscriptions = []
  db.snapshot = null
  db.schedule = { ...DEFAULT_SCHEDULE }
  db.steps = {}
  db.sent = {}
  db.muted = {}
  db.log = []
})

/** Požadavek s tokenem. Tělo se posílá jako JSON, pokud není řetězec. */
function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null; type?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (init.token !== null) headers.Authorization = `Bearer ${init.token ?? TOKEN}`
  if (init.body !== undefined) headers['Content-Type'] = init.type ?? 'application/json'
  return fetch(`${base}${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  })
}

/** Tělo odpovědi. `Response.json()` vrací `unknown`, v testu chceme číst klíče. */
async function readJson(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>
}

const SUB = {
  endpoint: 'https://push.example/abcdefghijkl',
  keys: { p256dh: 'klic', auth: 'tajemstvi' },
}

/* ------------------------------------------------------------------ */

describe('veřejné endpointy', () => {
  it('/api/health odpoví i bez tokenu', async () => {
    const res = await call('/api/health', { token: null })
    expect(res.status).toBe(200)
    const data = await readJson(res)
    expect(data.ok).toBe(true)
    expect(data.now.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(data.subscriptions).toBe(0)
  })

  it('/api/config vydá veřejný VAPID klíč', async () => {
    const res = await call('/api/config', { token: null })
    const data = await readJson(res)
    expect(data.vapidPublicKey).toMatch(/^B/)
    expect(data.timezone).toBe('Europe/Prague')
  })

  it('neznámý endpoint je 404 s JSON tělem', async () => {
    const res = await call('/api/neexistuje', { token: null })
    expect(res.status).toBe(404)
    expect((await readJson(res)).error).toBeTruthy()
  })
})

describe('ověření tokenem', () => {
  it('bez tokenu chodí 401', async () => {
    const res = await call('/api/subscriptions', { token: null })
    expect(res.status).toBe(401)
  })

  it('se špatným tokenem chodí 401', async () => {
    const res = await call('/api/subscriptions', { token: 'uplne-jiny-token' })
    expect(res.status).toBe(401)
  })

  it('token jiné délky nespadne na výjimce', async () => {
    const res = await call('/api/subscriptions', { token: 'x' })
    expect(res.status).toBe(401)
  })

  it('funguje i hlavička X-Henry-Token', async () => {
    const res = await fetch(`${base}/api/subscriptions`, { headers: { 'X-Henry-Token': TOKEN } })
    expect(res.status).toBe(200)
  })

  it('nepřihlášený požadavek se ani nepokusí parsovat tělo', async () => {
    // Kdyby se tělo parsovalo dřív než ověření, vrátilo by se 400 od parseru.
    const res = await call('/api/subscribe', { token: null, body: '{tohle není JSON' })
    expect(res.status).toBe(401)
  })
})

describe('odběry', () => {
  it('uloží odběr a vrátí počet', async () => {
    const res = await call('/api/subscribe', { body: { subscription: SUB, label: 'iPhone' } })
    expect(res.status).toBe(200)
    expect((await readJson(res)).subscriptions).toBe(1)
    expect(getDb().subscriptions[0]!.label).toBe('iPhone')
  })

  it('stejné zařízení podruhé nezaloží druhý odběr', async () => {
    await call('/api/subscribe', { body: { subscription: SUB } })
    await call('/api/subscribe', { body: { subscription: SUB, label: 'iPhone znovu' } })
    expect(getDb().subscriptions).toHaveLength(1)
    expect(getDb().subscriptions[0]!.label).toBe('iPhone znovu')
  })

  it('odběr bez klíčů je 400', async () => {
    const res = await call('/api/subscribe', { body: { subscription: { endpoint: 'https://push.example/x' } } })
    expect(res.status).toBe(400)
    expect(getDb().subscriptions).toHaveLength(0)
  })

  it('odhlášení odebere zařízení', async () => {
    await call('/api/subscribe', { body: { subscription: SUB } })
    const res = await call('/api/unsubscribe', { body: { endpoint: SUB.endpoint } })
    expect((await readJson(res)).removed).toBe(true)
    expect(getDb().subscriptions).toHaveLength(0)
  })

  it('odhlášení neznámého endpointu není chyba', async () => {
    const res = await call('/api/unsubscribe', { body: { endpoint: 'https://push.example/nikdo' } })
    expect(res.status).toBe(200)
    expect((await readJson(res)).removed).toBe(false)
  })

  it('výpis odběrů neprozradí celý endpoint', async () => {
    await call('/api/subscribe', { body: { subscription: SUB } })
    const data = await readJson(await call('/api/subscriptions'))
    expect(data.subscriptions[0].endpointTail).toBe('abcdefghijkl')
    expect(JSON.stringify(data)).not.toContain('push.example')
  })
})

describe('synchronizace', () => {
  it('uloží snímek a nastavení', async () => {
    const res = await call('/api/sync', {
      body: {
        snapshot: { date: '2026-08-17', steps: 3_000, stepsNeededToday: 2_000, name: 'Martin' },
        schedule: { tone: 'drsny', stepCheckTime: '18:00' },
      },
    })
    expect(res.status).toBe(200)
    const db = getDb()
    expect(db.snapshot!.steps).toBe(3_000)
    expect(db.snapshot!.name).toBe('Martin')
    expect(db.schedule.tone).toBe('drsny')
    expect(db.schedule.stepCheckTime).toBe('18:00')
    // Neposlané klíče zůstávají na výchozích hodnotách.
    expect(db.schedule.blockTimes).toEqual(DEFAULT_SCHEDULE.blockTimes)
  })

  it('počet bloků udrží v rozmezí 1–3', async () => {
    await call('/api/sync', { body: { schedule: { blocksPerDay: 9 } } })
    expect(getDb().schedule.blocksPerDay).toBe(3)
    await call('/api/sync', { body: { schedule: { blocksPerDay: 0 } } })
    expect(getDb().schedule.blocksPerDay).toBe(1)
  })

  it('nesmyslné hodnoty ve snímku nepustí dál jako NaN', async () => {
    await call('/api/sync', { body: { snapshot: { date: '2026-08-17', steps: 'hodně' } } })
    expect(getDb().snapshot!.steps).toBe(0)
  })

  it('vrátí kroky nahrané zkratkou pro dnešní den', async () => {
    await call('/api/ingest/steps', { body: { date: '2026-08-17', steps: 8_123 } })
    const res = await call('/api/sync', { body: { snapshot: { date: '2026-08-17' } } })
    const data = await readJson(res)
    expect(data.serverSteps.steps).toBe(8_123)
  })

  it('bez odpovídajícího dne vrátí null', async () => {
    const res = await call('/api/sync', { body: { snapshot: { date: '2026-08-17' } } })
    expect((await readJson(res)).serverSteps).toBeNull()
  })
})

describe('příjem kroků ze zkratky', () => {
  it('uloží jeden den', async () => {
    const res = await call('/api/ingest/steps', { body: { date: '2026-08-17', steps: 8_123 } })
    expect(res.status).toBe(200)
    expect(getDb().steps['2026-08-17']!.steps).toBe(8_123)
    expect(getDb().steps['2026-08-17']!.source).toBe('shortcuts')
  })

  it('uloží víc dní najednou', async () => {
    await call('/api/ingest/steps', {
      body: {
        days: [
          { date: '2026-08-15', steps: 7_100 },
          { date: '2026-08-16', steps: '9 200' },
        ],
      },
    })
    expect(getDb().steps['2026-08-15']!.steps).toBe(7_100)
    expect(getDb().steps['2026-08-16']!.steps).toBe(9_200)
  })

  it('opakované odeslání kroky nesčítá', async () => {
    await call('/api/ingest/steps', { body: { date: '2026-08-17', steps: 5_000 } })
    await call('/api/ingest/steps', { body: { date: '2026-08-17', steps: 5_000 } })
    expect(getDb().steps['2026-08-17']!.steps).toBe(5_000)
  })

  it('tělo poslané jako text/plain se pořád parsuje', async () => {
    // Zkratka umí poslat tělo jako soubor a nastaví u toho nesmyslný typ.
    const res = await call('/api/ingest/steps', {
      body: JSON.stringify({ date: '2026-08-17', steps: 4_321 }),
      type: 'text/plain',
    })
    expect(res.status).toBe(200)
    expect(getDb().steps['2026-08-17']!.steps).toBe(4_321)
  })

  it('kroky, které nejsou číslo, jsou 400', async () => {
    const res = await call('/api/ingest/steps', { body: { date: '2026-08-17', steps: 'spousta' } })
    expect(res.status).toBe(400)
    expect(getDb().steps['2026-08-17']).toBeUndefined()
  })

  it('nesmyslně velké číslo se zahodí', async () => {
    const res = await call('/api/ingest/steps', { body: { date: '2026-08-17', steps: 999_999 } })
    expect(res.status).toBe(400)
    expect(getDb().steps['2026-08-17']).toBeUndefined()
  })

  it('řádky s nesmyslným datem se přeskočí, zbytek projde', async () => {
    await call('/api/ingest/steps', {
      body: {
        days: [
          { date: '17. 8. 2026', steps: 1_000 },
          { date: '2026-08-17', steps: 2_000 },
        ],
      },
    })
    expect(Object.keys(getDb().steps)).toEqual(['2026-08-17'])
  })

  it('nová data se hned promítnou do snímku pro notifikace', async () => {
    await call('/api/sync', { body: { snapshot: { date: '2026-08-17', steps: 1_000 } } })
    await call('/api/ingest/steps', { body: { date: '2026-08-17', steps: 6_000 } })
    expect(getDb().snapshot!.steps).toBe(6_000)
  })

  it('kroky z jiného dne dnešní snímek nepřepíšou', async () => {
    await call('/api/sync', { body: { snapshot: { date: '2026-08-17', steps: 1_000 } } })
    await call('/api/ingest/steps', { body: { date: '2026-08-16', steps: 6_000 } })
    expect(getDb().snapshot!.steps).toBe(1_000)
  })

  it('rozbité JSON je 400, ne 500', async () => {
    const res = await call('/api/ingest/steps', { body: '{tohle není JSON' })
    expect(res.status).toBe(400)
  })
})

describe('příjem z Health Auto Export', () => {
  it('vytáhne z payloadu denní kroky', async () => {
    const res = await call('/api/ingest/health-auto-export', {
      body: {
        data: {
          metrics: [
            {
              name: 'step_count',
              units: 'count',
              data: [{ date: '2026-08-17 00:00:00 +0200', qty: 8_800 }],
            },
          ],
        },
      },
    })
    expect(res.status).toBe(200)
    expect((await readJson(res)).days).toBe(1)
    expect(getDb().steps['2026-08-17']!.source).toBe('health-auto-export')
  })

  it('payload bez kroků je 400', async () => {
    const res = await call('/api/ingest/health-auto-export', {
      body: { data: { metrics: [{ name: 'heart_rate', units: 'bpm', data: [] }] } },
    })
    expect(res.status).toBe(400)
  })
})

describe('čtení kroků', () => {
  it('vrací nejnovější den první', async () => {
    await call('/api/ingest/steps', {
      body: {
        days: [
          { date: '2026-08-15', steps: 1_000 },
          { date: '2026-08-17', steps: 3_000 },
          { date: '2026-08-16', steps: 2_000 },
        ],
      },
    })
    const data = await readJson(await call('/api/steps?days=2'))
    expect(data.steps.map((s: { date: string }) => s.date)).toEqual(['2026-08-17', '2026-08-16'])
  })

  it('nesmyslný parametr days nespadne', async () => {
    const res = await call('/api/steps?days=abc')
    expect(res.status).toBe(200)
  })
})

describe('diagnostika', () => {
  it('/api/test odešle notifikaci', async () => {
    const res = await call('/api/test', { body: {} })
    expect(res.status).toBe(200)
    expect((await readJson(res)).sent).toBe(1)
  })

  it('/api/log vrací zápisy, nejnovější první', async () => {
    await call('/api/ingest/steps', { body: { date: '2026-08-17', steps: 1_000 } })
    const data = await readJson(await call('/api/log'))
    expect(data.log[0].kind).toBe('steps')
  })
})
