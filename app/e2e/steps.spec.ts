import { expect, test } from '@playwright/test'
import { dayKey, neededToday, readState, ready, seed } from './helpers'

test.describe('kroky', () => {
  test('rychlé přidání se hned promítne do dnešní porce', async ({ page, context }) => {
    await seed(context, { weeklyTarget: 35_000 })
    await page.goto('/#/')
    await ready(page)

    const before = await neededToday(page)
    expect(before).toBeGreaterThan(0)

    await page.getByRole('button', { name: '+1 000' }).click()
    await expect
      .poll(() => neededToday(page))
      .toBe(before - 1000)

    // A ubývá to jedna ku jedné, ne po zlomcích.
    await page.getByRole('button', { name: '+500' }).click()
    await expect.poll(() => neededToday(page)).toBe(before - 1500)

    const state = await readState(page)
    expect(state.days[dayKey(0)].steps).toBe(1500)
  })

  test('zapsání konkrétní hodnoty přepíše součet', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/')
    await ready(page)

    await page.getByRole('button', { name: '+2 000' }).click()
    await page.getByLabel('Zapsat kroky').fill('6200')
    await page.locator('.quick-row button').click()

    // Zapsání je absolutní hodnota, ne přičtení.
    await expect.poll(async () => (await readState(page)).days[dayKey(0)]?.steps).toBe(6200)
  })

  test('historie: přepis dne uloží, prázdné pole den nevynuluje', async ({ page, context }) => {
    await seed(context, {
      days: { [dayKey(1)]: { steps: 7000 }, [dayKey(0)]: { steps: 3000 } },
    })
    await page.goto('/#/kroky')
    await ready(page)

    const yesterday = page.getByLabel(`Kroky ${dayKey(1)}`)
    await expect(yesterday).toHaveValue('7000')

    await yesterday.fill('8100')
    await yesterday.blur()
    await expect.poll(async () => (await readState(page)).days[dayKey(1)].steps).toBe(8100)

    // Vymazání pole nesmí den shodit na nulu – pole se vrátí k uložené hodnotě.
    await yesterday.fill('')
    await yesterday.blur()
    await expect(yesterday).toHaveValue('8100')
    expect((await readState(page)).days[dayKey(1)].steps).toBe(8100)
  })

  test('graf týdne označí splněné dny', async ({ page, context }) => {
    await seed(context, {
      weeklyTarget: 35_000,
      days: { [dayKey(0)]: { steps: 9000 } },
    })
    await page.goto('/#/kroky')
    await ready(page)

    // Sloupec nad cílovou čárou je zvýrazněný.
    await expect(page.locator('.bar.met')).toHaveCount(1)
  })

  test('data přežijí načtení znovu', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/')
    await ready(page)
    await page.getByRole('button', { name: '+2 000' }).click()
    await page.waitForTimeout(400)

    await page.reload()
    await ready(page)
    await expect(page.locator('.ring-value')).toHaveText('2 000')
    await expect.poll(async () => (await readState(page)).days[dayKey(0)]?.steps).toBe(2000)
  })
})

test.describe('dluh za kroky', () => {
  test('nesplněný minulý týden zvedne dnešní porci a ukáže upozornění', async ({ page, context }) => {
    // Minulý týden jen 5 000 z 35 000 → dluh 10 000 (strop 2 dny × 5 000).
    await seed(context, {
      weeklyTarget: 35_000,
      startDate: dayKey(21),
      days: { [dayKey(9)]: { steps: 5_000 } },
    })
    await page.goto('/#/')
    await ready(page)

    await expect(page.getByText(/Z minulého týdne visí/)).toBeVisible()

    await page.goto('/#/tyden')
    await ready(page)
    await expect(page.getByText('+ dluh z minula')).toBeVisible()
    // Základ 35 000 + dluh 10 000.
    await expect(page.getByText('45 000').first()).toBeVisible()
  })

  test('bankrot dluh smaže', async ({ page, context }) => {
    await seed(context, {
      weeklyTarget: 35_000,
      startDate: dayKey(21),
      days: { [dayKey(9)]: { steps: 5_000 } },
    })
    await page.goto('/#/tyden')
    await ready(page)

    await page.getByRole('button', { name: 'Vyhlásit bankrot' }).click()
    await page.getByRole('button', { name: 'Smazat dluh' }).click()

    await expect(page.getByText('Žádný dluh. Čistý stůl.')).toBeVisible()
    await page.goto('/#/')
    await ready(page)
    await expect(page.getByText(/Z minulého týdne visí/)).toHaveCount(0)
  })
})
