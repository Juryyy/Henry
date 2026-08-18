import { expect, test } from '@playwright/test'
import { dayKey, readState, ready, seed } from './helpers'

test.describe('cvičení', () => {
  test('blok se dá projít celý a zapíše se jako hotový', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/cviceni/1')
    await page.waitForSelector('.dose-card')

    const total = Number((await page.locator('.bar + * , header .num').first().innerText()).split('/')[1])
    expect(total).toBeGreaterThan(3)

    // Projít všechny cviky přeskočením zbytku sérií – testujeme průchod,
    // ne trpělivost.
    for (let i = 0; i < total; i++) {
      const skipRest = page.getByRole('button', { name: 'Přeskočit zbytek sérií' })
      if (await skipRest.count()) await skipRest.click()
      else await page.getByRole('button', { name: /Hotovo|Spustit/ }).first().click()
      await page.waitForTimeout(120)
    }

    await expect(page.getByRole('heading', { name: 'Blok hotový' })).toBeVisible()
    await page.getByRole('button', { name: 'Zapsat a zavřít' }).click()
    await ready(page)

    await expect(page.getByText('1/3 hotovo')).toBeVisible()

    const state = await readState(page)
    const blocks = state.days[dayKey(0)].blocks.filter((b: any) => b.completedAt)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].slot).toBe(1)
  })

  test('odpočet u cviku na čas běží a pauza ho nevrátí na začátek', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/cviceni/0')
    await page.waitForSelector('.dose-card')

    // Ranní blok začíná rozhýbáním na opakování; posuň se na cvik na čas.
    for (let i = 0; i < 6; i++) {
      const timer = await page.locator('.timer').innerText()
      if (timer.includes(':')) break
      await page.getByRole('button', { name: 'Přeskočit zbytek sérií' }).click()
      await page.waitForTimeout(120)
    }

    await page.getByRole('button', { name: 'Spustit' }).click()
    await page.waitForTimeout(2200)

    const running = await page.locator('.timer').innerText()
    await page.getByRole('button', { name: 'Pauza' }).click()
    const paused = await page.locator('.timer').innerText()
    expect(paused).toBe(running)

    // Pokračování musí navázat, ne začít znovu.
    await page.getByRole('button', { name: 'Pokračovat' }).click()
    await page.waitForTimeout(1200)
    const after = await page.locator('.timer').innerText()
    expect(toSeconds(after)).toBeLessThan(toSeconds(paused))
  })

  test('blok jde odškrtnout i bez přehrávače', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/cviceni')
    await ready(page)

    await page.getByRole('button', { name: 'Označit blok Ráno jako hotový' }).click()
    await expect.poll(async () => {
      const state = await readState(page)
      return state.days[dayKey(0)].blocks.filter((b: any) => b.completedAt).length
    }).toBe(1)

    // A odškrtnutí se dá vzít zpět.
    await page.getByRole('button', { name: 'Označit blok Ráno jako hotový' }).click()
    await expect.poll(async () => {
      const state = await readState(page)
      return state.days[dayKey(0)].blocks.filter((b: any) => b.completedAt).length
    }).toBe(0)
  })

  test('u cviku je vidět ukázka provedení', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/cviky/kocka-velbloud')
    await ready(page)

    // Obrázek je SVG s popisem pro čtečku – ne dekorace, ale obsah.
    const demo = page.getByRole('img', { name: /Vzpor klečmo/ })
    await expect(demo).toBeVisible()

    // V seznamu je u každého cviku náhled, ale bez animace.
    await page.goto('/#/cviky')
    await ready(page)
    expect(await page.locator('.thumb svg').count()).toBeGreaterThan(10)
  })

  test('vyřazený cvik zmizí z plánu', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/cviky/supine-hamstring-strap')
    await ready(page)

    await page.getByRole('button', { name: 'Vyřadit z plánu' }).click()
    await expect(page.getByRole('button', { name: 'Vrátit zpátky do plánu' })).toBeVisible()

    await page.goto('/#/cviceni')
    await ready(page)
    await expect(page.getByRole('link', { name: /Protažení hamstringů vleže/ })).toHaveCount(0)
  })

  test('na vypnutý blok se nedá vejít adresou', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/nastaveni')
    await ready(page)
    await page.getByRole('checkbox', { name: /Ráno/ }).uncheck()

    // Typicky sem vede stará notifikace z doby, kdy blok ještě běžel.
    await page.goto('/#/cviceni/0')
    await ready(page)
    await expect(page).toHaveURL(/#\/cviceni$/)
  })

  test('vypnuté bloky se propíšou do plánu dne', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/nastaveni')
    await ready(page)

    await page.getByRole('checkbox', { name: /Poledne/ }).uncheck()
    await page.getByRole('checkbox', { name: /Večer/ }).uncheck()
    await expect
      .poll(async () => (await readState(page)).settings.exercise.blocks.filter((b: any) => b.enabled).length)
      .toBe(1)

    await page.goto('/#/')
    await ready(page)
    await expect(page.getByText('0/1 hotovo')).toBeVisible()
  })
})

function toSeconds(label: string): number {
  const parts = label.split(':').map(Number)
  return parts.length === 2 ? parts[0]! * 60 + parts[1]! : parts[0]!
}
