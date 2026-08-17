<script setup lang="ts">
import { computed, ref } from 'vue'
import LineChart from '@/components/LineChart.vue'
import { formatDayShort, relativeDayLabel } from '@/lib/date'
import { num } from '@/lib/format'
import { bestStreak, removeMeasurement, saveMeasurement, state, streak, today } from '@/stores/app'
import { measurementSeries } from '@/lib/engine'

/* Zápis nové míry ------------------------------------------------------ */

const form = ref({
  date: today.value,
  weightKg: '',
  waistCm: '',
  toeTouchCm: '',
  plankSec: '',
})

const showForm = ref(false)

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function save(): void {
  saveMeasurement({
    date: form.value.date,
    weightKg: numberOrUndefined(form.value.weightKg),
    waistCm: numberOrUndefined(form.value.waistCm),
    toeTouchCm: numberOrUndefined(form.value.toeTouchCm),
    plankSec: numberOrUndefined(form.value.plankSec),
  })
  form.value = { date: today.value, weightKg: '', waistCm: '', toeTouchCm: '', plankSec: '' }
  showForm.value = false
}

/* Grafy ---------------------------------------------------------------- */

const weight = computed(() => measurementSeries(state, 'weightKg'))
const waist = computed(() => measurementSeries(state, 'waistCm'))
const toeTouch = computed(() => measurementSeries(state, 'toeTouchCm'))
const plank = computed(() => measurementSeries(state, 'plankSec'))

const history = computed(() => [...state.measurements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12))

/* Souhrn --------------------------------------------------------------- */

const totalSteps = computed(() => Object.values(state.days).reduce((sum, d) => sum + d.steps, 0))
const totalBlocks = computed(() =>
  Object.values(state.days).reduce((sum, d) => sum + d.blocks.filter((b) => b.completedAt).length, 0),
)
const totalMinutes = computed(() => totalBlocks.value * state.settings.exercise.minutesPerBlock)

function toeTouchLabel(cm: number): string {
  if (cm > 0) return `${num(cm)} cm nad zemí`
  if (cm < 0) return `${num(Math.abs(cm))} cm pod úrovní chodidel`
  return 'přesně na zem'
}
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">Jak to jde</div>
        <h1>Pokrok</h1>
      </div>
      <button class="btn btn-sm btn-primary" @click="showForm = !showForm">
        {{ showForm ? 'Zavřít' : 'Změřit se' }}
      </button>
    </header>

    <div class="stack">
      <!-- Formulář ---------------------------------------------------- -->
      <section v-if="showForm" class="card">
        <div class="card-title">Nové měření</div>
        <div class="stack-sm">
          <div class="field">
            <label for="m-date">Datum</label>
            <input id="m-date" v-model="form.date" type="date" />
          </div>
          <div class="grid2">
            <div class="field">
              <label for="m-weight">Váha (kg)</label>
              <input id="m-weight" v-model="form.weightKg" type="number" inputmode="decimal" step="0.1" placeholder="např. 92,4" />
            </div>
            <div class="field">
              <label for="m-waist">Pas (cm)</label>
              <input id="m-waist" v-model="form.waistCm" type="number" inputmode="decimal" step="0.5" placeholder="např. 104" />
            </div>
          </div>
          <div class="field">
            <label for="m-toe">Předklon – vzdálenost prstů od země (cm)</label>
            <input id="m-toe" v-model="form.toeTouchCm" type="number" inputmode="decimal" step="0.5" placeholder="např. 14" />
            <div class="hint">
              Kladné číslo = tolik ti ještě chybí na zem. Až dosáhneš pod úroveň chodidel, piš záporné.
              Měř vždy ve stejnou denní dobu a rozehřátý – ráno je rozsah o 3–5 cm horší než večer,
              takže denní měření měří hlavně náladu.
            </div>
          </div>
          <div class="field">
            <label for="m-plank">Prkno – maximální výdrž (s)</label>
            <input id="m-plank" v-model="form.plankSec" type="number" inputmode="numeric" placeholder="např. 45" />
          </div>
          <button class="btn btn-primary btn-block" @click="save">Uložit</button>
        </div>
      </section>

      <!-- Souhrn ------------------------------------------------------ -->
      <section class="card">
        <div class="tiles">
          <div class="tile">
            <div class="tile-value num">{{ streak }}</div>
            <div class="tile-label">série dní</div>
          </div>
          <div class="tile">
            <div class="tile-value num">{{ bestStreak }}</div>
            <div class="tile-label">nejdelší série</div>
          </div>
          <div class="tile">
            <div class="tile-value num">{{ num(totalSteps) }}</div>
            <div class="tile-label">kroků celkem</div>
          </div>
          <div class="tile">
            <div class="tile-value num">{{ totalBlocks }}</div>
            <div class="tile-label">bloků ({{ num(totalMinutes) }} min)</div>
          </div>
        </div>
      </section>

      <!-- Grafy ------------------------------------------------------- -->
      <section class="card">
        <div class="card-title">Předklon – kolik chybí na zem</div>
        <LineChart :points="toeTouch" unit=" cm" lower-is-better :decimals="1" />
        <p v-if="toeTouch.length" class="tiny muted" style="margin-top: 6px">
          Naposledy {{ toeTouchLabel(toeTouch.at(-1)!.value) }}.
        </p>
        <p class="tiny faint" style="margin-top: 6px">
          První měřitelná změna přichází zhruba po čtyřech týdnech, typicky 2–5 cm. Prvních pár týdnů
          nepovoluje sval – roste tolerance k tahu. Měř jednou za dva týdny, ne denně.
        </p>
      </section>

      <section class="card">
        <div class="card-title">Váha</div>
        <LineChart :points="weight" unit=" kg" lower-is-better :decimals="1" />
      </section>

      <section class="card">
        <div class="card-title">Obvod pasu</div>
        <LineChart :points="waist" unit=" cm" lower-is-better :decimals="1" />
        <p class="tiny faint" style="margin-top: 6px">
          Pas říká o břišním tuku víc než váha. Měř přes pupek, po výdechu, bez zatahování.
        </p>
      </section>

      <section class="card">
        <div class="card-title">Prkno – maximální výdrž</div>
        <LineChart :points="plank" unit=" s" :decimals="0" />
        <p class="tiny faint" style="margin-top: 6px">
          Nad 45–60 sekund už prkno netrénuje stabilitu, ale snášení nepohodlí. Až se tam dostaneš,
          přejdi na těžší variantu místo delší výdrže.
        </p>
      </section>

      <!-- Historie ---------------------------------------------------- -->
      <section v-if="history.length" class="card">
        <div class="card-title">Zapsaná měření</div>
        <ul class="list-reset">
          <li v-for="m in history" :key="m.date" class="row-between measurement">
            <div class="when">
              <div class="small strong">{{ formatDayShort(m.date) }}</div>
              <div class="tiny faint">{{ relativeDayLabel(m.date, today) }}</div>
            </div>
            <div class="tiny muted right">
              <span v-if="m.weightKg">{{ m.weightKg }} kg</span>
              <span v-if="m.waistCm"> · pas {{ m.waistCm }} cm</span>
              <span v-if="m.toeTouchCm !== undefined"> · předklon {{ m.toeTouchCm }} cm</span>
              <span v-if="m.plankSec"> · prkno {{ m.plankSec }} s</span>
            </div>
            <button class="btn btn-sm btn-ghost" aria-label="Smazat" @click="removeMeasurement(m.date)">✕</button>
          </li>
        </ul>
      </section>
    </div>
  </main>
</template>

<style scoped>
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

.tile-value {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.tile-label {
  font-size: 0.75rem;
  color: var(--text-faint);
}

.measurement { padding: 8px 0; gap: 8px; align-items: flex-start; }

.when { flex-shrink: 0; white-space: nowrap; }
.measurement + .measurement { border-top: 1px solid var(--border); }
.right { text-align: right; }
</style>
