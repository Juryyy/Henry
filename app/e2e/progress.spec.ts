import { expect, test } from '@playwright/test'
import { dayKey, readState, ready, seed, weekKey } from './helpers'

test.describe('týdenní úkoly', () => {
  test('odškrtnutí úkolu ho odebere ze seznamu na dnešku', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/')
    await ready(page)

    await expect(page.getByRole('button', { name: 'Splnit Posilovna' })).toBeVisible()
    await page.getByRole('button', { name: 'Splnit Posilovna' }).click()

    await expect(page.getByRole('button', { name: 'Splnit Posilovna' })).toHaveCount(0)

    const state = await readState(page)
    expect(state.weeklyTaskLogs[`${weekKey(0)}|gym`].dates).toContain(dayKey(0))
  })
})

test.describe('den odpočinku a poznámka', () => {
  test('volno se uloží a promítne do hlavičky', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/')
    await ready(page)

    await page.getByRole('switch', { name: 'Označit dnešek jako den odpočinku' }).click()
    await expect(page.getByText('Dnes je volno')).toBeVisible()

    const state = await readState(page)
    expect(state.days[dayKey(0)].restDay).toBe(true)
  })

  test('poznámka se uloží a zobrazí', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/')
    await ready(page)

    await page.getByRole('button', { name: /Přidat poznámku/ }).click()
    await page.getByPlaceholder(/Co se dnes povedlo/).fill('Bolelo koleno, vynechal jsem dřepy.')
    await page.getByRole('button', { name: 'Uložit poznámku' }).click()

    await expect(page.getByText('Bolelo koleno, vynechal jsem dřepy.')).toBeVisible()
    const state = await readState(page)
    expect(state.days[dayKey(0)].note).toContain('koleno')
  })
})

test.describe('pokrok', () => {
  test('nové měření se uloží a objeví v grafu i v historii', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/pokrok')
    await ready(page)

    await page.getByRole('button', { name: 'Změřit se' }).click()
    await page.getByLabel('Váha (kg)').fill('92,4')
    await page.getByLabel(/Předklon/).fill('15')
    await page.getByRole('button', { name: 'Uložit měření' }).click()

    const state = await readState(page)
    expect(state.measurements).toHaveLength(1)
    expect(state.measurements[0].weightKg).toBe(92.4)
    expect(state.measurements[0].toeTouchCm).toBe(15)

    await expect(page.getByText('Poslední měření: 15 cm nad zemí')).toBeVisible()
  })

  test('druhé měření téhož dne nepřepíše dřívější hodnoty', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/pokrok')
    await ready(page)

    await page.getByRole('button', { name: 'Změřit se' }).click()
    await page.getByLabel('Váha (kg)').fill('92')
    await page.getByRole('button', { name: 'Uložit měření' }).click()

    await page.getByRole('button', { name: 'Změřit se' }).click()
    await page.getByLabel(/Prkno/).fill('40')
    await page.getByRole('button', { name: 'Uložit měření' }).click()

    const state = await readState(page)
    expect(state.measurements).toHaveLength(1)
    expect(state.measurements[0].weightKg).toBe(92)
    expect(state.measurements[0].plankSec).toBe(40)
  })

  test('prázdný formulář nic nezaloží', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/pokrok')
    await ready(page)

    await page.getByRole('button', { name: 'Změřit se' }).click()
    await page.getByRole('button', { name: 'Uložit měření' }).click()

    const state = await readState(page)
    expect(state.measurements).toHaveLength(0)
  })

  test('milník se odemkne a oznámí', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/pokrok')
    await ready(page)

    await page.getByRole('button', { name: 'Změřit se' }).click()
    await page.getByLabel(/Prkno/).fill('75')
    await page.getByRole('button', { name: 'Uložit měření' }).click()

    await expect(page.locator('.toast')).toContainText('Minuta v prkně')
    const state = await readState(page)
    expect(state.achievements['plank-60']).toBeTruthy()

    // Oslava zmizí sama – odemčený milník zůstává v seznamu s fajfkou,
    // takže není důvod nechat ji viset přes obsah.
    await expect(page.locator('.toast')).toBeHidden({ timeout: 12_000 })
    await expect(page.getByText('Minuta v prkně')).toBeVisible()
  })
})

test.describe('série', () => {
  test('jeden vynechaný den sérii neshodí', async ({ page, context }) => {
    // Tři splněné dny, mezi nimi jeden propadlý – s jedním dnem milosti
    // musí série držet.
    await seed(context, {
      weeklyTarget: 35_000,
      startDate: dayKey(10),
      days: {
        [dayKey(3)]: { steps: 9000, blocks: [0, 1, 2] },
        [dayKey(2)]: { steps: 300 },
        [dayKey(1)]: { steps: 9000, blocks: [0, 1, 2] },
        [dayKey(0)]: { steps: 9000, blocks: [0, 1, 2] },
      },
    })
    await page.goto('/#/tyden')
    await ready(page)

    await expect(page.getByText('záchran v záloze')).toBeVisible()
    const streak = await page.locator('.big-number').first().innerText()
    expect(Number(streak)).toBe(3)
  })
})
