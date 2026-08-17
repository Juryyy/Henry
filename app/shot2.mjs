import { chromium, devices } from '@playwright/test'

const OUT = '/tmp/claude-0/-home-user-Henry/c86fcc02-f522-5075-9a8b-85812cddab87/scratchpad'

function dayKey(back = 0) {
  const d = new Date(); d.setDate(d.getDate() - back)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Úplně čerstvý stav: prošel onboardingem, žádná data.
const state = {
  schemaVersion: 1,
  settings: {
    name: '', timezone: 'Europe/Prague', startDate: dayKey(0),
    onboardedAt: new Date().toISOString(),
    steps: { weeklyTarget: 28000, goalWeeklyTarget: 49000, rampEnabled: true, rampStep: 3500,
      distribution: [13,13,13,13,14,17,17], debtCapDays: 2, carrySurplus: true, creditCapDays: 1 },
    exercise: { blocksPerDay: 3, minutesPerBlock: 15, level: 1, debtCapBlocks: 6, graceDaysPerWeek: 1, excludedExerciseIds: [] },
    notifications: { enabled: false, blockTimes: ['07:15','12:30','20:00'], stepCheckTime: '17:45',
      stepCheckThreshold: 60, eveningReviewTime: '21:00', weeklyReviewTime: '19:00', quietFrom: '21:30', quietTo: '07:00', tone: 'coach' },
    server: { baseUrl: '', token: '' },
  },
  days: {}, weeklyTasks: [
    { id: 'gym', title: 'Posilovna', target: 1, emoji: '🏋️', active: true, rollover: true },
  ],
  weeklyTaskLogs: {}, measurements: [], ledger: [], bankruptcies: [], achievements: {},
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
for (const scheme of ['dark','light']) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], browserName: 'chromium', colorScheme: scheme })
  await ctx.addInitScript(`localStorage.setItem('henry.state.v1', ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem('henry.installHintDismissed','1')`)
  const page = await ctx.newPage()
  for (const [name, hash] of [['e-dnes','#/'],['e-pokrok','#/pokrok'],['e-tyden','#/tyden'],['e-kroky','#/kroky']]) {
    await page.goto('http://127.0.0.1:4173/' + hash)
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/${scheme}-${name}.png`, fullPage: true })
  }
  // detail rozložení v nastavení (bez fullPage, aby nepřekážel tabbar)
  await page.goto('http://127.0.0.1:4173/#/nastaveni')
  await page.waitForTimeout(600)
  const el = await page.locator('.dist').first()
  await el.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/${scheme}-dist.png` })
  // onboarding
  await ctx.addInitScript(`localStorage.removeItem('henry.state.v1')`)
  await ctx.close()
}
// onboarding zvlášť, čistý kontext
for (const scheme of ['light']) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], browserName: 'chromium', colorScheme: scheme })
  const page = await ctx.newPage()
  await page.goto('http://127.0.0.1:4173/#/start')
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${scheme}-onb0.png` })
  await page.getByRole('button', { name: 'Jdeme na to' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Dál' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${scheme}-onb2.png` })
  await ctx.close()
}
await browser.close()
console.log('ok')
