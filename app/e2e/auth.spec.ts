import { expect, test } from '@playwright/test'
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
    await expect(page.getByRole('button', { name: 'Přihlásit se' })).toBeVisible()
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
    await page.getByRole('button', { name: 'Přihlásit se' }).click()

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
    await page.getByRole('button', { name: 'Přihlásit se' }).click()

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
