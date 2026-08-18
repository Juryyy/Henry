import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'

/**
 * Testy HTTP rozhraní.
 *
 * Jedou proti opravdové Express aplikaci na náhodném portu – tedy včetně
 * pořadí middlewarů, cookies a parsování těla. Odesílání push je nahrazené,
 * jinak by test volal ven na push službu.
 *
 * Nejdůležitější část je úplně dole: že si dva účty navzájem nevidí do dat.
 * To je věc, která se klikáním neobjeví a v produkci je z ní průšvih.
 */
vi.mock('./push.js', () => ({
  sendToUser: vi.fn(async () => ({ sent: 1, removed: 0, failed: 0 })),
}))

const { app } = await import('./app.js')
const { closeDb, openDb } = await import('./db.js')
const { resetRateLimits } = await import('./auth.js')

const HESLO = 'dost-dlouhe-heslo'

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
  closeDb()
  openDb(':memory:')
  resetRateLimits()
})

/* ------------------------------------------------------------------ */
/*  Klient s cookie                                                    */
/* ------------------------------------------------------------------ */

interface CallInit {
  method?: string
  body?: unknown
  type?: string
  token?: string
  /** Poslat bez přihlašovací cookie. */
  anonymous?: boolean
}

/** Prohlížeč v malém: drží si cookie mezi požadavky. */
function client() {
  let cookie = ''

  async function call(path: string, init: CallInit = {}): Promise<Response> {
    const headers: Record<string, string> = {}
    if (cookie && !init.anonymous) headers.Cookie = cookie
    if (init.token) headers.Authorization = `Bearer ${init.token}`
    if (init.body !== undefined) headers['Content-Type'] = init.type ?? 'application/json'

    const res = await fetch(`${base}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body:
        init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
      redirect: 'manual',
    })

    const set = res.headers.getSetCookie?.() ?? []
    for (const value of set) {
      const [pair] = value.split(';')
      if (pair?.startsWith('henry_session=')) {
        cookie = pair.endsWith('=') ? '' : pair
      }
    }
    return res
  }

  return {
    call,
    json: async (path: string, init: CallInit = {}) => (await (await call(path, init)).json()) as Record<string, any>,
    get cookie() {
      return cookie
    },
  }
}

/** Založí účet a vrátí přihlášeného klienta. */
async function register(email: string, invite?: string) {
  const c = client()
  const res = await c.call('/api/auth/register', { body: { email, password: HESLO, name: 'Martin', invite } })
  return { c, res }
}

/* ------------------------------------------------------------------ */

describe('veřejné endpointy', () => {
  it('/api/health řekne, že registrace je zatím otevřená', async () => {
    const data = await client().json('/api/health')
    expect(data.ok).toBe(true)
    expect(data.registrationOpen).toBe(true)
    expect(data.now.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('/api/config vydá veřejný VAPID klíč', async () => {
    const data = await client().json('/api/config')
    expect(data.vapidPublicKey).toMatch(/^B/)
  })

  it('neznámý endpoint je 404 s JSON tělem', async () => {
    const res = await client().call('/api/neexistuje')
    expect(res.status).toBe(404)
  })
})

describe('registrace', () => {
  it('první účet se založí sám a rovnou přihlásí', async () => {
    const { c, res } = await register('ja@example.com')
    expect(res.status).toBe(200)
    expect(c.cookie).toContain('henry_session=')

    const me = await c.json('/api/auth/me')
    expect(me.user.email).toBe('ja@example.com')
  })

  it('po prvním účtu se registrace zavře', async () => {
    await register('ja@example.com')
    expect((await client().json('/api/health')).registrationOpen).toBe(false)

    const { res } = await register('nekdo@example.com')
    expect(res.status).toBe(403)
  })

  it('s pozvánkou se dovnitř dostane i druhý', async () => {
    const { c } = await register('ja@example.com')
    const { code } = await c.json('/api/auth/invite', { body: {} })

    const { res } = await register('host@example.com', code)
    expect(res.status).toBe(200)
  })

  it('pozvánku nejde použít dvakrát', async () => {
    const { c } = await register('ja@example.com')
    const { code } = await c.json('/api/auth/invite', { body: {} })
    await register('host@example.com', code)

    const { res } = await register('dalsi@example.com', code)
    expect(res.status).toBe(403)
  })

  it('krátké heslo a nesmyslný e-mail se odmítnou', async () => {
    const c = client()
    expect((await c.call('/api/auth/register', { body: { email: 'ja@example.com', password: 'krátké' } })).status).toBe(400)
    expect((await c.call('/api/auth/register', { body: { email: 'nesmysl', password: HESLO } })).status).toBe(400)
  })

  it('stejná adresa podruhé neprojde', async () => {
    const { c } = await register('ja@example.com')
    const { code } = await c.json('/api/auth/invite', { body: {} })
    const res = await client().call('/api/auth/register', {
      body: { email: 'JA@example.com', password: HESLO, invite: code },
    })
    expect(res.status).toBe(409)
  })
})

describe('přihlášení', () => {
  it('se správným heslem projde, se špatným ne', async () => {
    await register('ja@example.com')

    const c = client()
    expect((await c.call('/api/auth/login', { body: { email: 'ja@example.com', password: HESLO } })).status).toBe(200)
    expect((await c.call('/api/auth/login', { body: { email: 'ja@example.com', password: 'spatne-heslo' } })).status).toBe(401)
  })

  it('neexistující účet vrací stejnou hlášku jako špatné heslo', async () => {
    await register('ja@example.com')
    const c = client()
    const spatne = await c.json('/api/auth/login', { body: { email: 'ja@example.com', password: 'spatne-heslo' } })
    const neni = await c.json('/api/auth/login', { body: { email: 'nikdo@example.com', password: HESLO } })
    expect(neni.error).toBe(spatne.error)
  })

  it('bez přihlášení se k datům nikdo nedostane', async () => {
    const c = client()
    for (const path of ['/api/auth/me', '/api/state', '/api/steps', '/api/subscriptions', '/api/log']) {
      expect((await c.call(path)).status).toBe(401)
    }
  })

  it('odhlášení cookie zneplatní', async () => {
    const { c } = await register('ja@example.com')
    const before = c.cookie
    await c.call('/api/auth/logout', { body: {} })

    const res = await fetch(`${base}/api/auth/me`, { headers: { Cookie: before } })
    expect(res.status).toBe(401)
  })

  it('opakované špatné pokusy se zarazí', async () => {
    await register('ja@example.com')
    const c = client()
    let limited = false
    for (let i = 0; i < 15; i++) {
      const res = await c.call('/api/auth/login', { body: { email: 'ja@example.com', password: 'spatne-heslo' } })
      if (res.status === 429) {
        limited = true
        break
      }
    }
    expect(limited).toBe(true)
  })
})

describe('správa účtu', () => {
  it('změna hesla odhlásí ostatní zařízení', async () => {
    const { c } = await register('ja@example.com')

    // Druhé zařízení téhož člověka.
    const telefon = client()
    await telefon.call('/api/auth/login', { body: { email: 'ja@example.com', password: HESLO } })

    const data = await c.json('/api/auth/password', { body: { current: HESLO, next: 'jeste-delsi-heslo' } })
    expect(data.revoked).toBe(1)

    expect((await telefon.call('/api/auth/me')).status).toBe(401)
    expect((await c.call('/api/auth/me')).status).toBe(200)
  })

  it('bez stávajícího hesla se změnit nedá', async () => {
    const { c } = await register('ja@example.com')
    const res = await c.call('/api/auth/password', { body: { current: 'spatne-heslo', next: 'jeste-delsi-heslo' } })
    expect(res.status).toBe(401)
  })

  it('seznam přihlášení ukáže obě zařízení', async () => {
    const { c } = await register('ja@example.com')
    const telefon = client()
    await telefon.call('/api/auth/login', { body: { email: 'ja@example.com', password: HESLO } })

    const data = await c.json('/api/auth/sessions')
    expect(data.sessions).toHaveLength(2)
    expect(data.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1)
  })

  it('ostatní zařízení jde odhlásit jedním tlačítkem', async () => {
    const { c } = await register('ja@example.com')
    const telefon = client()
    await telefon.call('/api/auth/login', { body: { email: 'ja@example.com', password: HESLO } })

    await c.json('/api/auth/sessions/revoke', { body: { all: true } })
    expect((await telefon.call('/api/auth/me')).status).toBe(401)
    expect((await c.call('/api/auth/me')).status).toBe(200)
  })
})

describe('token pro Zkratku', () => {
  it('vydá se jednou a pak už jen jako otisk', async () => {
    const { c } = await register('ja@example.com')
    const { token } = await c.json('/api/tokens', { body: { label: 'Zkratka' } })
    expect(token).toBeTruthy()

    const list = await c.json('/api/tokens')
    expect(JSON.stringify(list)).not.toContain(token)
  })

  it('tokenem jde nahrát kroky bez cookie', async () => {
    const { c } = await register('ja@example.com')
    const { token } = await c.json('/api/tokens', { body: {} })

    const res = await client().call('/api/ingest/steps', {
      body: { date: '2026-08-17', steps: 8_123 },
      token,
      anonymous: true,
    })
    expect(res.status).toBe(200)

    const steps = await c.json('/api/steps')
    expect(steps.steps[0].steps).toBe(8_123)
  })

  it('zrušený token přestane fungovat', async () => {
    const { c } = await register('ja@example.com')
    const { token } = await c.json('/api/tokens', { body: {} })
    const list = await c.json('/api/tokens')
    await c.json('/api/tokens/revoke', { body: { id: list.tokens[0].id } })

    const res = await client().call('/api/ingest/steps', {
      body: { date: '2026-08-17', steps: 1 },
      token,
      anonymous: true,
    })
    expect(res.status).toBe(401)
  })
})

describe('data', () => {
  it('synchronizace uloží a vrátí záznamy', async () => {
    const { c } = await register('ja@example.com')
    const push = await c.json('/api/state', {
      body: {
        records: [
          { kind: 'day', id: '2026-08-17', updatedAt: '2026-08-17T10:00:00.000Z', payload: { steps: 5_000 } },
        ],
      },
    })
    expect(push.applied).toBe(1)

    const pull = await c.json('/api/state?since=0')
    expect(pull.records[0].payload).toEqual({ steps: 5_000 })
  })

  it('snímek a rozvrh se uloží k účtu', async () => {
    const { c } = await register('ja@example.com')
    await c.json('/api/sync', {
      body: {
        snapshot: { date: '2026-08-17', steps: 3_000 },
        // Nesmysly v rozvrhu server srovná, ne odmítne – appka jede dál.
        schedule: { tone: 'drsny', activeSlots: [9, 1, 1, -2, 'x'] },
      },
    })

    await c.json('/api/ingest/steps', { body: { date: '2026-08-17', steps: 6_000 } })
    const again = await c.json('/api/sync', { body: { snapshot: { date: '2026-08-17', steps: 6_000 } } })
    expect(again.serverSteps.steps).toBe(6_000)
  })

  it('verze stavu jde vrátit', async () => {
    const { c } = await register('ja@example.com')
    await c.json('/api/state', {
      body: { records: [{ kind: 'day', id: 'a', updatedAt: '2026-08-17T10:00:00.000Z', payload: { steps: 1 } }] },
    })
    const { versions } = await c.json('/api/state/versions')
    await c.json('/api/state', {
      body: { records: [{ kind: 'day', id: 'a', updatedAt: '2026-08-18T10:00:00.000Z', payload: { steps: 2 } }] },
    })

    await c.json('/api/state/restore', { body: { rev: versions[0].rev } })
    const pull = await c.json('/api/state')
    expect(pull.records[0].payload).toEqual({ steps: 1 })
  })

  it('rozbité JSON je 400, ne 500', async () => {
    const { c } = await register('ja@example.com')
    expect((await c.call('/api/state', { body: '{tohle není JSON' })).status).toBe(400)
  })
})

describe('passkeys přes HTTP', () => {
  it('výzvu k přidání klíče nedostane nepřihlášený', async () => {
    await register('ja@example.com')
    const res = await client().call('/api/auth/passkey/register/options', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('doména klíče se vezme z adresy požadavku, ne z konfigurace', async () => {
    const { c } = await register('ja@example.com')
    const data = await c.json('/api/auth/passkey/register/options', { method: 'POST' })

    // Testovací server běží na 127.0.0.1, takže tam musí být přesně to.
    expect(data.options.rp.id).toBe('127.0.0.1')
    expect(data.options.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(data.challengeId).toBeTruthy()
  })

  it('výzvu k přihlášení dostane i nepřihlášený, ale nic se z ní nedozví', async () => {
    await register('ja@example.com')
    const data = await client().json('/api/auth/passkey/login/options', { method: 'POST' })

    expect(data.challengeId).toBeTruthy()
    // Žádný seznam klíčů – jinak by šlo zjistit, kdo tu má účet.
    expect(data.options.allowCredentials ?? []).toHaveLength(0)
    expect(JSON.stringify(data)).not.toContain('ja@example.com')
  })

  it('nesmysl místo odpovědi z prohlížeče je 400, ne pád serveru', async () => {
    const { c } = await register('ja@example.com')
    const res = await c.call('/api/auth/passkey/register/verify', { body: { challengeId: 'nic' } })
    expect(res.status).toBe(400)
  })

  it('vymyšlené přihlášení klíčem je 401 a neodhlásí přihlášeného', async () => {
    const { c } = await register('ja@example.com')
    const { challengeId } = await c.json('/api/auth/passkey/login/options', { method: 'POST' })

    const res = await c.call('/api/auth/passkey/login/verify', {
      body: { challengeId, response: { id: 'neexistuje', response: {} } },
    })
    expect(res.status).toBe(401)
    // Cookie musí zůstat – neúspěšný pokus o klíč není vypršelé sezení.
    expect((await c.call('/api/auth/me')).status).toBe(200)
  })

  it('odpověď, která není odpověď, je 401 a ne pád serveru', async () => {
    await register('ja@example.com')
    const c = client()
    const { challengeId } = await c.json('/api/auth/passkey/login/options', { method: 'POST' })

    const res = await c.call('/api/auth/passkey/login/verify', { body: { challengeId, response: 'nesmysl' } })
    expect(res.status).toBe(401)
    expect((await client().json('/api/health')).ok).toBe(true)
  })

  it('/api/auth/me hlásí, kolik klíčů účet má', async () => {
    const { c } = await register('ja@example.com')
    expect((await c.json('/api/auth/me')).passkeys).toBe(0)
    expect((await c.json('/api/auth/passkeys')).passkeys).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/*  To hlavní: účty si do sebe nevidí                                  */
/* ------------------------------------------------------------------ */

describe('oddělení účtů', () => {
  async function dvaUcty() {
    const { c: ja } = await register('ja@example.com')
    const { code } = await ja.json('/api/auth/invite', { body: {} })
    const { c: nekdo } = await register('nekdo@example.com', code)
    return { ja, nekdo }
  }

  it('cizí data nejsou vidět v synchronizaci', async () => {
    const { ja, nekdo } = await dvaUcty()
    await ja.json('/api/state', {
      body: { records: [{ kind: 'day', id: 'a', updatedAt: '2026-08-17T10:00:00.000Z', payload: { steps: 5_000 } }] },
    })

    const pull = await nekdo.json('/api/state?since=0')
    expect(pull.records).toEqual([])
    expect(pull.rev).toBe(0)
  })

  it('cizí kroky nejsou vidět', async () => {
    const { ja, nekdo } = await dvaUcty()
    await ja.json('/api/ingest/steps', { body: { date: '2026-08-17', steps: 8_123 } })
    expect((await nekdo.json('/api/steps')).steps).toEqual([])
  })

  it('cizí zařízení nejsou vidět a nejdou odhlásit', async () => {
    const { ja, nekdo } = await dvaUcty()
    const sub = { endpoint: 'https://push.example/ja', keys: { p256dh: 'a', auth: 'b' } }
    await ja.json('/api/subscribe', { body: { subscription: sub, label: 'iPhone' } })

    expect((await nekdo.json('/api/subscriptions')).subscriptions).toEqual([])
    expect((await nekdo.json('/api/unsubscribe', { body: { endpoint: sub.endpoint } })).removed).toBe(false)
    expect((await ja.json('/api/subscriptions')).subscriptions).toHaveLength(1)
  })

  it('cizí verzi stavu nejde obnovit', async () => {
    const { ja, nekdo } = await dvaUcty()
    await ja.json('/api/state', {
      body: { records: [{ kind: 'day', id: 'a', updatedAt: '2026-08-17T10:00:00.000Z', payload: { steps: 1 } }] },
    })
    const { versions } = await ja.json('/api/state/versions')

    const res = await nekdo.call('/api/state/restore', { body: { rev: versions[0].rev } })
    expect(res.status).toBe(404)
  })

  it('cizí log není vidět', async () => {
    const { ja, nekdo } = await dvaUcty()
    await ja.json('/api/ingest/steps', { body: { date: '2026-08-17', steps: 8_123 } })

    const log = await nekdo.json('/api/log')
    expect(JSON.stringify(log)).not.toContain('8123')
  })

  it('token jednoho účtu nepustí do dat druhého', async () => {
    const { ja, nekdo } = await dvaUcty()
    const { token } = await nekdo.json('/api/tokens', { body: {} })

    await client().call('/api/ingest/steps', { body: { date: '2026-08-17', steps: 4_321 }, token, anonymous: true })

    expect((await ja.json('/api/steps')).steps).toEqual([])
    expect((await nekdo.json('/api/steps')).steps[0].steps).toBe(4_321)
  })
})
