import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dayKey, readState, ready, seed } from './helpers'

test.describe('navigace a shell', () => {
  test('všechny záložky i nastavení jsou dostupné', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/')
    await ready(page)

    for (const [label, heading] of [
      ['Cvičení', 'Cvičení'],
      ['Kroky', 'Kroky'],
      ['Týden', null],
      ['Pokrok', 'Pokrok'],
      ['Dnes', null],
    ] as const) {
      await page.getByRole('link', { name: label, exact: true }).click()
      await page.waitForTimeout(250)
      if (heading) await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    }

    // Nastavení nemá vlastní záložku, musí být dosažitelné z hlavní obrazovky.
    await page.getByRole('link', { name: 'Nastavení' }).click()
    await expect(page.getByRole('heading', { name: 'Nastavení' })).toBeVisible()

    // A katalog cviků z obrazovky cvičení.
    await page.goto('/#/cviceni')
    await ready(page)
    await page.getByRole('link', { name: 'Katalog' }).click()
    await expect(page.getByRole('heading', { name: 'Katalog' })).toBeVisible()
  })

  test('katalog filtruje a detail cviku se otevře', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/cviky')
    await ready(page)

    await page.getByPlaceholder('Hledat cvik…').fill('prkno')
    await expect(page.getByRole('link', { name: /Prkno/ }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Kočka/ })).toHaveCount(0)

    await page.getByPlaceholder('Hledat cvik…').fill('')
    await page.getByRole('button', { name: 'Protažení', exact: true }).click()
    await expect(page.getByRole('link', { name: /Protažení hamstringů vleže/ })).toBeVisible()

    await page.getByRole('link', { name: /Protažení hamstringů vleže/ }).click()
    await expect(page.getByRole('heading', { name: /Protažení hamstringů vleže/ })).toBeVisible()
    await expect(page.getByText('Postup')).toBeVisible()
  })

  test('neznámá adresa skončí na hlavní obrazovce', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/neco-co-neexistuje')
    await ready(page)
    await expect(page.getByRole('heading', { name: /Dobré ráno|Ahoj|Dobrý večer/ })).toBeVisible()
  })

  test('service worker se zaregistruje', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/')
    await ready(page)

    const registered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      return !!reg
    })
    expect(registered).toBe(true)
  })

  test('manifest je dostupný a má ikony', async ({ page, context }) => {
    await seed(context)
    const response = await page.request.get('/manifest.webmanifest')
    expect(response.ok()).toBe(true)
    const manifest = await response.json()
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4)
    for (const icon of manifest.icons) {
      const res = await page.request.get(`/${icon.src}`)
      expect(res.ok(), `ikona ${icon.src} chybí`).toBe(true)
    }
    const appleIcon = await page.request.get('/icons/apple-touch-icon.png')
    expect(appleIcon.ok()).toBe(true)
    await context.close()
  })
})

test.describe('nastavení', () => {
  test('změna týdenního cíle se hned projeví na dnešku', async ({ page, context }) => {
    await seed(context, { weeklyTarget: 35_000 })
    await page.goto('/#/nastaveni')
    await ready(page)

    await page.locator('#weekly').fill('70000')
    await expect.poll(async () => (await readState(page)).settings.steps.weeklyTarget).toBe(70_000)
    await page.goto('/#/')
    await ready(page)

    const state = await readState(page)
    expect(state.settings.steps.weeklyTarget).toBe(70_000)
    // Dvojnásobný cíl = zhruba dvojnásobná dnešní porce.
    const needed = Number((await page.locator('.display').first().innerText()).replace(/\D/g, ''))
    expect(needed).toBeGreaterThan(9_000)
  })

  test('strop dluhu v blocích nejde nastavit nad splnitelnou mez', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/nastaveni')
    await ready(page)

    const slider = page.locator('#blockdebt')
    await expect(slider).toHaveAttribute('max', '3')
  })

  test('vymazané číselné pole se srovná, ne uloží jako prázdné', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/nastaveni')
    await ready(page)

    await page.locator('#goal').fill('')
    await page.locator('#goal').blur()
    await expect.poll(async () => typeof (await readState(page)).settings.steps.goalWeeklyTarget).toBe('number')
    expect((await readState(page)).settings.steps.goalWeeklyTarget).toBeGreaterThanOrEqual(21_000)

    // Mimo rozsah se hodnota přitáhne k mezi, ne uloží jak přišla.
    await page.locator('#goal').fill('900000')
    await page.locator('#goal').blur()
    await expect.poll(async () => (await readState(page)).settings.steps.goalWeeklyTarget).toBe(105_000)

    const share = page.getByLabel('Podíl na Po')
    await share.fill('')
    await share.blur()
    await expect.poll(async () => (await readState(page)).settings.steps.distribution[0]).toBe(0)
  })

  test('úkol z nabídky se přidá a objeví na dnešku', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/nastaveni')
    await ready(page)

    await page.getByRole('button', { name: 'Přidat úkol' }).click()
    await page.getByRole('button', { name: '🏊 Bazén' }).click()
    await expect.poll(async () =>
      (await readState(page)).weeklyTasks.some((t: any) => t.title === 'Bazén'),
    ).toBe(true)

    await page.goto('/#/')
    await ready(page)
    await expect(page.getByText('Bazén')).toBeVisible()
  })

  test('úkol se dá přejmenovat, přenastavit i posunout', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/nastaveni')
    await ready(page)

    await page.getByRole('button', { name: 'Upravit Posilovna' }).click()
    await page.getByLabel('Název').fill('Kruháč')
    await page.getByLabel('Název').blur()
    await page.getByRole('button', { name: '3× týdně' }).click()
    await page.getByRole('button', { name: 'Ikona 🤸' }).click()

    await expect.poll(async () => {
      const task = (await readState(page)).weeklyTasks.find((t: any) => t.id === 'gym')
      return [task?.title, task?.target, task?.emoji]
    }).toEqual(['Kruháč', 3, '🤸'])

    // Posun dolů musí přečíslovat pořadí, ne jen prohodit dvě položky.
    await page.getByRole('button', { name: 'Posunout dolů' }).click()
    await expect.poll(async () => {
      const tasks = (await readState(page)).weeklyTasks
      return [...tasks].sort((a: any, b: any) => a.order - b.order).map((t: any) => t.id)[0]
    }).toBe('long-walk')

    await page.goto('/#/')
    await ready(page)
    await expect(page.getByText('Kruháč')).toBeVisible()
  })

  test('vlastní úkol jde napsat a smazat', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/nastaveni')
    await ready(page)

    await page.getByRole('button', { name: 'Přidat úkol' }).click()
    await page.getByRole('button', { name: 'Nebo si napiš vlastní' }).click()
    await page.getByLabel('Název').fill('Lezecká stěna')
    await page.getByLabel('Název').blur()

    await expect.poll(async () =>
      (await readState(page)).weeklyTasks.some((t: any) => t.title === 'Lezecká stěna'),
    ).toBe(true)

    await page.getByRole('button', { name: 'Smazat úkol' }).click()
    await expect.poll(async () =>
      (await readState(page)).weeklyTasks.some((t: any) => t.title === 'Lezecká stěna'),
    ).toBe(false)
  })

  test('blok se dá přejmenovat, přeladit i vypnout', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/nastaveni')
    await ready(page)

    await page.getByRole('button', { name: 'Upravit blok Poledne' }).click()
    await page.getByLabel('Název').fill('Oběd')
    await page.getByLabel('Název').blur()
    await page.getByRole('button', { name: 'Kardio' }).click()
    await page.getByRole('button', { name: '30 minut' }).click()

    await expect.poll(async () => {
      const block = (await readState(page)).settings.exercise.blocks[1]
      return [block?.title, block?.focus, block?.minutes]
    }).toEqual(['Oběd', 'kardio', 30])

    // Vypnutý blok zmizí z plánu dne, ale pozice zbylých se nepřečíslují.
    await page.getByRole('checkbox', { name: /Ráno/ }).uncheck()
    await page.goto('/#/')
    await ready(page)
    await expect(page.getByText('Oběd')).toBeVisible()
    await expect(page.getByText('Ráno', { exact: true })).toHaveCount(0)
  })

  test('poslední zapnutý blok vypnout nejde', async ({ page, context }) => {
    await seed(context)
    await page.goto('/#/nastaveni')
    await ready(page)

    await page.getByRole('checkbox', { name: /Ráno/ }).uncheck()
    await page.getByRole('checkbox', { name: /Poledne/ }).uncheck()

    // Třetí je poslední – nesmí jít vypnout, jinak by nebylo co plánovat.
    await expect(page.getByRole('checkbox', { name: /Večer/ })).toBeDisabled()
    await expect.poll(async () =>
      (await readState(page)).settings.exercise.blocks.filter((b: any) => b.enabled).length,
    ).toBe(1)
  })

  test('export a import zálohy zachovají data', async ({ page, context }) => {
    await seed(context, { days: { [dayKey(0)]: { steps: 4321 } } })
    await page.goto('/#/nastaveni')
    await ready(page)

    // Záloha se bere tlačítkem, ne z localStorage – jinak by test netvrdil nic
    // o tom, jestli stahování vůbec funguje.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Stáhnout zálohu' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^henry-zaloha-\d{4}-\d{2}-\d{2}\.json$/)

    const file = await download.path()
    const backup = readFileSync(file, 'utf8')
    expect(JSON.parse(backup).days[dayKey(0)].steps).toBe(4321)

    // Rozbít data a obnovit je ze staženého souboru.
    await page.goto('/#/')
    await ready(page)
    await page.getByLabel('Zapsat kroky').fill('99')
    await page.locator('.quick-row button').click()
    await expect.poll(async () => (await readState(page)).days[dayKey(0)]?.steps).toBe(99)

    await page.goto('/#/nastaveni')
    await ready(page)
    await page.getByText('Obnovit ze zálohy').click()
    await page.getByPlaceholder('Sem vlož obsah zálohy…').fill(backup)
    await page.getByRole('button', { name: 'Obnovit' }).click()

    await expect.poll(async () => (await readState(page)).days[dayKey(0)].steps).toBe(4321)
  })
})
