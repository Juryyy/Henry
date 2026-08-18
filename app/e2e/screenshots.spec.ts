import { test } from '@playwright/test'
import { dayKey, ready, seed } from './helpers'

/**
 * Ne test, ale generátor obrázků do README. Pouští se ručně:
 *   npm run screenshots
 * V běžné sadě je vynechaný (viz `testIgnore` v playwright.config.ts).
 */
const DAYS: Record<string, { steps?: number; blocks?: number[] }> = {
  [dayKey(0)]: { steps: 4_820, blocks: [0] },
  [dayKey(1)]: { steps: 6_140, blocks: [0, 1, 2] },
  [dayKey(2)]: { steps: 5_530, blocks: [0, 1] },
  [dayKey(3)]: { steps: 3_210, blocks: [0, 1, 2] },
  [dayKey(4)]: { steps: 7_050, blocks: [0, 1, 2] },
  [dayKey(5)]: { steps: 5_900, blocks: [0, 1] },
  [dayKey(6)]: { steps: 4_400, blocks: [0, 1, 2] },
  [dayKey(7)]: { steps: 6_700, blocks: [0, 1, 2] },
}

test('obrázky do README', async ({ page, context }) => {
  await seed(context, {
    name: 'Martin',
    startDate: dayKey(21),
    days: DAYS,
    patch: {
      measurements: [
        { date: dayKey(28), weightKg: 94.8, waistCm: 102, toeTouchCm: 21, plankSec: 35 },
        { date: dayKey(14), weightKg: 93.6, waistCm: 100.5, toeTouchCm: 17, plankSec: 48 },
        { date: dayKey(2), weightKg: 92.4, waistCm: 99, toeTouchCm: 13, plankSec: 62 },
      ],
    },
  })

  // Gratulace k milníkům by na obrázcích jen překážely – odklikneme je.
  await page.goto('/#/')
  await ready(page)
  for (let i = 0; i < 6 && (await page.locator('.toast').count()) > 0; i++) {
    await page.locator('.toast .icon-btn').click()
    await page.waitForTimeout(400)
  }

  for (const [name, path] of [
    ['dnes', '/#/'],
    ['cviceni', '/#/cviceni'],
    ['kroky', '/#/kroky'],
    ['pokrok', '/#/pokrok'],
  ] as const) {
    await page.goto(path)
    await ready(page)
    await page.waitForTimeout(600)
    await page.screenshot({ path: `../docs/screenshots/${name}.png`, scale: 'css' })
  }
})
