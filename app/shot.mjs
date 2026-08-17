import { chromium, devices } from '@playwright/test'

const OUT = '/tmp/claude-0/-home-user-Henry/c86fcc02-f522-5075-9a8b-85812cddab87/scratchpad'

function dayKey(back = 0) {
  const d = new Date(); d.setDate(d.getDate() - back)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const days = {}
for (let i = 0; i < 20; i++) {
  days[dayKey(i)] = { date: dayKey(i), steps: [1200, 5200, 3000, 7100, 400, 4800, 6000][i % 7], blocks: [], restDay: false, tasksDone: [] }
}

const state = {
  schemaVersion: 1,
  settings: {
    name: 'Martin', timezone: 'Europe/Prague', startDate: dayKey(30),
    onboardedAt: new Date().toISOString(),
    steps: { weeklyTarget: 35000, goalWeeklyTarget: 49000, rampEnabled: true, rampStep: 3500,
      distribution: [13,13,13,13,14,17,17], debtCapDays: 2, carrySurplus: true, creditCapDays: 1 },
    exercise: { blocksPerDay: 3, minutesPerBlock: 15, level: 1, debtCapBlocks: 6, graceDaysPerWeek: 1, excludedExerciseIds: ['dead-bug'] },
    notifications: { enabled: false, blockTimes: ['07:15','12:30','20:00'], stepCheckTime: '17:45',
      stepCheckThreshold: 60, eveningReviewTime: '21:00', weeklyReviewTime: '19:00', quietFrom: '21:30', quietTo: '07:00', tone: 'coach' },
    server: { baseUrl: '', token: '' },
  },
  days,
  weeklyTasks: [
    { id: 'gym', title: 'Posilovna', target: 1, emoji: '🏋️', active: true, rollover: true },
    { id: 'long-walk', title: 'Dlouhá procházka (60+ min)', target: 1, emoji: '🥾', active: true, rollover: true },
  ],
  weeklyTaskLogs: {},
  measurements: [
    { date: dayKey(28), weightKg: 94.6, waistCm: 106, toeTouchCm: 18, plankSec: 30 },
    { date: dayKey(14), weightKg: 93.1, waistCm: 105, toeTouchCm: 15, plankSec: 40 },
    { date: dayKey(2), weightKg: 92.4, waistCm: 104, toeTouchCm: 12.5, plankSec: 52 },
  ],
  ledger: [], bankruptcies: [], achievements: {},
}

const shots = [
  ['dnes', '#/'],
  ['kroky', '#/kroky'],
  ['tyden', '#/tyden'],
  ['pokrok', '#/pokrok'],
  ['cviceni', '#/cviceni'],
  ['blok', '#/cviceni/0'],
  ['katalog', '#/cviky'],
  ['nastaveni', '#/nastaveni'],
]

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], browserName: 'chromium', colorScheme: scheme })
  await ctx.addInitScript(`localStorage.setItem('henry.state.v1', ${JSON.stringify(JSON.stringify(state))})`)
  const page = await ctx.newPage()
  for (const [name, hash] of shots) {
    await page.goto('http://127.0.0.1:4173/' + hash)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/${scheme}-${name}.png`, fullPage: true })
  }
  await ctx.close()
}
await browser.close()
console.log('done')
