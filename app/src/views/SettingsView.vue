<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  changePassword,
  checkHealth,
  createInvite,
  createToken,
  fetchPasskeys,
  fetchSessions,
  fetchTokens,
  fetchVersions,
  restoreVersion,
  revokeOtherSessions,
  revokePasskey,
  revokeSession,
  revokeToken,
  sendTestPush,
  setAccountName,
  type ApiTokenInfo,
  type DeviceSession,
  type PasskeyInfo,
  type StateVersion,
} from '@/lib/api'
import { account, passkeysAvailable, signOut } from '@/stores/auth'
import { addPasskey, PasskeyCancelled, platformPasskeyAvailable } from '@/lib/passkey'
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
import { exportJson, importJson, resetAll, state } from '@/stores/app'
import WeeklyTasks from '@/components/WeeklyTasks.vue'
import DayBlocks from '@/components/DayBlocks.vue'
import { blocksPerDay } from '@/lib/plan'

const s = computed(() => state.settings)

/* Kroky ---------------------------------------------------------------- */

/** Chybějící hodnota znamená zapnuto – viz komentář v přehrávači. */
const soundOn = computed({
  get: () => s.value.exercise.sound !== false,
  set: (value: boolean) => (s.value.exercise.sound = value),
})

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
const maxBlockCap = computed(() => Math.max(0, blocksPerDay(state) * 7 - weeklyBlocks.value))
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


/* Notifikace ------------------------------------------------------------ */

const pushActive = ref(false)
const pushMessage = ref('')
const pushBusy = ref(false)

onMounted(async () => {
  pushActive.value = await hasPushSubscription()
  hasPlatformAuthenticator.value = await platformPasskeyAvailable()
  void loadAccountDetails()
})

const blockedReason = computed(() => pushBlockedReason())
const permission = computed(() => notificationPermission())

async function turnOnPush(): Promise<void> {
  // POZOR: žádný await před tímhle voláním. Safari povolí dotaz na notifikace
  // jen během reakce na dotek a `await` to „uživatelské gesto“ spotřebuje.
  pushBusy.value = true
  pushMessage.value = ''
  const result = await enablePush()
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
  await disablePush()
  pushActive.value = false
  s.value.notifications.enabled = false
  pushBusy.value = false
  pushMessage.value = 'Vypnuto.'
  void syncNow(true)
}

async function testPush(): Promise<void> {
  pushMessage.value = 'Posílám…'
  try {
    const result = await sendTestPush()
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

/* Účet ------------------------------------------------------------------- */

const accountMessage = ref('')
const heslo = ref({ current: '', next: '' })
const sessions = ref<DeviceSession[]>([])
const tokens = ref<ApiTokenInfo[]>([])
const newToken = ref('')
const invite = ref('')

/* Face ID / Touch ID */
const passkeys = ref<PasskeyInfo[]>([])
const passkeyMessage = ref('')
const passkeyBusy = ref(false)
/** Má tohle zařízení vlastní biometriku? Bez ní by nabídka jen mátla. */
const hasPlatformAuthenticator = ref(false)

async function loadAccountDetails(): Promise<void> {
  try {
    // `?? []` schválně: neočekávaná odpověď (proxy, přihlášení vypršelo)
    // nesmí shodit celou obrazovku nastavení kvůli jednomu seznamu.
    sessions.value = (await fetchSessions()).sessions ?? []
    tokens.value = (await fetchTokens()).tokens ?? []
    passkeys.value = (await fetchPasskeys()).passkeys ?? []
  } catch (err) {
    accountMessage.value = (err as Error).message
  }
}

/**
 * Přidá tomuhle zařízení klíč pro přihlášení. Popisek se bere z účtu
 * a zařízení, ať se v seznamu dá poznat, který klíč je který.
 */
async function addFaceId(): Promise<void> {
  passkeyBusy.value = true
  passkeyMessage.value = ''
  try {
    const passkey = await addPasskey(deviceName())
    passkeyMessage.value = passkey.backedUp
      ? 'Hotovo. Klíč je zálohovaný, takže ho najdeš i na dalších svých zařízeních.'
      : 'Hotovo. Klíč platí jen pro tohle zařízení.'
    await loadAccountDetails()
  } catch (err) {
    // Zavřené okno s Face ID není chyba – člověk si to jen rozmyslel.
    if (!(err instanceof PasskeyCancelled)) passkeyMessage.value = (err as Error).message
  } finally {
    passkeyBusy.value = false
  }
}

async function dropPasskey(id: string): Promise<void> {
  await revokePasskey(id)
  passkeyMessage.value = 'Klíč odebraný.'
  await loadAccountDetails()
}

/** Hrubý odhad zařízení – slouží jen k rozlišení řádků v seznamu. */
function deviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android'
  if (/Macintosh/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows'
  return 'Tohle zařízení'
}

async function doChangePassword(): Promise<void> {
  accountMessage.value = 'Měním…'
  try {
    const { revoked } = await changePassword(heslo.value.current, heslo.value.next)
    heslo.value = { current: '', next: '' }
    accountMessage.value =
      revoked > 0 ? `Heslo změněné, odhlásil jsem ${revoked} další zařízení.` : 'Heslo změněné.'
    await loadAccountDetails()
  } catch (err) {
    accountMessage.value = (err as Error).message
  }
}

async function doRevokeSession(id: string): Promise<void> {
  await revokeSession(id)
  await loadAccountDetails()
}

async function doRevokeOthers(): Promise<void> {
  const { revoked } = await revokeOtherSessions()
  accountMessage.value = `Odhlášeno ${revoked} zařízení.`
  await loadAccountDetails()
}

async function makeInvite(): Promise<void> {
  try {
    invite.value = (await createInvite()).code
  } catch (err) {
    accountMessage.value = (err as Error).message
  }
}

async function makeToken(): Promise<void> {
  try {
    newToken.value = (await createToken('Zkratka')).token
    await loadAccountDetails()
  } catch (err) {
    accountMessage.value = (err as Error).message
  }
}

async function dropToken(id: string): Promise<void> {
  await revokeToken(id)
  await loadAccountDetails()
}

/** Jméno se drží v datech i na účtu – ať sedí i v notifikacích. */
async function saveName(): Promise<void> {
  try {
    await setAccountName(s.value.name)
  } catch {
    // Jméno v appce funguje i bez serveru; příště se dorovná.
  }
}

/* Server ---------------------------------------------------------------- */

const serverStatus = ref('')

async function testServer(): Promise<void> {
  serverStatus.value = 'Zkouším…'
  try {
    const health = await checkHealth()
    serverStatus.value = `Server žije. Čas ${Math.floor(health.now.minutes / 60)}:${String(health.now.minutes % 60).padStart(2, '0')}, plánovač ${health.scheduler ? 'běží' : 'stojí'}.`
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
    const data = await fetchVersions()
    versions.value = data.versions ?? []
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
    await restoreVersion(rev)
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
          <input id="name" v-model="s.name" @change="saveName" type="text" placeholder="nepovinné" maxlength="40" />
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
            <label>Rozvržení dne</label>
            <DayBlocks />
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
              Za týden zvládneš nejvýš {{ blocksPerDay(state) * 7 }} bloků a
              {{ weeklyBlocks }} jich je povinných, takže se dá přenést nanejvýš
              {{ maxBlockCap }}. Vyšší strop by vyrobil dluh, který nejde splatit.
            </div>
          </div>

          <label class="toggle">
            <input v-model="soundOn" type="checkbox" />
            <span>
              Pípání při cvičení
              <span class="tiny faint block">
                Poslední tři vteřiny odpočtu ťuknou, konec série klesne, konec pauzy stoupne.
                U notebooku je tak slyšet, kdy série skončila, bez koukání na displej. Přepnout
                jde i přímo v přehrávači.
              </span>
            </span>
          </label>

          <RouterLink to="/cviky" class="row-between nav-row">
            <span class="small">
              🏋 Které cviky chci
              <span class="tiny faint block">
                {{ EXERCISES.length }} v katalogu, {{ s.exercise.excludedExerciseIds.length }}
                vyřazených
              </span>
            </span>
            <span class="faint" aria-hidden="true">›</span>
          </RouterLink>
        </div>
      </section>

      <!-- Týdenní úkoly ----------------------------------------------- -->
      <WeeklyTasks />

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
          <!-- Popisky se berou z rozvržení dne. Kdyby tu zůstalo natvrdo
               „Ráno / Poledne / Večer", přejmenovaný blok by měl v nastavení
               dvě různá jména. Vypnuté bloky se nepřipomínají, takže se tu
               ani neukazují. -->
          <div class="grid3">
            <div v-for="block in s.exercise.blocks.filter((b) => b.enabled)" :key="block.slot" class="field">
              <label :for="`t${block.slot}`">{{ block.emoji }} {{ block.title }}</label>
              <input :id="`t${block.slot}`" v-model="s.notifications.blockTimes[block.slot]" type="time" />
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
            Naplánované notifikace posílá server – bez něj neexistuje způsob, jak na iPhonu spustit
            upozornění v konkrétní čas, když je appka zavřená.
          </p>
        </div>
      </section>

      <!-- Účet -------------------------------------------------------- -->
      <section class="card">
        <div class="card-title">Účet</div>
        <div class="stack-sm">
          <p class="small">
            Přihlášený jako <span class="strong">{{ account?.email }}</span>
          </p>

          <details :open="passkeys.length === 0">
            <summary class="small muted" style="cursor: pointer">
              Přihlášení přes Face ID ({{ passkeys.length }})
            </summary>
            <div class="stack-sm" style="margin-top: 8px">
              <p class="tiny faint">
                Klíč zůstane v telefonu (Secure Enclave) a server dostane jen jeho veřejnou
                polovinu – není co ukrást ani co zapomenout. Heslo si nech: je to záchrana pro
                nové zařízení a pro případ, že o telefon přijdeš.
              </p>
              <p v-if="!passkeysAvailable" class="tiny c-danger">
                Tenhle prohlížeč passkeys neumí. Na iPhonu to jde v Safari a v appce spuštěné
                z plochy, ne v Chromu.
              </p>
              <p v-else-if="!hasPlatformAuthenticator" class="tiny faint">
                Tohle zařízení nemá vlastní biometriku – klíč půjde vyrobit jen na bezpečnostním
                klíči nebo přes telefon.
              </p>
              <button
                class="btn btn-sm btn-primary"
                :disabled="!passkeysAvailable || passkeyBusy"
                @click="addFaceId"
              >
                {{ passkeyBusy ? 'Čekám na ověření…' : 'Nastavit na tomhle zařízení' }}
              </button>
              <p v-if="passkeyMessage" class="tiny muted">{{ passkeyMessage }}</p>
              <ul v-if="passkeys.length" class="list-reset stack-sm">
                <li v-for="k in passkeys" :key="k.id" class="row-between version">
                  <span class="small">
                    {{ k.label }}
                    <span class="tiny faint">
                      ·
                      {{
                        k.lastUsedAt
                          ? `naposledy ${new Date(k.lastUsedAt).toLocaleDateString('cs-CZ')}`
                          : 'zatím nepoužitý'
                      }}
                      <template v-if="k.backedUp">· zálohovaný</template>
                    </span>
                  </span>
                  <button class="btn btn-sm btn-ghost" @click="dropPasskey(k.id)">Odebrat</button>
                </li>
              </ul>
              <p class="tiny faint">
                Klíč platí pro adresu, na které Henry běží. Když server přestěhuješ na jinou
                doménu, budeš si ho tam muset nastavit znovu – proto to heslo.
              </p>
            </div>
          </details>

          <details>
            <summary class="small muted" style="cursor: pointer">Změnit heslo</summary>
            <div class="stack-sm" style="margin-top: 8px">
              <input v-model="heslo.current" type="password" placeholder="Stávající heslo" autocomplete="current-password" />
              <input v-model="heslo.next" type="password" placeholder="Nové heslo (aspoň 10 znaků)" autocomplete="new-password" />
              <button
                class="btn btn-sm btn-primary"
                :disabled="!heslo.current || heslo.next.length < 10"
                @click="doChangePassword"
              >
                Změnit heslo
              </button>
              <p class="tiny faint">Změna hesla odhlásí všechna ostatní zařízení.</p>
            </div>
          </details>

          <details>
            <summary class="small muted" style="cursor: pointer">
              Přihlášená zařízení ({{ sessions.length }})
            </summary>
            <ul class="list-reset stack-sm" style="margin-top: 8px">
              <li v-for="device in sessions" :key="device.id" class="row-between version">
                <span class="small">
                  {{ device.label || 'zařízení' }}
                  <span class="tiny faint">
                    · naposledy {{ new Date(device.lastSeenAt).toLocaleDateString('cs-CZ') }}
                    <template v-if="device.current">· tohle</template>
                  </span>
                </span>
                <button
                  v-if="!device.current"
                  class="btn btn-sm btn-ghost"
                  @click="doRevokeSession(device.id)"
                >
                  Odhlásit
                </button>
              </li>
            </ul>
            <button
              v-if="sessions.length > 1"
              class="btn btn-sm btn-ghost"
              style="margin-top: 8px"
              @click="doRevokeOthers"
            >
              Odhlásit všechna ostatní
            </button>
          </details>

          <RouterLink to="/health" class="row-between nav-row">
            <span class="small">
              📲 Kroky z Apple Health
              <span class="tiny faint block">Token, adresa i postup na jedné obrazovce</span>
            </span>
            <span class="faint" aria-hidden="true">›</span>
          </RouterLink>

          <details>
            <summary class="small muted" style="cursor: pointer">Token pro Zkratku</summary>
            <p class="tiny faint" style="margin: 8px 0">
              Zkratka z Apple Health neumí přihlášení cookie, takže potřebuje token. Ukáže se
              jednou – zkopíruj si ho hned, podruhé už ho nikdo nedostane.
            </p>
            <button class="btn btn-sm btn-ghost" @click="makeToken">Vytvořit token</button>
            <p v-if="newToken" class="mono small" style="margin-top: 8px; word-break: break-all">{{ newToken }}</p>
            <ul class="list-reset stack-sm" style="margin-top: 8px">
              <li v-for="t in tokens" :key="t.id" class="row-between version">
                <span class="small">
                  {{ t.label }}
                  <span class="tiny faint">
                    · {{ t.lastUsedAt ? `naposledy ${new Date(t.lastUsedAt).toLocaleDateString('cs-CZ')}` : 'zatím nepoužitý' }}
                  </span>
                </span>
                <button class="btn btn-sm btn-ghost" @click="dropToken(t.id)">Zrušit</button>
              </li>
            </ul>
          </details>

          <details>
            <summary class="small muted" style="cursor: pointer">Pozvat někoho dalšího</summary>
            <p class="tiny faint" style="margin: 8px 0">
              Registrace je zavřená – kdo se má dostat dovnitř, potřebuje kód. Platí týden
              a jen na jedno použití.
            </p>
            <button class="btn btn-sm btn-ghost" @click="makeInvite">Vytvořit pozvánku</button>
            <p v-if="invite" class="mono small" style="margin-top: 8px; word-break: break-all">{{ invite }}</p>
          </details>

          <p v-if="accountMessage" class="small muted">{{ accountMessage }}</p>

          <div class="divider" style="margin: 4px 0" />
          <div class="row wrap" style="gap: 8px">
            <button class="btn btn-sm btn-ghost" :disabled="syncing" @click="doSync">
              {{ syncing ? 'Synchronizuji…' : 'Synchronizovat' }}
            </button>
            <button class="btn btn-sm btn-ghost" @click="testServer">Stav serveru</button>
            <button class="btn btn-sm btn-ghost" @click="signOut">Odhlásit se</button>
          </div>
          <p v-if="serverStatus" class="small muted">{{ serverStatus }}</p>
          <p v-if="state.meta.syncedAt" class="tiny faint">
            Poslední synchronizace: {{ new Date(state.meta.syncedAt).toLocaleString('cs-CZ') }}
          </p>
        </div>
      </section>

      <!-- Verze na serveru -------------------------------------------- -->
      <section class="card">
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
/* Řádek, který vede jinam. Vypadá jako políčko nastavení, protože jím je –
   jen se jeho obsah nevejde na tuhle obrazovku. */
.nav-row {
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  background: var(--surface-2);
}

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

.notice {
  padding: 11px 13px;
  border-radius: 12px;
  background: var(--info-soft);
  font-size: 0.85rem;
  margin-bottom: 12px;
}
</style>
