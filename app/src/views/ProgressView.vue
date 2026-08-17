<script setup lang="ts">
import { computed, ref } from 'vue'
import LineChart from '@/components/LineChart.vue'
import { formatDayShort, relativeDayLabel } from '@/lib/date'
import { num, parseNumber } from '@/lib/format'
import { bestStreak, removeMeasurement, saveMeasurement, state, streak, today } from '@/stores/app'
import { measurementSeries } from '@/lib/engine'
import { MILESTONES, unlockedCount } from '@/lib/milestones'
import type { Measurement } from '@/lib/types'

/* Zápis nové míry ------------------------------------------------------ */

const form = ref({
  date: today.value,
  weightKg: '',
  waistCm: '',
  toeTouchCm: '',
  plankSec: '',
})

const showForm = ref(false)

/**
 * Pole jsou schválně `type="text"` s desetinnou klávesnicí, ne `type="number"`.
 * Do číselného pole totiž prohlížeč nepustí desetinnou čárku – a Čech, který
 * napíše „92,4“, by přišel o celou hodnotu.
 */
function numberOrUndefined(value: string): number | undefined {
  return parseNumber(value) ?? undefined
}

function save(): void {
  // Prázdná políčka se do záznamu vůbec nedostanou. Kdyby tam šla jako
  // `undefined`, přepsala by při druhém zápisu téhož dne to, co už bylo
  // změřené ráno.
  const patch: Measurement = { date: form.value.date }
  const weight = numberOrUndefined(form.value.weightKg)
  const waist = numberOrUndefined(form.value.waistCm)
  const toe = numberOrUndefined(form.value.toeTouchCm)
  const plank = numberOrUndefined(form.value.plankSec)
  if (weight !== undefined) patch.weightKg = weight
  if (waist !== undefined) patch.waistCm = waist
  if (toe !== undefined) patch.toeTouchCm = toe
  if (plank !== undefined) patch.plankSec = plank

  // Prázdný formulář nemá zakládat prázdný záznam.
  if (Object.keys(patch).length === 1) {
    showForm.value = false
    return
  }
  saveMeasurement(patch)
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

/* Milníky --------------------------------------------------------------- */

const milestones = computed(() =>
  MILESTONES.map((m) => {
    const unlockedAt = state.achievements[m.id]
    return {
      ...m,
      unlockedAt,
      // U zamčených ukazujeme, jak daleko to je – jinak je to jen seznam
      // věcí, které nemám.
      pct: unlockedAt ? 1 : (m.progress?.(state, today.value) ?? 0),
    }
  }).sort((a, b) => {
    if (!!a.unlockedAt !== !!b.unlockedAt) return a.unlockedAt ? -1 : 1
    return b.pct - a.pct
  }),
)

const unlocked = computed(() => unlockedCount(state))

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
              <input id="m-weight" v-model="form.weightKg" type="text" inputmode="decimal" placeholder="např. 92,4" />
            </div>
            <div class="field">
              <label for="m-waist">Pas (cm)</label>
              <input id="m-waist" v-model="form.waistCm" type="text" inputmode="decimal" placeholder="např. 104" />
            </div>
          </div>
          <div class="field">
            <label for="m-toe">Předklon – vzdálenost prstů od země (cm)</label>
            <input id="m-toe" v-model="form.toeTouchCm" type="text" inputmode="decimal" placeholder="např. 14" />
            <div class="hint">
              Kladné číslo = tolik ti ještě chybí na zem. Až dosáhneš pod úroveň chodidel, piš záporné.
              Měř vždy ve stejnou denní dobu a rozehřátý – ráno je rozsah o 3–5 cm horší než večer,
              takže denní měření měří hlavně náladu.
            </div>
          </div>
          <div class="field">
            <label for="m-plank">Prkno – maximální výdrž (s)</label>
            <input id="m-plank" v-model="form.plankSec" type="text" inputmode="numeric" placeholder="např. 45" />
          </div>
          <button class="btn btn-primary btn-block" @click="save">Uložit měření</button>
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

      <!-- Milníky ----------------------------------------------------- -->
      <section class="card">
        <div class="row-between" style="margin-bottom: 12px">
          <div class="card-title" style="margin: 0">Milníky</div>
          <span class="badge num">{{ unlocked }} / {{ milestones.length }}</span>
        </div>
        <ul class="list-reset milestones">
          <li v-for="m in milestones" :key="m.id" :class="{ locked: !m.unlockedAt }">
            <span class="m-emoji">{{ m.emoji }}</span>
            <span class="grow">
              <span class="small strong">{{ m.title }}</span>
              <span class="tiny faint">{{ m.detail }}</span>
              <span v-if="!m.unlockedAt && m.pct > 0.02" class="m-bar" aria-hidden="true">
                <span :style="{ width: `${Math.round(m.pct * 100)}%` }" />
              </span>
            </span>
            <span v-if="m.unlockedAt" class="badge badge-accent">✓</span>
          </li>
        </ul>
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
            <div class="values grow">
              <span v-if="m.weightKg" class="badge num">{{ m.weightKg }} kg</span>
              <span v-if="m.waistCm" class="badge num">pas {{ m.waistCm }}</span>
              <span v-if="m.toeTouchCm !== undefined" class="badge num">zem {{ m.toeTouchCm }}</span>
              <span v-if="m.plankSec" class="badge num">prkno {{ m.plankSec }} s</span>
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

.milestones { display: flex; flex-direction: column; gap: 3px; }

.milestones li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 9px 0;
}

.milestones li + li { border-top: 1px solid var(--border); }
.milestones li.locked { opacity: 0.55; }

.milestones .grow { display: flex; flex-direction: column; gap: 2px; }

.m-emoji {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: var(--surface-2);
  font-size: 1.05rem;
}

.milestones li:not(.locked) .m-emoji { background: var(--accent-soft); }

.m-bar {
  display: block;
  height: 4px;
  margin-top: 5px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.m-bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--text-faint);
}

.measurement { padding: 10px 0; gap: 10px; align-items: center; }

.when { flex-shrink: 0; white-space: nowrap; width: 62px; }

.values {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  justify-content: flex-end;
}
.measurement + .measurement { border-top: 1px solid var(--border); }
.right { text-align: right; }
</style>
