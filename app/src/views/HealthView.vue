<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createToken, fetchTokens, pullSteps, revokeToken, type ApiTokenInfo } from '@/lib/api'
import { num } from '@/lib/format'

/**
 * Průvodce napojením Apple Health.
 *
 * Návod v repozitáři byl správně, ale k ničemu: dvě věci, které se musí
 * vlepit do Zkratky – adresa a token – v něm nebyly, protože je nikdo dopředu
 * nezná. Token se navíc vyráběl v nastavení účtu, tedy o dvě obrazovky dál
 * a bez souvislosti. Tady je všechno na jednom místě a k opsání není nic:
 * adresa se odvodí z toho, kde appka běží, tělo požadavku se poskládá samo
 * a všechno má tlačítko na zkopírování.
 */
const router = useRouter()

/** Adresa, na kterou Zkratka posílá. Bere se z toho, odkud appka běží. */
const endpoint = computed(() => `${window.location.origin}/api/ingest/steps`)

/**
 * Adresa platí jen na tomhle stroji.
 *
 * Zkratka běží v telefonu, ne tady – a `localhost` v telefonu znamená sám
 * telefon. Bez upozornění by to člověk celé poskládal a divil se, proč
 * odesílání skončí chybou spojení.
 */
const localOnly = computed(() =>
  ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
)

/**
 * Tělo požadavku. Hranaté závorky jsou místa pro proměnné ze Zkratek –
 * schválně, ať je vidět, co se kam vkládá.
 *
 * Jen jeden den, i když server jich zvládne víc najednou. Postup níž vyrábí
 * jednu proměnnou; kdyby jich tu byly čtyři, člověk by po kroku 4 zjistil,
 * že mu tři chybí, a nevěděl proč. Víc dní je v podrobném návodu.
 */
const body = `{"source":"shortcuts",
 "days":[{"date":"[DatumDnes]",
          "steps":[KrokyDnes]}]}`

/* ------------------------------------------------------------------ */
/*  Token                                                              */
/* ------------------------------------------------------------------ */

const tokens = ref<ApiTokenInfo[]>([])
const freshToken = ref('')
const busy = ref(false)
const error = ref('')

async function loadTokens(): Promise<void> {
  try {
    tokens.value = (await fetchTokens()).tokens ?? []
  } catch (err) {
    error.value = (err as Error).message
  }
}

async function makeToken(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    freshToken.value = (await createToken('Zkratka – Apple Health')).token
    await loadTokens()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function drop(id: string): Promise<void> {
  await revokeToken(id)
  if (!tokens.value.some((t) => t.id !== id)) freshToken.value = ''
  await loadTokens()
}

/* ------------------------------------------------------------------ */
/*  Kopírování                                                         */
/* ------------------------------------------------------------------ */

/** Co se právě zkopírovalo – ať je vidět, že klepnutí něco udělalo. */
const copied = ref('')

async function copy(what: string, value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    copied.value = what
    setTimeout(() => (copied.value = copied.value === what ? '' : copied.value), 1600)
  } catch {
    // Bez HTTPS schránka nefunguje. Text je vidět, takže se dá označit ručně.
    error.value = 'Zkopírovat nešlo – označ text a zkopíruj ho ručně.'
  }
}

/* ------------------------------------------------------------------ */
/*  Kontrola, jestli to jede                                           */
/* ------------------------------------------------------------------ */

/** Poslední den, kdy kroky dorazily ze Zkratky. Null = zatím nikdy. */
const lastFromShortcut = ref<{ date: string; steps: number } | null>(null)
const checking = ref(false)

async function check(): Promise<void> {
  checking.value = true
  error.value = ''
  try {
    const entries = await pullSteps(30)
    const fromShortcut = entries
      .filter((e) => e.source === 'shortcut' || e.source === 'shortcuts')
      .sort((a, b) => b.date.localeCompare(a.date))
    lastFromShortcut.value = fromShortcut[0] ?? null
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    checking.value = false
  }
}

onMounted(() => {
  void loadTokens()
  void check()
})

const hasToken = computed(() => tokens.value.length > 0)
</script>

<template>
  <main class="page">
    <header class="page-header">
      <button class="btn btn-sm btn-ghost" @click="router.back()">‹ Zpět</button>
    </header>

    <div class="stack">
      <section>
        <h1>Kroky z Apple Health</h1>
        <p class="muted small" style="margin-top: 4px">
          iPhone bude jednou denně sám posílat počet kroků. Skládá se to ve Zkratkách a zabere to
          asi deset minut – zdlouhavé je jen to klikání, nic složitého tu není.
        </p>
      </section>

      <!-- Stav ---------------------------------------------------------- -->
      <section class="card" :class="lastFromShortcut ? 'ok' : ''">
        <div class="row-between">
          <div class="card-title" style="margin: 0">Jak to vypadá</div>
          <button class="btn btn-sm btn-ghost" :disabled="checking" @click="check">
            {{ checking ? 'Koukám…' : 'Zkontrolovat' }}
          </button>
        </div>
        <p v-if="lastFromShortcut" class="small" style="margin: 8px 0 0">
          ✅ Jede to. Naposledy dorazilo <span class="strong">{{ num(lastFromShortcut.steps) }}</span>
          kroků za {{ lastFromShortcut.date }}.
        </p>
        <p v-else class="small muted" style="margin: 8px 0 0">
          Ze Zkratky zatím nic nedorazilo. Až ji poprvé spustíš, klepni sem na Zkontrolovat.
        </p>
      </section>

      <!-- 1. token ------------------------------------------------------ -->
      <section class="card">
        <div class="card-title">1. Token</div>
        <p class="tiny faint" style="margin: 0 0 10px">
          Zkratka se neumí přihlásit jako prohlížeč, potřebuje vlastní klíč. Ukáže se jednou –
          zkopíruj si ho rovnou do Zkratky. Zrušit ho jde kdykoli a heslo to nijak neovlivní.
        </p>

        <button v-if="!freshToken" class="btn btn-primary btn-block" :disabled="busy" @click="makeToken">
          {{ busy ? 'Moment…' : hasToken ? 'Vytvořit další token' : 'Vytvořit token' }}
        </button>

        <div v-else class="value">
          <code class="mono">{{ freshToken }}</code>
          <button class="btn btn-sm btn-primary" @click="copy('token', freshToken)">
            {{ copied === 'token' ? 'Zkopírováno' : 'Kopírovat' }}
          </button>
        </div>
        <p v-if="freshToken" class="tiny faint" style="margin-top: 8px">
          Až tuhle obrazovku opustíš, token už znovu neuvidíš. Kdyby ses o něj připravil, vyrob
          si nový a ten starý zruš.
        </p>

        <ul v-if="hasToken" class="list-reset stack-sm" style="margin-top: 10px">
          <li v-for="t in tokens" :key="t.id" class="row-between version">
            <span class="tiny">
              {{ t.label }}
              <span class="faint">
                ·
                {{
                  t.lastUsedAt
                    ? `naposledy ${new Date(t.lastUsedAt).toLocaleDateString('cs-CZ')}`
                    : 'zatím nepoužitý'
                }}
              </span>
            </span>
            <button class="btn btn-sm btn-ghost" @click="drop(t.id)">Zrušit</button>
          </li>
        </ul>
      </section>

      <!-- 2. co vlepit -------------------------------------------------- -->
      <section class="card">
        <div class="card-title">2. Co vlepit do Zkratky</div>

        <div class="field">
          <label>Adresa (URL)</label>
          <div class="value">
            <code class="mono small">{{ endpoint }}</code>
            <button class="btn btn-sm btn-ghost" @click="copy('url', endpoint)">
              {{ copied === 'url' ? 'Zkopírováno' : 'Kopírovat' }}
            </button>
          </div>
          <div v-if="localOnly" class="hint c-warn">
            Pozor: tuhle appku máš otevřenou přes <code>{{ endpoint.split('/')[2] }}</code>, což
            v telefonu znamená sám telefon. Otevři si Henryho na té adrese, na které ho máš
            v síti (nebo na doméně zvenku), a adresu si zkopíruj odtamtud – jinak Zkratka nebude
            mít kam poslat.
          </div>
        </div>

        <div class="field">
          <label>Hlavička</label>
          <div class="value">
            <code class="mono small">Authorization: Bearer {{ freshToken || 'TVŮJ_TOKEN' }}</code>
            <button
              class="btn btn-sm btn-ghost"
              :disabled="!freshToken"
              @click="copy('hlavicka', `Bearer ${freshToken}`)"
            >
              {{ copied === 'hlavicka' ? 'Zkopírováno' : 'Kopírovat' }}
            </button>
          </div>
          <div class="hint">
            Do Zkratky se to zadává jako dva sloupce: klíč <code>Authorization</code>, hodnota
            <code>Bearer</code> a mezera a token. Tlačítko zkopíruje rovnou tu hodnotu.
          </div>
        </div>

        <div class="field">
          <label>Tělo požadavku</label>
          <pre class="mono block">{{ body }}</pre>
          <button class="btn btn-sm btn-ghost" @click="copy('telo', body)">
            {{ copied === 'telo' ? 'Zkopírováno' : 'Kopírovat' }}
          </button>
          <div class="hint">
            Hranaté závorky jsou místa pro proměnné ze Zkratek – ty se tam vkládají z lišty nad
            klávesnicí, nepíšou se ručně. Datum musí být ve tvaru <code>2026-01-31</code>, tedy
            rok-měsíc-den; ve Zkratkách ho vyrobíš akcí <em>Formátovat datum</em> s vlastním
            formátem <code>yyyy-MM-dd</code>. Posílá se jeden den; jak přidat i včerejšek pro
            případ, že zkratka jeden večer nevyjde, je v podrobném návodu dole.
          </div>
        </div>
      </section>

      <!-- 3. postup ----------------------------------------------------- -->
      <section class="card">
        <div class="card-title">3. Postup ve Zkratkách</div>
        <ol class="steps">
          <li>Zkratky → <span class="strong">+</span> → přidej akci <em>Najdi vzorky zdraví</em>.</li>
          <li>
            Typ <span class="strong">Kroky</span>, filtr <em>Počáteční datum je dnes</em>, seskupit
            podle <span class="strong">Den</span>. To seskupení nevynechávej – bez něj zkratka
            dostane tisíce jednominutových vzorků místo jednoho součtu.
          </li>
          <li><em>Získej podrobnosti o vzorku zdraví</em> → <span class="strong">Hodnota</span>.</li>
          <li><em>Vypočítej statistiku</em> → <span class="strong">Součet</span>. Přejmenuj na <code>KrokyDnes</code>.</li>
          <li>
            Přidej akci <em>Text</em> a vlož do ní tělo požadavku z bodu 2. Proměnné doplň z lišty.
          </li>
          <li>
            <em>Získej obsah URL</em>: adresa z bodu 2, metoda <span class="strong">POST</span>,
            hlavička z bodu 2 a tělo nastav na <span class="strong">Soubor</span> s výstupem akce
            <em>Text</em>.
          </li>
          <li>
            <span class="strong">Spusť zkratku jednou ručně.</span> První běh se zeptá na přístup
            ke Zdraví a na odesílání na tvoji adresu – dopředu to povolit nejde. Kdybys rovnou
            zapnul automatizaci, uvázla by na tom.
          </li>
          <li>Zkratky → Automatizace → Denní doba → večer → spustit tuhle zkratku.</li>
        </ol>
        <p class="tiny faint" style="margin-top: 10px">
          Podrobná verze se všemi odbočkami (víc dní najednou, řešení problémů) je v repozitáři
          v <code>docs/apple-health.md</code>.
        </p>
      </section>

      <p v-if="error" class="small c-danger center">{{ error }}</p>

      <p class="tiny faint center">
        Nechce se ti to skládat? Kroky jde zapisovat ručně na obrazovce Kroky a appka funguje
        úplně stejně.
      </p>
    </div>
  </main>
</template>

<style scoped>
.card.ok {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  background: var(--accent-soft);
}

/* Hodnota k opsání: text se láme, tlačítko zůstává vedle. */
.value {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 8px 10px;
}

.value code {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

pre.block {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 10px;
  margin: 0 0 8px;
  font-size: 0.78rem;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
}

.steps li {
  margin-bottom: 8px;
}

/* Varování musí být vidět jako varování – `.field .hint` je jinak přebije
   svou vyšší specificitou a zůstala by z něj další šedá poznámka. */
.hint.c-warn {
  color: var(--warn);
}
</style>
