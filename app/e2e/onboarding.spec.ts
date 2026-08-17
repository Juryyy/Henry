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
    expect(state.settings.exercise.blocksPerDay).toBe(2)
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
})
