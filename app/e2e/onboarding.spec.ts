import { expect, test } from '@playwright/test'
import { readState, ready, seed } from './helpers'

test.describe('úvodní průvodce', () => {
  test('při prvním spuštění nepustí dál a projde se celý', async ({ page, context }) => {
    await seed(context, { onboarded: false })
    await page.goto('/#/')

    // Bez dokončeného průvodce se z appky nedá nikam odejít.
    await expect(page).toHaveURL(/#\/start/)
    await expect(page.getByRole('heading', { name: 'Ahoj, já jsem Henry.' })).toBeVisible()

    await page.goto('/#/kroky')
    await expect(page).toHaveURL(/#\/start/)

    await page.getByRole('button', { name: 'Jdeme na to' }).click()

    // 1 – jméno
    await page.getByPlaceholder('Třeba Martine').fill('Martin')
    await page.getByRole('button', { name: 'Dál' }).click()

    // 2 – kroky: posuvník nastaví výchozí cíl
    await expect(page.locator('.picker')).toBeVisible()
    await page.locator('input[type="range"]').fill('5000')
    await expect(page.getByText(/První cíl: 38\s500 kroků týdně/)).toBeVisible()
    await page.getByRole('button', { name: 'Dál' }).click()

    // 3 – úroveň
    await page.getByRole('button', { name: /Něco už umím/ }).click()
    await page.getByRole('button', { name: 'Dál' }).click()

    // 4 – bloky
    await page.getByRole('button', { name: '2× denně' }).click()
    await expect(page.getByText('Při 2 blocích to je 30 minut denně.')).toBeVisible()
    await page.getByRole('button', { name: 'Dál' }).click()

    // 5 – časy: nabídnou se jen tolik políček, kolik je bloků
    await expect(page.locator('input[type="time"]')).toHaveCount(2)
    await page.getByRole('button', { name: 'Dál' }).click()

    // 6 – míra
    await page.getByLabel('Chybí mi na zem (cm)').fill('17')
    await page.getByRole('button', { name: 'Dál' }).click()

    await page.getByRole('button', { name: 'Spustit Henryho' }).click()
    await ready(page)

    await expect(page.getByRole('heading', { name: /Martin/ })).toBeVisible()

    const state = await readState(page)
    expect(state.settings.onboardedAt).toBeTruthy()
    expect(state.settings.name).toBe('Martin')
    expect(state.settings.steps.weeklyTarget).toBe(38_500)
    expect(state.settings.exercise.level).toBe(2)
    // Průvodce zapne první dva bloky; třetí zůstane vypnutý, ale nezmizí –
    // pozice v dni drží zápisy odcvičení i odkazy z notifikací.
    expect(state.settings.exercise.blocks.map((b: any) => b.enabled)).toEqual([true, true, false])
    expect(state.measurements).toHaveLength(1)
    expect(state.measurements[0].toeTouchCm).toBe(17)

    // Dvě nastavená cvičení = dva bloky na hlavní obrazovce.
    await expect(page.getByText('0/2 hotovo')).toBeVisible()
  })

  test('přeskočení průvodce appku odemkne', async ({ page, context }) => {
    await seed(context, { onboarded: false })
    await page.goto('/#/')
    await page.getByRole('button', { name: 'Přeskočit' }).click()
    await ready(page)
    await expect(page).toHaveURL(/#\/$|127\.0\.0\.1:4173\/$/)
    await expect(page.getByRole('heading', { name: /Dobré ráno|Ahoj|Dobrý večer/ })).toBeVisible()
  })

  test('hotový průvodce se už znovu neukáže', async ({ page, context }) => {
    await seed(context, { onboarded: true })
    await page.goto('/#/')
    await ready(page)
    await expect(page).not.toHaveURL(/#\/start/)
  })

  test('do průvodce se nedá vrátit a přepsat si nastavení', async ({ page, context }) => {
    await seed(context, { onboarded: true, weeklyTarget: 42_000 })
    await page.goto('/#/start')
    await ready(page)

    await expect(page).not.toHaveURL(/#\/start/)
    expect((await readState(page)).settings.steps.weeklyTarget).toBe(42_000)
  })

  test('kdo už chodí hodně, nedostane nižší cíl, než na kolik je zvyklý', async ({ page, context }) => {
    await seed(context, { onboarded: false })
    await page.goto('/#/')
    await page.getByRole('button', { name: 'Jdeme na to' }).click()
    await page.getByRole('button', { name: 'Dál' }).click()

    await page.locator('input[type="range"]').fill('11000')
    // 11 000 × 7 × 1,1 = 84 700 → zaokrouhleno 84 500, ne zaseknuto na 49 000.
    await expect(page.locator('.callout')).toContainText(/84\s500/)
    await expect(page.locator('.callout')).toContainText('už splňuješ')

    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Dál' }).click()
    await page.getByRole('button', { name: 'Spustit Henryho' }).click()
    await ready(page)

    const state = await readState(page)
    expect(state.settings.steps.weeklyTarget).toBe(84_500)
    // Meta se musí posunout nahoru, jinak by se automatické zvyšování
    // rovnou vyplo na cíli, který je pod aktuálním.
    expect(state.settings.steps.goalWeeklyTarget).toBeGreaterThanOrEqual(84_500)
  })

  test('kdo průvodce prošel, už ho po přihlášení znovu nedostane', async ({ page, context }) => {
    // Čerstvý prohlížeč: místní kopie je prázdná, ale na serveru historie je.
    // Bez čekání na první synchronizaci by appka poslala dlouholetého
    // uživatele do průvodce – a ten by mu po dokončení přepsal cíl i začátek.
    const USER = { id: 'u1', email: 'ja@example.com', name: 'Martin', createdAt: '' }
    await context.route('**/api/**', async (route) => {
      const url = route.request().url()
      const json = (body: unknown, status = 200): Promise<void> =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

      if (url.includes('/api/auth/me')) return json({ user: USER, subscriptions: 0, passkeys: 0 })
      if (url.includes('/api/health')) {
        return json({ ok: true, now: { date: '', minutes: 0, weekday: 0 }, scheduler: true, registrationOpen: false })
      }
      if (url.includes('/api/state')) {
        // Server odpoví se zpožděním, jako skutečná síť.
        await new Promise((r) => setTimeout(r, 400))
        return json({
          rev: 7,
          applied: 0,
          skipped: 0,
          records: [
            {
              kind: 'settings',
              id: 'profile',
              updatedAt: '2026-01-01T00:00:00.000Z',
              payload: { name: 'Martin', startDate: '2026-01-01', onboardedAt: '2026-01-01T00:00:00.000Z' },
            },
          ],
        })
      }
      return json({ ok: true, steps: [], serverSteps: null })
    })

    await page.goto('/#/')
    await ready(page)

    // Musí být rovnou v appce, ne v průvodci.
    await expect(page.getByRole('link', { name: 'Dnes' })).toBeVisible()
    await expect(page.getByText('Kolik teď nachodíš denně?')).toHaveCount(0)
    expect(page.url()).not.toContain('/start')
  })
})
