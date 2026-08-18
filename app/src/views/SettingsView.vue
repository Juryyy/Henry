<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { checkHealth, fetchVersions, restoreVersion, sendTestPush, type StateVersion } from '@/lib/api'
import { dec, num, parseNumber, plural } from '@/lib/format'
import { EXERCISES } from '@/data/exercises'
import { debtCap, weeklyBlockTarget } from '@/lib/engine'
import { isServerConfigured, lastSyncError, syncing, syncNow } from '@/lib/sync'
import {
  disablePush,
  enablePush,
  hasPushSubscription,
  isIos,
  isStandalone,
  notificationPermission,
  pushBlockedReason,
  showLocalNotification,
} from '@/lib/sw-client'
import {
  exportJson,
  importJson,
  removeTask,
  resetAll,
  state,
  upsertTask,
} from '@/stores/app'
import type { WeeklyTask } from '@/lib/types'

const s = computed(() => state.settings)

/* Kroky ---------------------------------------------------------------- */

const avgDaily = computed(() => Math.round(s.value.steps.weeklyTarget / 7))
const debtCapValue = computed(() => Math.round(avgDaily.value * s.value.steps.debtCapDays))

/** „2 dny“ / „1,5 dne“ – posuvník jde po půldnech. */
const debtCapLabel = computed(() => {
  const days = s.value.steps.debtCapDays
  const isWhole = Number.isInteger(days)
  return `${dec(days)} ${isWhole ? plural(days, 'den', 'dny', 'dnů') : 'dne'}`
})

const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

const distributionSum = computed(() =>
  s.value.steps.distribution.reduce((a, b) => a + (Number(b) || 0), 0),
)

/** Kolik bloků je za týden povinných a kolik se jich maximálně přenese. */
const weeklyBlocks = computed(() => weeklyBlockTarget(state))
const maxBlockCap = computed(() =>
  Math.max(0, s.value.exercise.blocksPerDay * 7 - weeklyBlocks.value),
)
const effectiveBlockCap = computed(() => debtCap(state, 'blocks'))

function resetDistribution(): void {
  s.value.steps.distribution = [13, 13, 13, 13, 14, 17, 17]
}

/**
 * Číselné pole se dá vymazat a `v-model.number` pak do nastavení uloží
 * prázdný řetězec. S tím se nedá počítat – cíl by se tvářil jako nula
 * a laťka by se přestala zvedat. Po odchodu z pole se hodnota srovná.
 */
function clampGoal(): void {
  const value = parseNumber(s.value.steps.goalWeeklyTarget) ?? 49_000
  s.value.steps.goalWeeklyTarget = Math.round(Math.min(105_000, Math.max(21_000, value)) / 500) * 500
}

function clampShare(index: number): void {
  const value = parseNumber(s.value.steps.distribution[index]) ?? 0
  s.value.steps.distribution[index] = Math.min(40, Math.max(0, Math.round(value)))
}

/* Úkoly ---------------------------------------------------------------- */

const newTask = ref('')

function addTask(): void {
  const title = newTask.value.trim()
  if (!title) return
  upsertTask({
    id: `task-${Date.now().toString(36)}`,
    title,
    target: 1,
    emoji: '✅',
    active: true,
    rollover: true,
  })
  newTask.value = ''
}

function patchTask(task: WeeklyTask, patch: Partial<WeeklyTask>): void {
  upsertTask({ ...task, ...patch })
}

/* Notifikace ------------------------------------------------------------ */

const pushActive = ref(false)
const pushMessage = ref('')
const pushBusy = ref(false)

onMounted(async () => {
  pushActive.value = await hasPushSubscription()
})

const blockedReason = computed(() => pushBlockedReason())
const permission = computed(() => notificationPermission())

async function turnOnPush(): Promise<void> {
  // POZOR: žádný await před tímhle voláním. Safari povolí dotaz na notifikace
  // jen během reakce na dotek a `await` to „uživatelské gesto“ spotřebuje.
  pushBusy.value = true
  pushMessage.value = ''
  const result = await enablePush(s.value.server.baseUrl, s.value.server.token)
  pushBusy.value = false
  if (result.ok) {
    pushActive.value = true
    s.value.notifications.enabled = true
    pushMessage.value = 'Notifikace zapnuté. Zkus si poslat testovací.'
    void syncNow(true)
  } else {
    pushMessage.value = result.error ?? 'Nepodařilo se.'
  }
}

async function turnOffPush(): Promise<void> {
  pushBusy.value = true
  await disablePush(s.value.server.baseUrl, s.value.server.token)
  pushActive.value = false
  s.value.notifications.enabled = false
  pushBusy.value = false
  pushMessage.value = 'Vypnuto.'
  void syncNow(true)
}

async function testPush(): Promise<void> {
  pushMessage.value = 'Posílám…'
  try {
    const result = await sendTestPush(s.value.server)
    pushMessage.value =
      result.sent > 0
        ? `Odesláno na ${result.sent} zařízení. Za chvíli by to mělo cinknout.`
        : 'Server nemá žádné registrované zařízení.'
  } catch (err) {
    pushMessage.value = (err as Error).message
  }
}

async function testLocal(): Promise<void> {
  const ok = await showLocalNotification('Henry', 'Takhle bude notifikace vypadat.', '#/')
  pushMessage.value = ok ? 'Zobrazeno.' : 'Nejdřív povol notifikace.'
}

/* Server ---------------------------------------------------------------- */

const serverStatus = ref('')

async function testServer(): Promise<void> {
  serverStatus.value = 'Zkouším…'
  try {
    const health = await checkHealth(s.value.server)
    serverStatus.value = `Server žije. Čas ${Math.floor(health.now.minutes / 60)}:${String(health.now.minutes % 60).padStart(2, '0')}, ${health.subscriptions} zařízení, plánovač ${health.scheduler ? 'běží' : 'stojí'}.`
  } catch (err) {
    serverStatus.value = (err as Error).message
  }
}

async function doSync(): Promise<void> {
  const ok = await syncNow(true)
  serverStatus.value = ok ? 'Synchronizováno.' : (lastSyncError.value ?? 'Nepodařilo se.')
}

/* Verze na serveru ------------------------------------------------------- */

const versions = ref<StateVersion[]>([])
const versionMessage = ref('')
const confirmVersion = ref<number | null>(null)

async function loadVersions(): Promise<void> {
  versionMessage.value = ''
  try {
    const data = await fetchVersions(s.value.server)
    versions.value = data.versions
    if (versions.value.length === 0) versionMessage.value = 'Na serveru zatím nic není.'
  } catch (err) {
    versionMessage.value = `Nepovedlo se: ${(err as Error).message}`
  }
}

/** Vrácení k verzi je destruktivní – proto na dvě klepnutí. */
async function doRestore(rev: number): Promise<void> {
  if (confirmVersion.value !== rev) {
    confirmVersion.value = rev
    setTimeout(() => {
      if (confirmVersion.value === rev) confirmVersion.value = null
    }, 5_000)
    return
  }
  confirmVersion.value = null
  versionMessage.value = 'Vracím…'
  try {
    await restoreVersion(s.value.server, rev)
    // Server má teď starší data s novým časem – stáhnou se běžnou cestou.
    await syncNow(true)
    versionMessage.value = 'Hotovo, data jsou zpátky.'
  } catch (err) {
    versionMessage.value = `Nepovedlo se: ${(err as Error).message}`
  }
}

/* Data ------------------------------------------------------------------ */

const importText = ref('')
const dataMessage = ref('')

function download(): void {
  const blob = new Blob([exportJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `henry-zaloha-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function copyToClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportJson())
    dataMessage.value = 'Záloha zkopírovaná do schránky.'
  } catch {
    dataMessage.value = 'Schránka nefunguje, použij stažení souboru.'
  }
}

function doImport(): void {
  try {
    importJson(importText.value)
    dataMessage.value = 'Naimportováno.'
    importText.value = ''
  } catch (err) {
    dataMessage.value = `Nepovedlo se: ${(err as Error).message}`
  }
}

const confirmReset = ref(false)
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">Henry</div>
        <h1>Nastavení</h1>
      </div>
    </header>

    <div class="stack">
      <!-- Základní ---------------------------------------------------- -->
      <section class="card">
        <div class="field">
          <label for="name">Jak ti má říkat</label>
          <input id="name" v-model="s.name" type="text" placeholder="nepovinné" maxlength="40" />
          <div class="hint">Objeví se v notifikacích. Nech prázdné, pokud ti to leze na nervy.</div>
        </div>
      </section>

      <!-- Kroky ------------------------------------------------------- -->
      <section class="card">
        <div class="card-title">Kroky</div>
        <div class="stack-sm">
          <div class="field">
            <label for="weekly">Týdenní cíl: <span class="num strong">{{ num(s.steps.weeklyTarget) }}</span>
              <span class="faint tiny"> ({{ num(avgDaily) }} denně)</span>
            </label>
            <input id="weekly" v-model.number="s.steps.weeklyTarget" type="range" min="14000" max="84000" step="3500" />
            <div class="hint">
              Sedavý dospělý má běžně 3–5 tisíc kroků denně. Začni tam, kde reálně jsi,
              ne tam, kde bys chtěl být – prvních pár týdnů rozhoduje o tom, jestli u toho zůstaneš.
            </div>
          </div>

          <label class="toggle">
            <input v-model="s.steps.rampEnabled" type="checkbox" />
            <span>
              Zvedat laťku po splněném týdnu
              <span class="tiny faint block">
                +{{ num(s.steps.rampStep) }} kroků týdně, až na {{ num(s.steps.goalWeeklyTarget) }}
                ({{ num(Math.round(s.steps.goalWeeklyTarget / 7)) }} denně). Když týden nevyjde, laťka se nezvedá.
              </span>
            </span>
          </label>

          <div class="field">
            <label for="goal">Cílová meta (týdně)</label>
            <input
              id="goal"
              v-model.number="s.steps.goalWeeklyTarget"
              type="number"
              step="3500"
              min="21000"
              max="105000"
              @change="clampGoal"
            />
            <div class="hint">
              7 000 kroků denně (49 000 týdně) je hodnota, za kterou už se v datech křivka zdravotního
              přínosu skoro neohýbá. Deset tisíc je marketingové číslo z japonského krokoměru z roku 1965.
            </div>
          </div>

          <div class="field">
            <label>Rozložení cíle přes týden <span class="tiny faint">({{ distributionSum }} %)</span></label>
            <div class="dist">
              <div v-for="(_, i) in s.steps.distribution" :key="i" class="dist-col">
                <input
                  v-model.number="s.steps.distribution[i]"
                  type="number"
                  min="0"
                  max="40"
                  :aria-label="`Podíl na ${WEEKDAYS[i]}`"
                  @change="clampShare(i)"
                />
                <span class="tiny faint">{{ WEEKDAYS[i] }}</span>
              </div>
            </div>
            <button class="btn btn-sm btn-ghost" style="margin-top: 8px" @click="resetDistribution">
              Vrátit výchozí
            </button>
            <div class="hint">Výchozí nastavení dává víc na víkend – přes týden je člověk v práci.</div>
          </div>

          <div class="field">
            <label for="cap">Strop dluhu: {{ debtCapLabel }} ({{ num(debtCapValue) }} kroků)</label>
            <input id="cap" v-model.number="s.steps.debtCapDays" type="range" min="0" max="4" step="0.5" />
            <div class="hint">
              Kolik se maximálně přenese do dalšího týdne. Při dvou dnech znamená dluh 1,3násobek
              běžného objemu – to je horní hranice, kterou tělo bez problémů unese. Víc už je recept
              na natažené lýtko a na to appku smazat.
            </div>
          </div>

          <label class="toggle">
            <input v-model="s.steps.carrySurplus" type="checkbox" />
            <span>
              Přenášet i přebytek
              <span class="tiny faint block">Co nachodíš navíc, sníží cíl příštího týdne (max 1 den).</span>
            </span>
          </label>
        </div>
      </section>

      <!-- Cvičení ----------------------------------------------------- -->
      <section class="card">
        <div class="card-title">Cvičení</div>
        <div class="stack-sm">
          <div class="field">
            <label>Obtížnost</label>
            <div class="segmented">
              <button
                v-for="opt in [1, 2, 3]"
                :key="opt"
                :aria-pressed="s.exercise.level === opt"
                @click="s.exercise.level = opt as 1 | 2 | 3"
              >
                {{ ['začátek', 'střední', 'pokročilé'][opt - 1] }}
              </button>
            </div>
            <div class="hint">
              Nižší úroveň znamená míň sérií a lehčí varianty cviků, ne kratší blok.
            </div>
          </div>

          <div class="field">
            <label>Bloků denně</label>
            <div class="segmented">
              <button
                v-for="n in 3"
                :key="n"
                :aria-pressed="s.exercise.blocksPerDay === n"
                @click="s.exercise.blocksPerDay = n"
              >
                {{ n }}×
              </button>
            </div>
          </div>

          <div class="field">
            <label>Minut na blok</label>
            <div class="segmented">
              <button
                v-for="m in [10, 15, 20]"
                :key="m"
                :aria-pressed="s.exercise.minutesPerBlock === m"
                @click="s.exercise.minutesPerBlock = m"
              >
                {{ m }} min
              </button>
            </div>
          </div>

          <div class="field">
            <label for="grace">Dny milosti za týden: {{ s.exercise.graceDaysPerWeek }}</label>
            <input id="grace" v-model.number="s.exercise.graceDaysPerWeek" type="range" min="0" max="3" step="1" />
            <div class="hint">
              Kolik dní smíš za týden vynechat bez postihu. Jeden vynechaný den nemá shodit sérii –
              to je nejrychlejší cesta k „stejně už je to v háji“ a k tomu přestat úplně.
            </div>
          </div>

          <div class="field">
            <label for="blockdebt">
              Strop dluhu v blocích: {{ effectiveBlockCap }}
              <span v-if="effectiveBlockCap < s.exercise.debtCapBlocks" class="faint">
                (výš to nejde)
              </span>
            </label>
            <input id="blockdebt" v-model.number="s.exercise.debtCapBlocks" type="range" min="0" :max="maxBlockCap" step="1" />
            <div class="hint">
              Za týden zvládneš nejvýš {{ s.exercise.blocksPerDay * 7 }} bloků a
              {{ weeklyBlocks }} jich je povinných, takže se dá přenést nanejvýš
              {{ maxBlockCap }}. Vyšší strop by vyrobil dluh, který nejde splatit.
            </div>
          </div>

          <p class="tiny faint">
            V katalogu je {{ EXERCISES.length }} cviků, vyřazených
            {{ s.exercise.excludedExerciseIds.length }}. Vyřazovat se dá v detailu cviku.
          </p>
        </div>
      </section>

      <!-- Týdenní úkoly ----------------------------------------------- -->
      <section class="card">
        <div class="card-title">Týdenní úkoly</div>
        <ul class="list-reset stack-sm">
          <li v-for="task in state.weeklyTasks" :key="task.id" class="task-edit">
            <label class="toggle grow">
              <input type="checkbox" :checked="task.active" @change="patchTask(task, { active: !task.active })" />
              <span>
                {{ task.emoji }} {{ task.title }}
                <span class="tiny faint block">
                  {{ task.target }}× týdně{{ task.rollover ? ' · přenáší se' : '' }}
                </span>
              </span>
            </label>
            <input
              class="count"
              type="number"
              min="1"
              max="7"
              :value="task.target"
              @change="patchTask(task, { target: Math.max(1, Number(($event.target as HTMLInputElement).value)) })"
            />
            <button class="btn btn-sm btn-ghost" aria-label="Smazat úkol" @click="removeTask(task.id)">✕</button>
          </li>
        </ul>
        <div class="row" style="gap: 8px; margin-top: 12px">
          <input v-model="newTask" type="text" placeholder="Nový úkol…" @keyup.enter="addTask" />
          <button class="btn btn-sm btn-primary" :disabled="!newTask.trim()" @click="addTask">Přidat</button>
        </div>
      </section>

      <!-- Notifikace -------------------------------------------------- -->
      <section class="card">
        <div class="card-title">Notifikace</div>

        <div v-if="blockedReason" class="notice">
          {{ blockedReason }}
          <div v-if="isIos() && !isStandalone()" class="tiny" style="margin-top: 6px">
            Tlačítko Sdílet (čtvereček se šipkou nahoru) → Přidat na plochu → otevřít appku z ikony.
          </div>
        </div>

        <div class="stack-sm">
          <div class="grid3">
            <div class="field">
              <label for="t0">Ráno</label>
              <input id="t0" v-model="s.notifications.blockTimes[0]" type="time" />
            </div>
            <div class="field">
              <label for="t1">Poledne</label>
              <input id="t1" v-model="s.notifications.blockTimes[1]" type="time" />
            </div>
            <div class="field">
              <label for="t2">Večer</label>
              <input id="t2" v-model="s.notifications.blockTimes[2]" type="time" />
            </div>
          </div>

          <div class="grid2">
            <div class="field">
              <label for="tstep">Kontrola kroků</label>
              <input id="tstep" v-model="s.notifications.stepCheckTime" type="time" />
            </div>
            <div class="field">
              <label for="teve">Večerní shrnutí</label>
              <input id="teve" v-model="s.notifications.eveningReviewTime" type="time" />
            </div>
          </div>

          <div class="field">
            <label for="thr">Šťouchnout, když mám míň než {{ s.notifications.stepCheckThreshold }} % denní porce</label>
            <input id="thr" v-model.number="s.notifications.stepCheckThreshold" type="range" min="20" max="100" step="5" />
          </div>

          <div class="grid2">
            <div class="field">
              <label for="qf">Noční klid od</label>
              <input id="qf" v-model="s.notifications.quietFrom" type="time" />
            </div>
            <div class="field">
              <label for="qt">do</label>
              <input id="qt" v-model="s.notifications.quietTo" type="time" />
            </div>
          </div>

          <div class="field">
            <label for="tone">Tón hlášek</label>
            <select id="tone" v-model="s.notifications.tone">
              <option value="kind">Vlídný</option>
              <option value="coach">Trenér (výchozí)</option>
              <option value="drsny">Drsný</option>
            </select>
          </div>

          <button
            v-if="!pushActive"
            class="btn btn-primary btn-block"
            :disabled="pushBusy || !!blockedReason || !isServerConfigured()"
            @click="turnOnPush"
          >
            Zapnout notifikace
          </button>
          <button v-else class="btn btn-ghost btn-block" :disabled="pushBusy" @click="turnOffPush">
            Vypnout notifikace
          </button>

          <div class="grid2">
            <button class="btn btn-sm btn-ghost" :disabled="!isServerConfigured()" @click="testPush">
              Test ze serveru
            </button>
            <button class="btn btn-sm btn-ghost" :disabled="permission !== 'granted'" @click="testLocal">
              Test lokálně
            </button>
          </div>

          <p v-if="pushMessage" class="small muted">{{ pushMessage }}</p>

          <p v-if="!isServerConfigured()" class="tiny faint">
            Naplánované notifikace potřebují server – bez něj neexistuje způsob, jak na iPhonu spustit
            upozornění v konkrétní čas, když je appka zavřená. Nastav server níž.
          </p>
        </div>
      </section>

      <!-- Server ------------------------------------------------------ -->
      <section class="card">
        <div class="card-title">Server</div>
        <div class="stack-sm">
          <div class="field">
            <label for="url">Adresa</label>
            <input id="url" v-model="s.server.baseUrl" type="url" inputmode="url" placeholder="https://henry.tvujserver.cz" autocapitalize="off" autocorrect="off" />
          </div>
          <div class="field">
            <label for="token">Token</label>
            <input id="token" v-model="s.server.token" type="password" placeholder="z výstupu npm run keys" autocapitalize="off" autocorrect="off" />
          </div>
          <div class="row wrap" style="gap: 8px">
            <button class="btn btn-sm btn-ghost" :disabled="!s.server.baseUrl" @click="testServer">Otestovat spojení</button>
            <button class="btn btn-sm btn-ghost" :disabled="!isServerConfigured() || syncing" @click="doSync">
              {{ syncing ? 'Synchronizuji…' : 'Synchronizovat' }}
            </button>
          </div>
          <p v-if="serverStatus" class="small muted">{{ serverStatus }}</p>
          <p v-if="s.server.lastSyncAt" class="tiny faint">
            Poslední synchronizace: {{ new Date(s.server.lastSyncAt).toLocaleString('cs-CZ') }}
          </p>
          <p class="tiny faint">
            Se serverem se drží i tvoje data – kroky, cvičení, úkoly i míry. Když si Henryho otevřeš
            na druhém zařízení, uvidíš tam totéž. Slučuje se po záznamech, takže ranní odškrtnutý
            blok z telefonu a odpolední zápis kroků z notebooku přežijí oba.
          </p>
        </div>
      </section>

      <!-- Verze na serveru -------------------------------------------- -->
      <section v-if="isServerConfigured()" class="card">
        <div class="card-title">Verze na serveru</div>
        <p class="tiny faint" style="margin-bottom: 10px">
          Server si po každé synchronizaci odkládá stav stranou. Když si něco rozbiješ – naimportuješ
          starou zálohu, vyhlásíš bankrot, smažeš měření – dá se vrátit sem.
        </p>
        <button class="btn btn-sm btn-ghost" @click="loadVersions">Načíst verze</button>
        <ul v-if="versions.length" class="list-reset stack-sm" style="margin-top: 10px">
          <li v-for="v in versions.slice(0, 10)" :key="v.rev" class="row-between version">
            <span class="small">
              {{ new Date(v.at).toLocaleString('cs-CZ') }}
              <span class="tiny faint">· {{ v.records }} záznamů</span>
            </span>
            <button
              class="btn btn-sm"
              :class="confirmVersion === v.rev ? 'btn-danger' : 'btn-ghost'"
              @click="doRestore(v.rev)"
            >
              {{ confirmVersion === v.rev ? 'Opravdu vrátit?' : 'Vrátit' }}
            </button>
          </li>
        </ul>
        <p v-if="versionMessage" class="small muted" style="margin-top: 8px">{{ versionMessage }}</p>
      </section>

      <!-- Data -------------------------------------------------------- -->
      <section class="card">
        <div class="card-title">Data</div>
        <p v-if="isServerConfigured()" class="tiny faint" style="margin-bottom: 10px">
          Data žijí v telefonu a zároveň se drží na serveru, takže výměnu telefonu přežijí.
          Záloha do souboru je navíc – hodí se, než server rozjedeš, a jako pojistka mimo něj.
        </p>
        <p v-else class="tiny faint" style="margin-bottom: 10px">
          Všechno je uložené jen v tomhle telefonu. Když smažeš ikonu z plochy, data zmizí s ní.
          Než rozjedeš server, je stažená záloha jediná pojistka – dělej si ji.
        </p>
        <div class="row wrap" style="gap: 8px">
          <button class="btn btn-sm btn-ghost" @click="download">Stáhnout zálohu</button>
          <button class="btn btn-sm btn-ghost" @click="copyToClipboard">Zkopírovat</button>
        </div>
        <details style="margin-top: 12px">
          <summary class="small muted" style="cursor: pointer">Obnovit ze zálohy</summary>
          <textarea v-model="importText" placeholder="Sem vlož obsah zálohy…" style="margin-top: 8px" />
          <button class="btn btn-sm btn-primary" :disabled="!importText.trim()" @click="doImport">Obnovit</button>
        </details>
        <p v-if="dataMessage" class="small muted" style="margin-top: 8px">{{ dataMessage }}</p>

        <div class="divider" style="margin: 14px 0" />
        <p v-if="isServerConfigured()" class="tiny c-warn" style="margin-bottom: 8px">
          Smazání platí jen pro tenhle telefon. Data zůstanou na serveru a při první synchronizaci
          se vrátí zpátky – když je chceš pryč nadobro, smaž je i tam.
        </p>
        <button v-if="!confirmReset" class="btn btn-sm btn-ghost" @click="confirmReset = true">Smazat všechno</button>
        <div v-else class="row" style="gap: 8px">
          <button class="btn btn-sm btn-danger grow" @click="resetAll">Opravdu smazat</button>
          <button class="btn btn-sm btn-ghost" @click="confirmReset = false">Zpět</button>
        </div>
      </section>

      <p class="tiny faint center">
        Henry · osobní věc, žádné účty, žádné sledování.<br />
        Cviky vycházejí z doporučení ACSM, prací Stuarta McGilla a metaanalýz k protahování.
      </p>
    </div>
  </main>
</template>

<style scoped>
.version + .version { border-top: 1px solid var(--border); padding-top: 6px; }

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }

.toggle {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 0.9rem;
  cursor: pointer;
}

.toggle input {
  width: 20px;
  height: 20px;
  min-height: 0;
  margin-top: 2px;
  accent-color: var(--accent);
  flex-shrink: 0;
}

.block { display: block; }

.dist { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }

.dist-col { display: flex; flex-direction: column; align-items: center; gap: 3px; }

.dist-col input {
  min-height: 42px;
  padding: 4px 2px;
  text-align: center;
  /* Pod 16 px iOS při fokusu zazoomuje celou stránku. */
  font-size: 16px;
}

.task-edit { display: flex; align-items: center; gap: 8px; }

.count {
  width: 52px;
  min-height: 36px;
  padding: 4px;
  text-align: center;
  flex-shrink: 0;
}

.notice {
  padding: 11px 13px;
  border-radius: 12px;
  background: var(--info-soft);
  font-size: 0.85rem;
  margin-bottom: 12px;
}
</style>
