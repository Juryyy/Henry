import { expect, test } from '@playwright/test'
import { dayKey, readState, ready, seed } from './helpers'

/**
 * Synchronizace mezi zařízeními.
 *
 * Server tu nahrazuje odchycený požadavek – zajímá nás klientská půlka:
 * co appka pošle, co si z odpovědi vezme a jestli se cizí data opravdu
 * objeví na obrazovce.
 */
interface SyncRecord {
  kind: string
  id: string
  updatedAt: string
  deleted?: boolean
  payload?: unknown
  rev?: number
}

const SERVER = { baseUrl: 'https://henry.test', token: 'testovaci-token' }

/** Odchytí volání serveru. `records` se vrátí jako „data z druhého zařízení". */
async function fakeServer(
  page: import('@playwright/test').Page,
  records: SyncRecord[] = [],
): Promise<{ pushed: SyncRecord[] }> {
  const pushed: SyncRecord[] = []

  await page.route('**/api/**', async (route) => {
    const url = route.request().url()
    const json = (body: unknown): Promise<void> =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

    if (url.includes('/api/state')) {
      const body = route.request().postDataJSON() as { records?: SyncRecord[] } | null
      pushed.push(...(body?.records ?? []))
      return json({ rev: 42, applied: body?.records?.length ?? 0, skipped: 0, records })
    }
    if (url.includes('/api/steps')) return json({ steps: [] })
    if (url.includes('/api/sync')) return json({ ok: true, serverSteps: null })
    return json({ ok: true })
  })

  return { pushed }
}

test.describe('synchronizace', () => {
  test('data z druhého zařízení se objeví na tomhle', async ({ page, context }) => {
    const vcera = dayKey(1)
    await seed(context)
    // Server se musí nastavit až po seedu – helper ho nezná.
    await page.addInitScript(
      ([key, server]) => {
        const raw = localStorage.getItem(key as string)
        if (!raw) return
        const state = JSON.parse(raw as string)
        state.settings.server = server
        localStorage.setItem(key as string, JSON.stringify(state))
      },
      ['henry.state.v1', SERVER] as const,
    )

    await fakeServer(page, [
      {
        kind: 'day',
        id: vcera,
        updatedAt: new Date().toISOString(),
        rev: 41,
        payload: { date: vcera, steps: 8_765, stepsSource: 'manual', blocks: [] },
      },
    ])

    await page.goto('/#/kroky')
    await ready(page)

    await expect.poll(async () => (await readState(page)).days[vcera]?.steps, { timeout: 10_000 }).toBe(8_765)
    // A hlavně: musí to být vidět, ne jen ležet v úložišti.
    await expect(page.getByText(/8\s765/).first()).toBeVisible()
  })

  test('místní změna se pošle na server', async ({ page, context }) => {
    await seed(context)
    await page.addInitScript(
      ([key, server]) => {
        const raw = localStorage.getItem(key as string)
        if (!raw) return
        const state = JSON.parse(raw as string)
        state.settings.server = server
        localStorage.setItem(key as string, JSON.stringify(state))
      },
      ['henry.state.v1', SERVER] as const,
    )

    const server = await fakeServer(page)

    await page.goto('/#/')
    await ready(page)
    await page.getByLabel('Zapsat kroky').fill('6543')
    await page.locator('.quick-row button').click()
    await expect.poll(async () => (await readState(page)).days[dayKey(0)]?.steps).toBe(6_543)

    // Synchronizace se pouští z nastavení tlačítkem.
    await page.goto('/#/nastaveni')
    await ready(page)
    await page.getByRole('button', { name: 'Synchronizovat' }).click()

    await expect
      .poll(() => server.pushed.some((r) => r.kind === 'day' && r.id === dayKey(0)), { timeout: 10_000 })
      .toBe(true)

    const den = server.pushed.find((r) => r.kind === 'day' && r.id === dayKey(0))!
    expect((den.payload as { steps: number }).steps).toBe(6_543)
  })

  test('token ani adresa serveru se v datech nikam neposílají', async ({ page, context }) => {
    await seed(context)
    await page.addInitScript(
      ([key, server]) => {
        const raw = localStorage.getItem(key as string)
        if (!raw) return
        const state = JSON.parse(raw as string)
        state.settings.server = server
        localStorage.setItem(key as string, JSON.stringify(state))
      },
      ['henry.state.v1', SERVER] as const,
    )

    const server = await fakeServer(page)
    await page.goto('/#/nastaveni')
    await ready(page)
    await page.getByRole('button', { name: 'Synchronizovat' }).click()
    await expect.poll(() => server.pushed.length, { timeout: 10_000 }).toBeGreaterThan(0)

    expect(JSON.stringify(server.pushed)).not.toContain(SERVER.token)
    expect(JSON.stringify(server.pushed)).not.toContain('henry.test')
  })
})
