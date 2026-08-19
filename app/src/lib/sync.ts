/**
 * Synchronizace se serverem.
 *
 * Pracovní kopie dat žije v telefonu – díky ní appka funguje offline
 * a reaguje okamžitě. Server je archiv a slučovač: drží data i mimo telefon,
 * slévá je z ostatních zařízení, posílá notifikace a přebírá kroky ze Zkratky.
 *
 * Když je server zrovna nedostupný, appka jede dál z místní kopie.
 */

import { ref, watch } from 'vue'
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

/**
 * Doběhl už první pokus o stažení dat ze serveru?
 *
 * Do té doby se o uživateli nedá nic tvrdit. Na čerstvě otevřeném prohlížeči
 * je místní kopie prázdná, takže by se dlouholetý uživatel po přihlášení
 * tvářil jako někdo úplně nový – a appka by ho poslala do úvodního průvodce,
 * který by mu po dokončení přepsal cíl, úroveň i datum začátku.
 *
 * `true` je i po neúspěchu: bez serveru se pracuje s tím, co je v telefonu,
 * ale rozhodnout se musí.
 */
export const stateReady = ref(false)

/**
 * Odhlášení vrací appku do stavu „ještě nevím“ – další účet má jiná data.
 *
 * Hlídá se to tady, ne ve storu s účtem: ten by si musel natáhnout
 * synchronizaci, a protože synchronizace si natahuje jeho, vznikl by kruh.
 * V kruhu jeden z modulů dostane při načtení ještě nedokončený druhý a
 * `signedIn` je v tu chvíli `undefined`.
 */
watch(signedIn, (yes) => {
  if (!yes) stateReady.value = false
})

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

    // Nejdřív výměna záznamů, teprve pak kroky. Obráceně to bylo nebezpečné:
    // stažené kroky si vyrobily místní den (`ensureDay` ho zakládá s prázdným
    // polem bloků) a ten pak odešel na server s čerstvým razítkem. Den se
    // posílá jako celek, takže tím přepsal serverovou verzi i s odcvičenými
    // bloky. Takhle už je den v tu chvíli stažený a kroky se do něj jen
    // doplní.
    await syncRecords()

    // Kroky z Health se berou jako pravda – uživatel je nezapisoval ručně.
    const entries = await pullSteps(21)
    let oldestChanged: string | null = null
    for (const entry of entries) {
      const local = state.days[entry.date]
      // Ruční zápis nepřepisujeme, pokud je vyšší (uživatel mohl dopsat
      // procházku, kterou hodinky nezachytily).
      if (local?.stepsSource === 'manual' && local.steps > entry.steps) continue
      if (local?.steps === entry.steps) continue
      // Razítko serveru, ne „teď" – tohle není místní změna.
      setSteps(entry.date, entry.steps, 'shortcut', entry.updatedAt)
      if (!oldestChanged || entry.date < oldestChanged) oldestChanged = entry.date
    }

    // Kroky mohly dorazit za den, který spadá do už uzavřeného týdne – typicky
    // když se appka týden neotevřela. Uzávěrku je pak potřeba přepočítat,
    // jinak by v knize zůstal dluh z dat, která tehdy ještě nebyla k dispozici.
    if (oldestChanged) recalculateFrom(state, oldestChanged, today.value)

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

/* ------------------------------------------------------------------ */
/*  Odeslání změn                                                      */
/* ------------------------------------------------------------------ */

/**
 * Jak dlouho se čeká po poslední změně, než se pošle na server.
 *
 * Krátce schválně. Dřív se pushovalo jen při startu appky, takže odcvičený
 * ranní blok ležel v telefonu do doby, než se appka zase otevřela – a kdo se
 * mezitím přihlásil na notebooku, viděl prázdný den. Pár vteřin stačí na to,
 * aby se posbíralo víc odškrtnutí za sebou a neposílalo se po každém klepnutí.
 */
const PUSH_DELAY_MS = 2000
let pushTimer: ReturnType<typeof setTimeout> | undefined

/** Odešle změny hned, pokud nějaké jsou. Ticho, když není co nebo kam. */
async function pushNow(): Promise<void> {
  clearTimeout(pushTimer)
  if (!isServerConfigured() || syncing.value) return
  // Jediná podmínka, která tu má co dělat: opravdu je co poslat. Zároveň to
  // zabraňuje kolotoči – po úspěšném odeslání se `pushedAt` posune a další
  // kolo nic nenajde.
  if (collectChanged(state, state.meta.pushedAt).length === 0) return

  syncing.value = true
  try {
    await syncRecords()
    lastSyncError.value = null
  } catch (err) {
    // Bez signálu se cvičit dá. Zkusí se to znovu při další změně nebo startu.
    lastSyncError.value = (err as Error).message
  } finally {
    syncing.value = false
  }
}

/** Naplánuje odeslání. Opakované volání odklad posouvá, neplodí další. */
export function pushSoon(delay = PUSH_DELAY_MS): void {
  if (!isServerConfigured()) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void pushNow(), delay)
}

/**
 * Každá orazítkovaná změna spustí odpočet k odeslání.
 *
 * Sleduje se razítkovník, ne celý stav: co nemá razítko, se stejně neposílá,
 * a odvozené věci (dluhová kniha, milníky) by jinak budily push zbytečně.
 */
watch(() => state.meta.updatedAt, () => pushSoon(), { deep: true })

/**
 * Odchod z appky je poslední šance. Odeslat se to nemusí stihnout – na iOS
 * bývá záložka zabitá dřív – ale stojí to jedno volání a v půlce případů to
 * ušetří den čekání na příští spuštění.
 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void pushNow()
  })
  window.addEventListener('pagehide', () => void pushNow())
}

/** Volá se při otevření appky a při návratu z pozadí. */
export async function maybeSync(): Promise<void> {
  if (todayKey() !== today.value) today.value = todayKey()

  // Číslo na ikoně = kolik bloků dnes ještě zbývá.
  const status = todayStatus.value
  void setBadge(Math.max(0, status.blocksTarget - status.blocksDone))

  if (!isServerConfigured()) {
    // Bez přihlášení není na co čekat – platí to, co je v telefonu.
    stateReady.value = true
    return
  }
  void resubscribeOnLaunch()
  try {
    await syncNow(false)
  } finally {
    // I neúspěch je odpověď: víc už se nedozvíme a appka musí jet dál.
    stateReady.value = true
  }
}
