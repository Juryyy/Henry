import { expect, test, type BrowserContext } from '@playwright/test'
import { ready, seed, stubServer } from './helpers'

/**
 * Přihlašovací brána.
 *
 * Server je tu odchycený – zajímá nás klientská půlka: že se nepřihlášený
 * uživatel do appky nedostane, že se po přihlášení dostane, a že se první
 * účet zakládá bez pozvánky.
 */
const USER = { id: 'u1', email: 'ja@example.com', name: 'Martin', createdAt: '' }

test.describe('přihlášení', () => {
  test('bez přihlášení se appka neukáže', async ({ page, context }) => {
    await seed(context)
    await stubServer(context, false)

    await page.goto('/#/')
    await expect(page.getByRole('button', { name: 'Přihlásit se', exact: true })).toBeVisible()
    // Nic z appky nesmí prosvítat.
    await expect(page.getByRole('link', { name: 'Dnes' })).toHaveCount(0)
  })

  test('po přihlášení se appka objeví', async ({ page, context }) => {
    await seed(context)
    await stubServer(context, false)

    let signedIn = false
    await context.route('**/api/auth/**', async (route) => {
      const url = route.request().url()
      const json = (body: unknown, status = 200): Promise<void> =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

      if (url.includes('/api/auth/login')) {
        signedIn = true
        return json({ user: USER })
      }
      if (url.includes('/api/auth/me')) {
        return signedIn ? json({ user: USER, subscriptions: 0 }) : json({ error: 'Nepřihlášeno.' }, 401)
      }
      return json({ sessions: [], tokens: [] })
    })

    await page.goto('/#/')
    await page.getByPlaceholder('E-mail').fill('ja@example.com')
    await page.getByPlaceholder('Heslo').fill('dost-dlouhe-heslo')
    await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click()

    await ready(page)
    await expect(page.getByRole('link', { name: 'Dnes' })).toBeVisible()
  })

  test('chybu ze serveru appka ukáže, ne spolkne', async ({ page, context }) => {
    await seed(context)
    await stubServer(context, false)
    await context.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Nesedí e-mail nebo heslo.' }) }),
    )

    await page.goto('/#/')
    await page.getByPlaceholder('E-mail').fill('ja@example.com')
    await page.getByPlaceholder('Heslo').fill('spatne-heslo')
    await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click()

    await expect(page.getByText('Nesedí e-mail nebo heslo.')).toBeVisible()
  })

  test('na čerstvém serveru se rovnou zakládá první účet', async ({ page, context }) => {
    await seed(context)
    await context.route('**/api/**', async (route) => {
      const url = route.request().url()
      const json = (body: unknown, status = 200): Promise<void> =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

      if (url.includes('/api/auth/me')) return json({ error: 'Nepřihlášeno.' }, 401)
      if (url.includes('/api/health')) {
        return json({ ok: true, now: { date: '', minutes: 0, weekday: 0 }, scheduler: true, registrationOpen: true })
      }
      return json({ ok: true })
    })

    await page.goto('/#/')
    await expect(page.getByRole('button', { name: 'Založit účet' })).toBeVisible()
    // Bez pozvánky – ta je až pro další lidi.
    await expect(page.getByPlaceholder('Kód pozvánky')).toHaveCount(0)
  })

  test('nedostupný server to řekne, místo aby mlčel', async ({ page, context }) => {
    await seed(context)
    await context.route('**/api/**', (route) => route.abort('failed'))

    await page.goto('/#/')
    await expect(page.getByText('Server neodpovídá.')).toBeVisible()
  })
})

/* ------------------------------------------------------------------ */
/*  Face ID                                                            */
/* ------------------------------------------------------------------ */

/**
 * Skutečný authenticator v prohlížeči nahradí falešný – testuje se zapojení
 * appky, ne kryptografie (tu prověřují testy serveru). Ceremonie nabídnutá
 * v poli pro e-mail (`mediation: 'conditional'`) se schválně nikdy nedokončí:
 * přesně tak se chová prohlížeč, dokud si člověk klíč sám nevybere.
 */
async function fakeAuthenticator(context: BrowserContext, outcome: 'ok' | 'cancel'): Promise<void> {
  await context.addInitScript((mode: string) => {
    const buffer = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer
    navigator.credentials.get = (options?: CredentialRequestOptions): Promise<Credential | null> => {
      if ((options as { mediation?: string })?.mediation === 'conditional') return new Promise(() => {})
      if (mode === 'cancel') {
        const err = new Error('The operation either timed out or was not allowed.')
        err.name = 'NotAllowedError'
        return Promise.reject(err)
      }
      return Promise.resolve({
        id: 'a2xpYw',
        rawId: buffer('klic'),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        response: {
          clientDataJSON: buffer('{}'),
          authenticatorData: buffer('auth'),
          signature: buffer('podpis'),
          userHandle: null,
        },
        getClientExtensionResults: () => ({}),
      } as unknown as Credential)
    }
  }, outcome)
}

test.describe('přihlášení přes Face ID', () => {
  test('tlačítko je vidět a heslo zůstává jako druhá cesta', async ({ page, context }) => {
    await seed(context)
    await stubServer(context, false)

    await page.goto('/#/')
    await expect(page.getByRole('button', { name: 'Přihlásit se přes Face ID' })).toBeVisible()
    await expect(page.getByPlaceholder('Heslo')).toBeVisible()
  })

  test('klíčem se dá přihlásit bez psaní e-mailu', async ({ page, context }) => {
    await seed(context)
    await stubServer(context, false)
    await fakeAuthenticator(context, 'ok')

    let signedIn = false
    await context.route('**/api/auth/**', async (route) => {
      const url = route.request().url()
      const json = (body: unknown, status = 200): Promise<void> =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

      if (url.includes('/api/auth/passkey/login/options')) {
        return json({ options: { challenge: 'dGVzdA', rpId: 'localhost', allowCredentials: [] }, challengeId: 'v1' })
      }
      if (url.includes('/api/auth/passkey/login/verify')) {
        signedIn = true
        return json({ user: USER })
      }
      if (url.includes('/api/auth/me')) {
        return signedIn ? json({ user: USER, subscriptions: 0, passkeys: 1 }) : json({ error: 'Nepřihlášeno.' }, 401)
      }
      return json({ sessions: [], tokens: [], passkeys: [] })
    })

    await page.goto('/#/')
    await page.getByRole('button', { name: 'Přihlásit se přes Face ID' }).click()

    await ready(page)
    await expect(page.getByRole('link', { name: 'Dnes' })).toBeVisible()
  })

  test('zavřené okno s Face ID není chyba', async ({ page, context }) => {
    await seed(context)
    await stubServer(context, false)
    await fakeAuthenticator(context, 'cancel')

    await page.goto('/#/')
    await page.getByRole('button', { name: 'Přihlásit se přes Face ID' }).click()

    // Tlačítko se vrátí do klidu a nikde nesvítí červená hláška.
    await expect(page.getByRole('button', { name: 'Přihlásit se přes Face ID' })).toBeEnabled()
    await expect(page.locator('.c-danger')).toHaveCount(0)
  })

  test('klíč jde nastavit z nastavení a hned se objeví v seznamu', async ({ page, context }) => {
    await seed(context)
    await context.addInitScript(() => {
      navigator.credentials.create = (): Promise<Credential | null> => {
        const buffer = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer
        return Promise.resolve({
          id: 'a2xpYw',
          rawId: buffer('klic'),
          type: 'public-key',
          authenticatorAttachment: 'platform',
          response: {
            clientDataJSON: buffer('{}'),
            attestationObject: buffer('att'),
            getTransports: () => ['internal'],
          },
          getClientExtensionResults: () => ({}),
        } as unknown as Credential)
      }
    })

    let added = false
    await context.route('**/api/auth/passkey**', async (route) => {
      const url = route.request().url()
      const json = (body: unknown): Promise<void> =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

      if (url.includes('/register/options')) {
        return json({
          options: {
            challenge: 'dGVzdA',
            rp: { id: 'localhost', name: 'Henry' },
            user: { id: 'dTE', name: 'ja@example.com', displayName: 'Martin' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          },
          challengeId: 'v1',
        })
      }
      if (url.includes('/register/verify')) {
        added = true
        return json({ ok: true, passkey: { id: 'k1', label: 'iPhone', createdAt: '', lastUsedAt: null, backedUp: true } })
      }
      return json({
        passkeys: added ? [{ id: 'k1', label: 'iPhone', createdAt: '', lastUsedAt: null, backedUp: true }] : [],
      })
    })

    await page.goto('/#/nastaveni')
    await ready(page)
    await page.getByRole('button', { name: 'Nastavit na tomhle zařízení' }).click()

    await expect(page.getByText('Klíč je zálohovaný', { exact: false })).toBeVisible()
    await expect(page.getByText('Přihlášení přes Face ID (1)')).toBeVisible()
  })

  test('odmítnutý klíč to řekne a nevyhodí z přihlašovací obrazovky', async ({ page, context }) => {
    await seed(context)
    await stubServer(context, false)
    await fakeAuthenticator(context, 'ok')

    await page.goto('/#/')
    await page.getByRole('button', { name: 'Přihlásit se přes Face ID' }).click()

    await expect(page.getByText('Tenhle klíč tu není zaregistrovaný.')).toBeVisible()
    await expect(page.getByPlaceholder('Heslo')).toBeVisible()
  })
})
