/**
 * Synchronizace se serverem.
 *
 * Pracovní kopie dat žije v telefonu – díky ní appka funguje offline
 * a reaguje okamžitě. Server je archiv a slučovač: drží data i mimo telefon,
 * slévá je z ostatních zařízení, posílá notifikace a přebírá kroky ze Zkratky.
 *
 * Když je server zrovna nedostupný, appka jede dál z místní kopie.
 */

import { ref } from 'vue'
import { activeBlocks } from './plan'
import { pullSteps, pushState, syncWithServer } from './api'
import { buildSnapshot, setSteps, state, today, todayStatus, withRemoteApply } from '@/stores/app'
import { signedIn } from '@/stores/auth'
import { applyRecords, collectChanged } from './sync-records'
import { resubscribeOnLaunch, setBadge } from './sw-client'
import { todayKey } from './date'
import { recalculateFrom } from './engine'

export const syncing = ref(false)
export const lastSyncError = ref<string | null>(null)

/** Nejkratší interval mezi automatickými synchronizacemi. */
const MIN_INTERVAL_MS = 5 * 60 * 1000

let lastAttempt = 0

/** Bez přihlášení se synchronizovat nedá – appka pak jede jen lokálně. */
export function isServerConfigured(): boolean {
  return signedIn.value
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
      state.settings.notifications,
      buildSnapshot(),
      state.settings.timezone,
      activeBlocks(state).map((b) => b.slot),
    )

    // Kroky z Health se berou jako pravda – uživatel je nezapisoval ručně.
    const entries = await pullSteps(21)
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
    if (oldestChanged) recalculateFrom(state, oldestChanged, today.value)

    await syncRecords()

    return true
  } catch (err) {
    lastSyncError.value = (err as Error).message
    return false
  } finally {
    syncing.value = false
  }
}

/**
 * Vlastní výměna dat mezi zařízeními.
 *
 * Pošle se, co se od minule změnilo, a v téže odpovědi se vrátí, co mezitím
 * nahrálo jiné zařízení. Slučuje se po záznamech, takže ranní odškrtnutý blok
 * z telefonu a odpolední zápis kroků z notebooku přežijí oba.
 */
async function syncRecords(): Promise<void> {
  // Čas se bere PŘED odesláním. Kdyby se bral až po odpovědi, změna vzniklá
  // během požadavku by se tvářila jako už nahraná a nikdy by neodešla.
  const startedAt = new Date().toISOString()
  const changed = collectChanged(state, state.meta.pushedAt)

  const result = await pushState(state.meta.rev ?? 0, changed)

  const applied = withRemoteApply(() => applyRecords(state, result.records))

  state.meta.rev = result.rev
  state.meta.pushedAt = startedAt
  state.meta.syncedAt = new Date().toISOString()

  // Dluhová kniha se nepřenáší – je odvozená. Po sloučení cizích dnů nebo
  // změněného nastavení se musí přepočítat, jinak by ukazovala starý dluh.
  if (applied.oldestChangedDay) {
    recalculateFrom(state, applied.oldestChangedDay, today.value)
  } else if (applied.settingsChanged) {
    recalculateFrom(state, state.settings.startDate, today.value)
  }
}

/** Volá se při otevření appky a při návratu z pozadí. */
export async function maybeSync(): Promise<void> {
  if (todayKey() !== today.value) today.value = todayKey()

  // Číslo na ikoně = kolik bloků dnes ještě zbývá.
  const status = todayStatus.value
  void setBadge(Math.max(0, status.blocksTarget - status.blocksDone))

  if (!isServerConfigured()) return
  void resubscribeOnLaunch()
  await syncNow(false)
}
