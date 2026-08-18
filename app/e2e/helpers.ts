import type { Page, BrowserContext } from '@playwright/test'

export const STORAGE_KEY = 'henry.state.v1'

/** Datum posunuté o `back` dní zpět, ve tvaru YYYY-MM-DD. */
export function dayKey(back = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - back)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Pondělí týdne, do kterého spadá `back` dní zpětně. */
export function weekKey(back = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - back)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface SeedOptions {
  /** Přeskočit úvodního průvodce. */
  onboarded?: boolean
  name?: string
  weeklyTarget?: number
  days?: Record<string, { steps?: number; blocks?: number[]; restDay?: boolean }>
  startDate?: string
  /** Další úpravy stavu, které se aplikují nakonec. */
  patch?: Record<string, unknown>
}

/**
 * Nasadí do prohlížeče výchozí stav ještě před spuštěním appky.
 *
 * Zapisuje se přes `addInitScript`, protože appka si při odchodu ze stránky
 * ukládá svůj stav – kdyby se localStorage přepisoval až po načtení,
 * první `reload` by změnu přepsal zpátky.
 */
export async function seed(context: BrowserContext, options: SeedOptions = {}): Promise<void> {
  const state = {
    schemaVersion: 1,
    settings: {
      name: options.name ?? '',
      timezone: 'Europe/Prague',
      startDate: options.startDate ?? dayKey(0),
      onboardedAt: options.onboarded === false ? undefined : new Date().toISOString(),
      steps: {
        weeklyTarget: options.weeklyTarget ?? 35_000,
        goalWeeklyTarget: 49_000,
        rampEnabled: false,
        rampStep: 3_500,
        distribution: [13, 13, 13, 13, 14, 17, 17],
        debtCapDays: 2,
        carrySurplus: true,
        creditCapDays: 1,
      },
      exercise: {
        blocksPerDay: 3,
        minutesPerBlock: 15,
        level: 1,
        debtCapBlocks: 6,
        graceDaysPerWeek: 1,
        excludedExerciseIds: [],
      },
      notifications: {
        enabled: false,
        blockTimes: ['07:15', '12:30', '20:00'],
        stepCheckTime: '17:45',
        stepCheckThreshold: 60,
        eveningReviewTime: '21:00',
        weeklyReviewTime: '19:00',
        quietFrom: '21:30',
        quietTo: '07:00',
        tone: 'coach',
      },
      server: { baseUrl: '', token: '' },
    },
    days: Object.fromEntries(
      Object.entries(options.days ?? {}).map(([date, day]) => [
        date,
        {
          date,
          steps: day.steps ?? 0,
          stepsSource: 'manual',
          restDay: day.restDay,
          blocks: (day.blocks ?? []).map((slot) => ({
            slot,
            planId: 'seed',
            completedAt: `${date}T12:00:00.000Z`,
            doneExerciseIds: [],
            skippedExerciseIds: [],
          })),
        },
      ]),
    ),
    weeklyTasks: [
      { id: 'gym', title: 'Posilovna', target: 1, emoji: '🏋️', active: true, rollover: true },
      { id: 'long-walk', title: 'Dlouhá procházka (60+ min)', target: 1, emoji: '🥾', active: true, rollover: true },
      { id: 'weigh-in', title: 'Zvážit se a změřit pas', target: 1, emoji: '⚖️', active: true, rollover: false },
      { id: 'toe-test', title: 'Test předklonu (cm od země)', target: 1, emoji: '📏', active: true, rollover: false },
    ],
    weeklyTaskLogs: {},
    measurements: [],
    ledger: [],
    bankruptcies: [],
    achievements: {},
    ...(options.patch ?? {}),
  }

  // Init skript běží při KAŽDÉ navigaci včetně reloadu. Zapisuje se proto
  // jen tehdy, když v úložišti ještě nic není – jinak by reload zahodil
  // všechno, co uživatel v testu naklikal, a testy na trvanlivost dat by
  // kontrolovaly samy sebe.
  await context.addInitScript(
    ([key, value]) => {
      if (!localStorage.getItem(key as string)) {
        localStorage.setItem(key as string, value as string)
      }
      localStorage.setItem('henry.installHintDismissed', '1')
    },
    [STORAGE_KEY, JSON.stringify(state)] as const,
  )
}

/**
 * Přečte uložený stav z prohlížeče.
 *
 * Appka ukládá se zpožděním (debounce 250 ms), aby se při psaní do políčka
 * netrhal UI thread – proto se před čtením chvíli počká.
 */
export async function readState(page: Page): Promise<Record<string, any>> {
  await page.waitForTimeout(400)
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
  if (!raw) throw new Error('v localStorage nic není')
  return JSON.parse(raw)
}

/** Počká, až se appka vykreslí (a případně doběhne uložení stavu). */
export async function ready(page: Page): Promise<void> {
  await page.waitForSelector('h1', { timeout: 15_000 })
  await page.waitForTimeout(150)
}

/** Text velkého čísla „dnes ještě“ převedený na číslo. */
export async function neededToday(page: Page): Promise<number> {
  const text = await page.locator('.display').first().innerText()
  return Number(text.replace(/[^\d]/g, ''))
}
