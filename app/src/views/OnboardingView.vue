<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { num, parseNumber } from '@/lib/format'
import { saveMeasurement, state, today } from '@/stores/app'

/**
 * Úvodní průvodce.
 *
 * Hlavní důvod, proč tu je: cíl kroků se nemá nastavit od stolu. Sedavý
 * dospělý má běžně 3–5 tisíc kroků denně a skok rovnou na deset tisíc je
 * nejrychlejší cesta k tomu appku po týdnu smazat. Ptáme se proto, kolik
 * uživatel chodí *teď*, a první cíl je jen o desetinu výš.
 */

const router = useRouter()

const STEPS = ['intro', 'jmeno', 'kroky', 'uroven', 'bloky', 'casy', 'mira', 'hotovo'] as const
const step = ref(0)

const name = ref(state.settings.name)
/** Odhad současného denního průměru. */
const baseline = ref(4000)
const level = ref<1 | 2 | 3>(1)
const blocksPerDay = ref(3)
const times = ref([...state.settings.notifications.blockTimes])
const toeTouch = ref('')
const weight = ref('')

const progress = computed(() => (step.value / (STEPS.length - 1)) * 100)

/**
 * První týdenní cíl: o desetinu víc, než kolik uživatel chodí teď,
 * zaokrouhleno na půltisíce, aby to bylo lidské číslo.
 *
 * Schválně se neomezuje shora metou 49 000. Kdo už teď chodí deset tisíc
 * denně, dostal by cíl NIŽŠÍ, než kolik reálně nachodí – a průvodce by u toho
 * tvrdil, že je to „o desetinu víc“.
 */
const firstTarget = computed(() => {
  const rounded = Math.round((baseline.value * 7 * 1.1) / 500) * 500
  return Math.max(14_000, rounded)
})

/** Splňuje uživatel doporučených 7 000 kroků denně už teď? */
const alreadyAtGoal = computed(() => baseline.value * 7 >= state.settings.steps.goalWeeklyTarget)

function next(): void {
  if (step.value < STEPS.length - 1) step.value++
}

function back(): void {
  if (step.value > 0) step.value--
}

/** Desetinná čárka musí projít – proto text s desetinnou klávesnicí. */
function numberOrUndefined(value: string): number | undefined {
  return parseNumber(value) ?? undefined
}

function finish(): void {
  const s = state.settings
  s.name = name.value.trim()
  s.steps.weeklyTarget = firstTarget.value
  // Meta nemůže být pod aktuálním cílem, jinak by automatické zvyšování
  // nemělo kam růst a rovnou by se vyplo.
  s.steps.goalWeeklyTarget = Math.max(s.steps.goalWeeklyTarget, firstTarget.value)
  s.exercise.level = level.value
  s.exercise.blocksPerDay = blocksPerDay.value
  s.notifications.blockTimes = [...times.value]
  s.startDate = today.value
  s.onboardedAt = new Date().toISOString()

  const toe = numberOrUndefined(toeTouch.value)
  const kg = numberOrUndefined(weight.value)
  if (toe !== undefined || kg !== undefined) {
    saveMeasurement({ date: today.value, toeTouchCm: toe, weightKg: kg })
  }

  void router.replace('/')
}

function skipAll(): void {
  state.settings.onboardedAt = new Date().toISOString()
  state.settings.startDate = today.value
  void router.replace('/')
}

const LEVELS = [
  { value: 1 as const, title: 'Začínám', detail: 'Roky nic, nebo jen občas. Míň sérií, lehčí varianty.' },
  { value: 2 as const, title: 'Něco už umím', detail: 'Občas si zacvičím, prkno chvíli udržím.' },
  { value: 3 as const, title: 'Jsem v kondici', detail: 'Cvičím pravidelně, chci to náročnější.' },
]
</script>

<template>
  <main class="wizard">
    <div class="bar"><div class="bar-fill" :style="{ width: `${progress}%` }" /></div>

    <div class="body">
      <Transition name="fade" mode="out-in">
        <!-- 0 – uvítání ------------------------------------------------ -->
        <section v-if="STEPS[step] === 'intro'" key="intro" class="step">
          <div class="mark">
            <svg viewBox="0 0 512 512" aria-hidden="true">
              <rect x="96" y="312" width="84" height="104" rx="26" />
              <rect x="214" y="236" width="84" height="180" rx="26" />
              <rect x="332" y="160" width="84" height="256" rx="26" />
              <circle cx="374" cy="106" r="30" />
            </svg>
          </div>
          <h1>Ahoj, já jsem Henry.</h1>
          <p class="muted">
            Budu tě otravovat s krokama, patnáctiminutovým cvičením třikrát denně a s tím,
            aby ses jednou dohrabal rukama na zem.
          </p>
          <ul class="facts">
            <li><span>🎯</span> Týden je jeden hrnec. Co dneska nedochodíš, rozpustí se do zbytku týdne.</li>
            <li><span>🧯</span> Dluh má strop. Nejhorší možný scénář jsou dva dny navíc, ne nesplatitelná hypotéka.</li>
            <li><span>🛟</span> Jeden vynechaný den sérii neshodí. Na to je milost.</li>
          </ul>
          <p class="tiny faint">Nastavení zabere minutu a všechno jde později změnit.</p>
        </section>

        <!-- 1 – jméno --------------------------------------------------- -->
        <section v-else-if="STEPS[step] === 'jmeno'" key="jmeno" class="step">
          <div class="eyebrow">Krok 1 ze 6</div>
          <h1>Jak ti mám říkat?</h1>
          <p class="muted">Objeví se to v notifikacích. Nech prázdné, jestli ti to leze na nervy.</p>
          <input v-model="name" type="text" maxlength="40" placeholder="Třeba Martine" @keyup.enter="next" />
        </section>

        <!-- 2 – kroky --------------------------------------------------- -->
        <section v-else-if="STEPS[step] === 'kroky'" key="kroky" class="step">
          <div class="eyebrow">Krok 2 ze 6</div>
          <h1>Kolik teď nachodíš denně?</h1>
          <p class="muted">
            Odhadni to podle hodinek nebo od oka. Nejde o to, kolik bys chtěl – jde o to,
            odkud startuješ.
          </p>

          <div class="picker">
            <div class="display num">{{ num(baseline) }}</div>
            <div class="tiny faint">kroků denně</div>
            <input v-model.number="baseline" type="range" min="1500" max="12000" step="250" />
            <div class="row-between tiny faint">
              <span>skoro nechodím</span>
              <span>hodně chodím</span>
            </div>
          </div>

          <div class="callout">
            <div class="strong">První cíl: {{ num(firstTarget) }} kroků týdně</div>
            <div class="tiny muted">
              To je {{ num(Math.round(firstTarget / 7)) }} denně, jen o desetinu víc než teď.
              <template v-if="alreadyAtGoal">
                Doporučených 7 000 denně už splňuješ, takže se laťka dál sama zvedat nebude –
                nastavit se to dá kdykoli ručně.
              </template>
              <template v-else>
                Po každém splněném týdnu se zvedne o 500 kroků denně, až na 7 000 –
                číslo, za kterým se zdravotní přínos už jen mírně ohýbá.
              </template>
            </div>
          </div>
        </section>

        <!-- 3 – úroveň -------------------------------------------------- -->
        <section v-else-if="STEPS[step] === 'uroven'" key="uroven" class="step">
          <div class="eyebrow">Krok 3 ze 6</div>
          <h1>Jak jsi na tom s cvičením?</h1>
          <div class="stack-sm">
            <button
              v-for="option in LEVELS"
              :key="option.value"
              class="choice"
              :class="{ on: level === option.value }"
              @click="level = option.value"
            >
              <span class="grow">
                <span class="strong">{{ option.title }}</span>
                <span class="tiny muted">{{ option.detail }}</span>
              </span>
              <span class="tick" />
            </button>
          </div>
        </section>

        <!-- 4 – bloky --------------------------------------------------- -->
        <section v-else-if="STEPS[step] === 'bloky'" key="bloky" class="step">
          <div class="eyebrow">Krok 4 ze 6</div>
          <h1>Kolik bloků denně zvládneš?</h1>
          <p class="muted">
            Blok je patnáct minut. Tři jsou ideál – ráno rozhýbání, v poledne core,
            večer protahování. Ale dva poctivé jsou lepší než tři odflákané.
          </p>
          <div class="segmented">
            <button
              v-for="n in 3"
              :key="n"
              :aria-pressed="blocksPerDay === n"
              @click="blocksPerDay = n"
            >
              {{ n }}× denně
            </button>
          </div>
          <p class="tiny faint">
            Při {{ blocksPerDay }} blocích to je {{ blocksPerDay * 15 }} minut denně.
          </p>
        </section>

        <!-- 5 – časy ---------------------------------------------------- -->
        <section v-else-if="STEPS[step] === 'casy'" key="casy" class="step">
          <div class="eyebrow">Krok 5 ze 6</div>
          <h1>Kdy ti to mám připomenout?</h1>
          <p class="muted">Vyber časy, kdy máš reálně patnáct minut. Změnit to jde kdykoli.</p>
          <div class="stack-sm">
            <div v-for="i in blocksPerDay" :key="i" class="field">
              <label :for="`t${i}`">{{ ['Ráno', 'Poledne', 'Večer'][i - 1] }}</label>
              <input :id="`t${i}`" v-model="times[i - 1]" type="time" />
            </div>
          </div>
          <p class="tiny faint">
            Aby notifikace opravdu chodily, je potřeba appku přidat na plochu a nastavit server –
            to tě provedu později v Nastavení.
          </p>
        </section>

        <!-- 6 – míra ---------------------------------------------------- -->
        <section v-else-if="STEPS[step] === 'mira'" key="mira" class="step">
          <div class="eyebrow">Krok 6 ze 6</div>
          <h1>Změř se, ať je od čeho počítat</h1>
          <p class="muted">
            Postav se, kolena rovně, a sáhni si na špičky. Kolik centimetrů ti chybí na zem?
            Odhadni to, přesnost teď není důležitá – důležité je mít výchozí bod.
          </p>
          <div class="field">
            <label for="toe">Chybí mi na zem (cm)</label>
            <input id="toe" v-model="toeTouch" type="text" inputmode="decimal" placeholder="např. 15" />
          </div>
          <div class="field">
            <label for="w">Váha (kg) – nepovinné</label>
            <input id="w" v-model="weight" type="text" inputmode="decimal" placeholder="např. 92,4" />
          </div>
          <p class="tiny faint">
            Měř jednou za dva týdny, ne denně. Rozsah kolísá o 3–5 cm podle denní doby,
            takže denní měření měří hlavně náladu.
          </p>
        </section>

        <!-- 7 – hotovo -------------------------------------------------- -->
        <section v-else key="hotovo" class="step center-step">
          <div class="big-emoji">🚀</div>
          <h1>Můžeme začít</h1>
          <p class="muted">
            Cíl {{ num(firstTarget) }} kroků na tenhle týden a {{ blocksPerDay }}× denně patnáct minut.
            Zbytek Henry pohlídá.
          </p>
        </section>
      </Transition>
    </div>

    <footer class="foot">
      <button v-if="step > 0" class="btn btn-ghost" @click="back">Zpět</button>
      <button v-if="STEPS[step] !== 'hotovo'" class="btn btn-primary grow btn-lg" @click="next">
        {{ step === 0 ? 'Jdeme na to' : 'Dál' }}
      </button>
      <button v-else class="btn btn-primary grow btn-lg" @click="finish">Spustit Henryho</button>
      <button v-if="step === 0" class="btn btn-ghost" @click="skipAll">Přeskočit</button>
    </footer>
  </main>
</template>

<style scoped>
.wizard {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.bar { height: 3px; background: var(--surface-2); }
.bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.4s var(--ease);
}

.body {
  flex: 1;
  width: 100%;
  max-width: var(--page-max);
  margin: 0 auto;
  padding: calc(var(--safe-top) + 28px) 20px 20px;
  display: flex;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.center-step {
  justify-content: center;
  text-align: center;
  align-items: center;
}

.big-emoji { font-size: 3.6rem; }

.mark {
  width: 58px;
  height: 58px;
  border-radius: 17px;
  background: var(--accent-soft);
  display: grid;
  place-items: center;
  margin-bottom: 4px;
}

.mark svg { width: 32px; height: 32px; fill: var(--accent); }

.facts {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.facts li {
  display: flex;
  gap: 11px;
  font-size: 0.9rem;
  color: var(--text-dim);
  line-height: 1.5;
}

.facts span { font-size: 1.15rem; line-height: 1.2; }

.picker {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 20px 16px 14px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.picker .display { color: var(--accent); }
.picker input[type='range'] { margin-top: 8px; }

.callout {
  padding: 14px;
  border-radius: var(--r);
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
}

.choice {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 15px;
  text-align: left;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r);
  cursor: pointer;
  transition: border-color 0.18s var(--ease), background 0.18s var(--ease);
}

.choice.on { border-color: var(--accent); background: var(--accent-soft); }

.choice .grow { display: flex; flex-direction: column; gap: 2px; }

.tick {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  transition: background 0.18s var(--ease), border-color 0.18s var(--ease);
}

.choice.on .tick {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: inset 0 0 0 3.5px var(--surface);
}

.foot {
  display: flex;
  gap: 10px;
  width: 100%;
  max-width: var(--page-max);
  margin: 0 auto;
  padding: 12px 20px calc(var(--safe-bottom) + 20px);
}
</style>
