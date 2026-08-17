<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getExercise } from '@/data/exercises'
import { buildBlock, doseLabel } from '@/lib/plan'
import { formatDuration } from '@/lib/date'
import { buzz, useTimer } from '@/composables/useTimer'
import {
  completeBlock,
  getBlockLog,
  isBlockDone,
  skipExercise,
  state,
  today,
  toggleExerciseDone,
} from '@/stores/app'
import type { BlockSlot } from '@/lib/types'

const route = useRoute()
const router = useRouter()

const slot = computed<BlockSlot>(() => {
  const raw = Number(route.params.slot)
  return (Number.isFinite(raw) && raw >= 0 && raw <= 2 ? raw : 0) as BlockSlot
})

const plan = computed(() => buildBlock(state, today.value, slot.value))
const log = computed(() => getBlockLog(today.value, slot.value, plan.value.id))

/* ------------------------------------------------------------------ */
/*  Průchod cviky                                                      */
/* ------------------------------------------------------------------ */

const index = ref(0)
const currentSet = ref(1)
/** U cviků na obě strany: 0 = první strana, 1 = druhá. */
const side = ref(0)
const resting = ref(false)
const startedAt = ref(Date.now())

const item = computed(() => plan.value.items[index.value])
const exercise = computed(() => (item.value ? getExercise(item.value.exerciseId) : undefined))
const finished = computed(() => index.value >= plan.value.items.length)

const timer = useTimer()

const isTimed = computed(() => exercise.value?.mode !== 'reps')
const sidesCount = computed(() => (exercise.value?.mode === 'time_per_side' ? 2 : 1))

const doneCount = computed(() => log.value.doneExerciseIds.length)
const progressPct = computed(() =>
  plan.value.items.length ? (index.value / plan.value.items.length) * 100 : 0,
)

watch([index, () => plan.value.id], () => {
  currentSet.value = 1
  side.value = 0
  resting.value = false
  timer.reset()
})

/* ------------------------------------------------------------------ */
/*  Ovládání                                                           */
/* ------------------------------------------------------------------ */

function startWork(): void {
  if (!item.value || !exercise.value) return
  resting.value = false
  if (!isTimed.value) return
  timer.start(item.value.dose, () => {
    buzz([120, 60, 120])
    onWorkDone()
  })
}

function onWorkDone(): void {
  if (!item.value || !exercise.value) return
  // Druhá strana téhož cviku.
  if (side.value + 1 < sidesCount.value) {
    side.value++
    startWork()
    return
  }
  side.value = 0
  if (currentSet.value < item.value.sets) {
    startRest()
  } else {
    completeExercise()
  }
}

function startRest(): void {
  if (!exercise.value) return
  const rest = exercise.value.restSeconds
  currentSet.value++
  if (rest <= 0) {
    startWork()
    return
  }
  resting.value = true
  timer.start(rest, () => {
    buzz(80)
    startWork()
  })
}

function completeExercise(): void {
  if (!item.value) return
  if (!log.value.doneExerciseIds.includes(item.value.exerciseId)) {
    toggleExerciseDone(today.value, slot.value, plan.value.id, item.value.exerciseId)
  }
  timer.reset()
  index.value++
}

function skipCurrent(): void {
  if (!item.value) return
  skipExercise(today.value, slot.value, plan.value.id, item.value.exerciseId)
  timer.reset()
  index.value++
}

function goBack(): void {
  if (index.value > 0) index.value--
}

function finish(): void {
  completeBlock(today.value, slot.value, plan.value.id, (Date.now() - startedAt.value) / 1000)
  void router.push('/')
}

function close(): void {
  void router.push('/')
}

/* Obrazovka nemá při cvičení zhasínat. */
let wakeLock: { release: () => Promise<void> } | null = null

onMounted(async () => {
  startedAt.value = Date.now()
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null
  } catch {
    // Bez wake locku to jde taky, jen obrazovka zhasne.
  }
})

onBeforeUnmount(() => {
  void wakeLock?.release().catch(() => {})
  timer.reset()
})

const setLabel = computed(() => {
  if (!item.value) return ''
  const base = `Série ${Math.min(currentSet.value, item.value.sets)} / ${item.value.sets}`
  if (sidesCount.value === 2) return `${base} · ${side.value === 0 ? 'levá' : 'pravá'} strana`
  return base
})
</script>

<template>
  <main class="player">
    <header class="bar">
      <button class="icon-btn" aria-label="Zavřít" @click="close">✕</button>
      <div class="grow center">
        <div class="strong">{{ plan.title }}</div>
        <div class="tiny faint">{{ plan.subtitle }}</div>
      </div>
      <div class="tiny faint num" style="min-width: 42px; text-align: right">
        {{ Math.min(index + 1, plan.items.length) }}/{{ plan.items.length }}
      </div>
    </header>

    <div class="track"><div class="track-fill" :style="{ width: `${progressPct}%` }" /></div>

    <!-- Průběh cviku ------------------------------------------------- -->
    <section v-if="!finished && exercise" class="body">
      <div class="stack">
        <div>
          <h1>{{ exercise.name }}</h1>
          <p class="muted small" style="margin-top: 4px">{{ exercise.target }}</p>
        </div>

        <div class="dose-card" :class="{ resting }">
          <div class="tiny faint">{{ resting ? 'Pauza' : setLabel }}</div>
          <div v-if="isTimed || resting" class="timer num">
            {{ formatDuration(timer.remaining.value || (resting ? exercise.restSeconds : item!.dose)) }}
          </div>
          <div v-else class="timer num">{{ item!.dose }}×</div>
          <div class="tiny muted">{{ doseLabel(exercise, item!) }}</div>
        </div>

        <div class="row" style="gap: 8px">
          <button v-if="!timer.running.value" class="btn btn-primary grow btn-lg" @click="isTimed ? startWork() : onWorkDone()">
            {{ isTimed ? (timer.remaining.value > 0 ? 'Pokračovat' : 'Spustit') : 'Hotovo' }}
          </button>
          <button v-else class="btn btn-ghost grow btn-lg" @click="timer.pause()">Pauza</button>
          <button class="btn btn-ghost btn-lg" @click="completeExercise" title="Přeskočit zbytek sérií">›</button>
        </div>

        <details class="card" open>
          <summary class="card-title" style="cursor: pointer; margin: 0">Jak na to</summary>
          <ol class="steps">
            <li v-for="(line, i) in exercise.instructions" :key="i">{{ line }}</li>
          </ol>
          <div v-if="exercise.cues.length" class="cues">
            <div class="tiny faint" style="margin-bottom: 4px">Na co si dát pozor</div>
            <ul class="list-reset stack-sm">
              <li v-for="(cue, i) in exercise.cues" :key="i" class="small muted">– {{ cue }}</li>
            </ul>
          </div>
          <p v-if="exercise.warning" class="warning small">⚠︎ {{ exercise.warning }}</p>
        </details>

        <div class="row" style="gap: 8px">
          <button class="btn btn-sm btn-ghost" :disabled="index === 0" @click="goBack">‹ Zpět</button>
          <button class="btn btn-sm btn-ghost grow" @click="skipCurrent">Tenhle vynechat</button>
        </div>

        <div class="alt small muted">
          <strong class="faint">Lehčí:</strong> {{ exercise.easier }}<br />
          <strong class="faint">Těžší:</strong> {{ exercise.harder }}
        </div>
      </div>
    </section>

    <!-- Konec -------------------------------------------------------- -->
    <section v-else class="body done">
      <div class="stack center">
        <div style="font-size: 3rem">{{ isBlockDone(today, slot) ? '✅' : '💪' }}</div>
        <h1>Blok hotový</h1>
        <p class="muted">
          Odcvičeno {{ doneCount }} z {{ plan.items.length }} cviků za
          {{ formatDuration((Date.now() - startedAt) / 1000) }}.
        </p>
        <button class="btn btn-primary btn-lg btn-block" @click="finish">Zapsat a zavřít</button>
        <button class="btn btn-ghost btn-block" @click="index = 0">Projít znovu</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.player {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(var(--safe-top) + 10px) 12px 10px;
}

.icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  font-size: 0.95rem;
}

.track { height: 3px; background: var(--surface-2); }
.track-fill { height: 100%; background: var(--accent); transition: width 0.3s ease; }

.body {
  flex: 1;
  width: 100%;
  max-width: var(--page-max);
  margin: 0 auto;
  padding: 18px 16px calc(var(--safe-bottom) + 24px);
}

.body.done { display: grid; place-items: center; }

.dose-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 18px;
  text-align: center;
}

.dose-card.resting {
  background: var(--info-soft);
  border-color: color-mix(in srgb, var(--info) 35%, var(--border));
}

.timer {
  font-size: 3.4rem;
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1.1;
  margin: 2px 0 4px;
}

.steps {
  margin: 10px 0 0;
  padding-left: 1.2em;
  font-size: 0.92rem;
  line-height: 1.55;
}

.steps li { margin-bottom: 6px; }

.cues { margin-top: 12px; }

.warning {
  margin-top: 12px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--warn-soft);
  color: var(--warn);
}

.alt {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  line-height: 1.6;
}
</style>
