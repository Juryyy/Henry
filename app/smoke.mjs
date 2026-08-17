/**
 * Rychlá kontrola v prohlížeči: projde všechny obrazovky, nasadí do nich
 * ukázková data a uloží screenshoty. Není to součást testů, jen pomůcka.
 *
 *   npx vite preview --port 4173
 *   node smoke.mjs
 */
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = process.env.SMOKE_OUT ?? './.smoke'
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4173/'
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME })
const errors = []

function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
}

/* --- 1. fáze: vytáhnout z appky výchozí stav ------------------------- */

const probeCtx = await browser.newContext({ ...devices['iPhone 14'] })
const probe = await probeCtx.newPage()
watch(probe)
await probe.goto(BASE, { waitUntil: 'networkidle' })
await probe.waitForSelector('h1')
await probe.getByRole('button', { name: '+500' }).first().click()
await probe.waitForTimeout(600)
const baseState = await probe.evaluate(() => localStorage.getItem('henry.state.v1'))
await probeCtx.close()

if (!baseState) throw new Error('appka nic neuložila do localStorage')

/* --- 2. fáze: nový kontext s nasazenými daty ------------------------- */

const seeded = (() => {
  const s = JSON.parse(baseState)
  const iso = (back) => {
    const d = new Date()
    d.setDate(d.getDate() - back)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  s.settings.name = 'Martine'
  s.settings.startDate = iso(30)
  s.settings.steps.weeklyTarget = 38500
  s.days = {}
  for (let i = 0; i < 26; i++) {
    const date = iso(i)
    s.days[date] = {
      date,
      steps: 3400 + Math.round(Math.abs(Math.sin(i * 1.7)) * 5400),
      stepsSource: i % 3 === 0 ? 'shortcut' : 'manual',
      blocks:
        i % 5 === 0
          ? []
          : [0, 2].map((slot) => ({
              slot,
              planId: 'seed',
              completedAt: `${date}T${slot === 0 ? '08' : '20'}:00:00.000Z`,
              durationSec: 880,
              doneExerciseIds: [],
              skippedExerciseIds: [],
            })),
    }
  }
  s.measurements = [
    { date: iso(28), weightKg: 96.2, waistCm: 106, toeTouchCm: 18, plankSec: 25 },
    { date: iso(21), weightKg: 95.4, waistCm: 105, toeTouchCm: 16.5, plankSec: 32 },
    { date: iso(14), weightKg: 94.9, waistCm: 104, toeTouchCm: 14, plankSec: 40 },
    { date: iso(7), weightKg: 94.1, waistCm: 103, toeTouchCm: 12.5, plankSec: 48 },
    { date: iso(0), weightKg: 93.4, waistCm: 102, toeTouchCm: 10, plankSec: 55 },
  ]
  const gymWeek = (() => {
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  s.weeklyTaskLogs = { [`${gymWeek}|long-walk`]: { week: gymWeek, taskId: 'long-walk', dates: [iso(1)], carried: 0 } }
  return JSON.stringify(s)
})()

const ctx = await browser.newContext({ ...devices['iPhone 14'], isMobile: true, hasTouch: true })
await ctx.addInitScript((value) => {
  localStorage.setItem('henry.state.v1', value)
  localStorage.setItem('henry.installHintDismissed', '1')
}, seeded)

const page = await ctx.newPage()
watch(page)

async function shot(name) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  console.log(`  ✓ ${name}`)
}

const screens = [
  ['01-dnes', ''],
  ['02-cviceni', '#/cviceni'],
  ['03-blok', '#/cviceni/2'],
  ['04-kroky', '#/kroky'],
  ['05-tyden', '#/tyden'],
  ['06-pokrok', '#/pokrok'],
  ['07-katalog', '#/cviky'],
  ['08-cvik', '#/cviky/supine-hamstring-strap'],
  ['09-nastaveni', '#/nastaveni'],
]

for (const [name, path] of screens) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await shot(name)
}

// Průchod blokem: spustit první cvik a nechat běžet odpočet.
await page.goto(`${BASE}#/cviceni/1`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
await page.getByRole('button', { name: /Spustit|^Hotovo$/ }).first().click()
await page.waitForTimeout(1500)
await shot('10-blok-bezi')

await ctx.close()

// Světlé téma.
const light = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'light' })
await light.addInitScript((value) => {
  localStorage.setItem('henry.state.v1', value)
  localStorage.setItem('henry.installHintDismissed', '1')
}, seeded)
const lightPage = await light.newPage()
watch(lightPage)
await lightPage.goto(BASE, { waitUntil: 'networkidle' })
await lightPage.waitForTimeout(700)
await lightPage.screenshot({ path: `${OUT}/11-svetle.png`, fullPage: true })
console.log('  ✓ 11-svetle')

await browser.close()

console.log('\nChyby v konzoli:', errors.length ? `\n${errors.join('\n')}` : 'žádné')
process.exit(errors.length ? 1 : 0)
