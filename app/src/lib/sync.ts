/**
 * Synchronizace se serverem.
 *
 * Zdrojem pravdy jsou data v telefonu. Server slouží jen ke dvěma věcem:
 *   1. posílá notifikace (potřebuje k tomu vědět, jak na tom dneska jsi),
 *   2. přebírá kroky z Apple Shortcuts, které si odsud stáhneme.
 *
 * Když server není nastavený nebo je nedostupný, appka funguje dál.
 */

import { ref } from 'vue'
import { pullSteps, syncWithServer } from './api'
import { buildSnapshot, setSteps, state, today, todayStatus } from '@/stores/app'
import { resubscribeOnLaunch, setBadge } from './sw-client'
import { todayKey, weekKeyOf } from './date'
import { closeDueWeeks, reopenWeeksFrom } from './engine'

export const syncing = ref(false)
export const lastSyncError = ref<string | null>(null)

/** Nejkratší interval mezi automatickými synchronizacemi. */
const MIN_INTERVAL_MS = 5 * 60 * 1000

let lastAttempt = 0

export function isServerConfigured(): boolean {
  return !!state.settings.server.baseUrl && !!state.settings.server.token
}

/**
 * Nahraje stav a stáhne kroky. `force: true` obejde interval (tlačítko
 * „Synchronizovat“ v nastavení).
 */
export async function syncNow(force = false): Promise<boolean> {
  if (!isServerConfigured()) return false
  if (syncing.value) return false
  if (!force && Date.now() - lastAttempt < MIN_INTERVAL_MS) return false

  lastAttempt = Date.now()
  syncing.value = true
  lastSyncError.value = null

  try {
    await syncWithServer(
      state.settings.server,
      state.settings.notifications,
      buildSnapshot(),
      state.settings.timezone,
      state.settings.exercise.blocksPerDay,
    )

    // Kroky z Health se berou jako pravda – uživatel je nezapisoval ručně.
    const entries = await pullSteps(state.settings.server, 21)
    let oldestChanged: string | null = null
    for (const entry of entries) {
      const local = state.days[entry.date]
      // Ruční zápis nepřepisujeme, pokud je vyšší (uživatel mohl dopsat
      // procházku, kterou hodinky nezachytily).
      if (local?.stepsSource === 'manual' && local.steps > entry.steps) continue
      if (local?.steps === entry.steps) continue
      setSteps(entry.date, entry.steps, 'shortcut')
      if (!oldestChanged || entry.date < oldestChanged) oldestChanged = entry.date
    }

    // Kroky mohly dorazit za den, který spadá do už uzavřeného týdne – typicky
    // když se appka týden neotevřela. Uzávěrku je pak potřeba přepočítat,
    // jinak by v knize zůstal dluh z dat, která tehdy ještě nebyla k dispozici.
    if (oldestChanged) {
      const week = weekKeyOf(oldestChanged)
      if (state.lastClosedWeek && week <= state.lastClosedWeek) {
        reopenWeeksFrom(state, week)
        closeDueWeeks(state, today.value)
      }
    }

    state.settings.server.lastSyncAt = new Date().toISOString()
    return true
  } catch (err) {
    lastSyncError.value = (err as Error).message
    return false
  } finally {
    syncing.value = false
  }
}

/** Volá se při otevření appky a při návratu z pozadí. */
export async function maybeSync(): Promise<void> {
  if (todayKey() !== today.value) today.value = todayKey()

  // Číslo na ikoně = kolik bloků dnes ještě zbývá.
  const status = todayStatus.value
  void setBadge(Math.max(0, status.blocksTarget - status.blocksDone))

  if (!isServerConfigured()) return
  void resubscribeOnLaunch(state.settings.server.baseUrl, state.settings.server.token)
  await syncNow(false)
}
