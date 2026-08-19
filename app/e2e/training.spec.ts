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
    await page.getByRole('button', { name: 'Zpátky na dnešek' }).click()
    await ready(page)

    await expect(page.getByText('1/3 hotovo')).toBeVisible()

    const state = await readState(page)
    const blocks = state.days[dayKey(0)].blocks.filter((b: any) => b.completedAt)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].slot).toBe(1)
  })

  test('odcvičený blok se zapíše, i když ho člověk zavře křížkem', async ({ page, context }) => {
    // Kdo doklikal poslední cvik, odcvičil. Že to appka zapíše až po klepnutí
    // na „Zapsat a zavřít", ví jenom ona – uživatel zavře křížkem a ráno mu
    // pak chybí odcvičený blok. Přesně tohle se stalo.
    await seed(context)
    await page.goto('/#/cviceni/1')
    await page.waitForSelector('.dose-card')

    const total = Number((await page.locator('header .num').first().innerText()).split('/')[1])
    for (let i = 0; i < total; i++) {
      const skipRest = page.getByRole('button', { name: 'Přeskočit zbytek sérií' })
      if (await skipRest.count()) await skipRest.click()
      else await page.getByRole('button', { name: /Hotovo|Spustit/ }).first().click()
      await page.waitForTimeout(120)
    }
    await expect(page.getByRole('heading', { name: 'Blok hotový' })).toBeVisible()

    // Křížkem, ne závěrečným tlačítkem.
    await page.getByLabel('Zavřít').click()
    await ready(page)

    const state = await readState(page)
    const blocks = state.days[dayKey(0)].blocks.filter((b: any) => b.completedAt)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].slot).toBe(1)
  })

  test('kdo blok jen prolistuje a nic neodcvičí, hotovo nedostane', async ({ page, context }) => {
    // Protiváha k předchozímu testu: samo se to smí zapsat jen tehdy, když
    // se opravdu cvičilo. Jinak by stačilo blok proklikat a den je splněný.
    await seed(context)
    await page.goto('/#/cviceni/1')
    await page.waitForSelector('.dose-card')

    const total = Number((await page.locator('header .num').first().innerText()).split('/')[1])
    for (let i = 0; i < total; i++) {
      await page.getByRole('button', { name: 'Tenhle vynechat' }).click()
      await page.waitForTimeout(120)
    }
    await page.getByLabel('Zavřít').click()
    await ready(page)

    const state = await readState(page)
    const blocks = state.days[dayKey(0)]?.blocks?.filter((b: any) => b.completedAt) ?? []
    expect(blocks).toHaveLength(0)
  })

  test('odcvičený blok odletí na server hned, ne až při dalším spuštění', async ({ page, context }) => {
    // Tohle je druhá půlka téhož problému: i když se blok uloží do telefonu,
    // na notebooku ho nikdo neuvidí, dokud se appka na telefonu znovu
    // neotevře. Pushovalo se totiž jen při startu.
    await seed(context)

    const pushes: number[] = []
    await page.route('**/api/state', async (route) => {
      const body = route.request().postDataJSON() as { records?: unknown[] }
      pushes.push(body?.records?.length ?? 0)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rev: 1, applied: 0, skipped: 0, records: [] }),
      })
    })

    await page.goto('/#/cviceni/1')
    await page.waitForSelector('.dose-card')
    const before = pushes.length

    const total = Number((await page.locator('header .num').first().innerText()).split('/')[1])
    for (let i = 0; i < total; i++) {
      const skipRest = page.getByRole('button', { name: 'Přeskočit zbytek sérií' })
      if (await skipRest.count()) await skipRest.click()
      else await page.getByRole('button', { name: /Hotovo|Spustit/ }).first().click()
      await page.waitForTimeout(120)
    }
    await expect(page.getByRole('heading', { name: 'Blok hotový' })).toBeVisible()

    // Bez přechodu na jinou obrazovku a bez znovuotevření appky.
    await expect.poll(() => pushes.length, { timeout: 8000 }).toBeGreaterThan(before)
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

    // A odškrtnutí se dá vzít zpět – na dvě klepnutí, viz test níž.
    await page.getByRole('button', { name: 'Zrušit hotový blok Ráno' }).click()
    await page.getByRole('button', { name: 'Opravdu zrušit hotový blok Ráno?' }).click()
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

  test('u cviku je vidět, co zatěžuje', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/cviky/dumbbell-bench-press')
    await ready(page)

    // Mapa těla nese popis pro čtečku – barva na obrázku je informace navíc,
    // ne jediná cesta, jak se to dozvědět.
    await expect(page.getByRole('img', { name: /Zatěžuje hlavně: prsní svaly/ })).toBeVisible()
    // A totéž je pod obrázkem napsané.
    await expect(page.getByText(/Vedle toho: ramena, tricepsy/)).toBeVisible()
  })

  test('pípání jde v přehrávači vypnout a volba vydrží', async ({ page, context }) => {
    // Zvuk se v testu ověřit nedá, ale přepínač a jeho uložení ano – a to
    // je to, co uživatele štve, když nefunguje: vypne to a příště to řve zas.
    await seed(context)
    await page.goto('/#/cviceni/0')
    await ready(page)

    const off = page.getByRole('button', { name: 'Vypnout pípání' })
    await expect(off).toBeVisible()
    await off.click()
    await expect(page.getByRole('button', { name: 'Zapnout pípání' })).toBeVisible()

    await page.reload()
    await ready(page)
    await expect(page.getByRole('button', { name: 'Zapnout pípání' })).toBeVisible()
  })

  test('hotový blok nejde odznačit jedním chybným klepnutím', async ({ page, context }) => {
    // Kolečko sedí hned vedle názvu bloku a je to přepínač, ne ukazatel.
    // Jedno klepnutí vedle a odcvičený blok byl pryč i s dobou cvičení.
    await seed(context, { days: { [dayKey(0)]: { blocks: [0] } } })
    await page.goto('/#/cviceni')
    await ready(page)

    const check = page.getByRole('button', { name: /Zrušit hotový blok/ })
    await check.click()
    // První klepnutí se jen ptá – blok pořád platí.
    await expect(page.getByRole('button', { name: /Opravdu zrušit hotový blok/ })).toBeVisible()
    let state = await readState(page)
    expect(state.days[dayKey(0)].blocks[0].completedAt).toBeTruthy()

    // Druhé klepnutí to teprve provede.
    await page.getByRole('button', { name: /Opravdu zrušit hotový blok/ }).click()
    await page.waitForTimeout(400)
    state = await readState(page)
    expect(state.days[dayKey(0)].blocks[0].completedAt).toBeFalsy()
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
