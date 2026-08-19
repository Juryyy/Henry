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

/** Odchytí volání serveru. `records` se vrátí jako „data z druhého zařízení". */
async function fakeServer(
  page: import('@playwright/test').Page,
  records: SyncRecord[] = [],
  steps: { date: string; steps: number; source: string; updatedAt: string }[] = [],
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
    if (url.includes('/api/steps')) return json({ steps })
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

  test('v odesílaných datech nejsou žádné přihlašovací údaje', async ({ page, context }) => {
    await seed(context)
    const server = await fakeServer(page)
    await page.goto('/#/nastaveni')
    await ready(page)
    await page.getByRole('button', { name: 'Synchronizovat' }).click()
    await expect.poll(() => server.pushed.length, { timeout: 10_000 }).toBeGreaterThan(0)

    const dump = JSON.stringify(server.pushed)
    for (const secret of ['password', 'token', 'session', 'cookie']) {
      expect(dump.toLowerCase()).not.toContain(secret)
    }
    // Nastavení jde po sekcích – a mezi nimi žádná, která by nesla přihlášení.
    const sections = server.pushed.filter((r) => r.kind === 'settings').map((r) => r.id).sort()
    expect(sections).toEqual(['exercise', 'notifications', 'profile', 'steps'])
  })

  test('kroky ze serveru nesmí přepsat odcvičený blok', async ({ page, context }) => {
    // Tohle byla ztráta dat, ne kosmetika. Kroky se stahovaly DŘÍV, než se
    // vyměnily záznamy. Stažené kroky si přitom založily místní den – a ten
    // `ensureDay` zakládá s prázdným polem bloků – orazítkovaly ho časem
    // „teď" a při odeslání ten prázdný den přepsal serverovou verzi
    // s odcvičeným ranním blokem. Den se totiž posílá jako celek.
    const today = dayKey(0)
    await seed(context)

    // Server: ranní odcvičený blok a k tomu kroky za dnešek.
    const morning = `${today}T07:30:00.000Z`
    const { pushed } = await fakeServer(
      page,
      [
        {
          kind: 'day',
          id: today,
          updatedAt: morning,
          payload: {
            date: today,
            steps: 0,
            stepsSource: 'manual',
            blocks: [
              {
                slot: 0,
                planId: 'rano',
                completedAt: morning,
                doneExerciseIds: ['prkno-na-predlokti'],
                skippedExerciseIds: [],
              },
            ],
          },
        },
      ],
      [{ date: today, steps: 6_200, source: 'shortcut', updatedAt: `${today}T06:00:00.000Z` }],
    )

    await page.goto('/#/')
    await ready(page)
    await page.waitForTimeout(600)

    // Blok musí přežít u sebe…
    const state = await readState(page)
    const block = state.days[today]?.blocks?.find((b: { slot: number }) => b.slot === 0)
    expect(block?.completedAt, 'ranní blok se ztratil v místním stavu').toBeTruthy()
    expect(state.days[today].steps).toBe(6_200)

    // …a hlavně se nesmí odeslat verze dne, ve které chybí.
    const bad = pushed.filter(
      (r) =>
        r.kind === 'day' &&
        r.id === today &&
        !(r.payload as { blocks?: { completedAt?: string }[] })?.blocks?.some((b) => b.completedAt),
    )
    expect(bad, 'appka poslala na server den bez odcvičeného bloku').toEqual([])
  })
})
