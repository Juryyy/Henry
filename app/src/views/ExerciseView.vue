<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CATEGORY_LABELS, LEVEL_LABELS, TAG_LABELS, getExercise } from '@/data/exercises'
import { getFigure } from '@/data/figures'
import { state } from '@/stores/app'
import ExerciseFigure from '@/components/ExerciseFigure.vue'

const route = useRoute()
const router = useRouter()

const exercise = computed(() => getExercise(String(route.params.id)))
const figure = computed(() => (exercise.value ? getFigure(exercise.value.id) : null))

const excluded = computed(() => {
  const id = exercise.value?.id
  return !!id && state.settings.exercise.excludedExerciseIds.includes(id)
})

function toggleExcluded(): void {
  const id = exercise.value?.id
  if (!id) return
  const list = state.settings.exercise.excludedExerciseIds
  const idx = list.indexOf(id)
  if (idx >= 0) list.splice(idx, 1)
  else list.push(id)
}

const doseText = computed(() => {
  const e = exercise.value
  if (!e) return ''
  if (e.mode === 'reps') return `${e.sets}× ${e.dose} opakování`
  if (e.mode === 'time_per_side') return `${e.sets}× ${e.dose} s na každou stranu`
  return `${e.sets}× ${e.dose} s`
})
</script>

<template>
  <main class="page">
    <header class="page-header">
      <button class="btn btn-sm btn-ghost" @click="router.back()">‹ Zpět</button>
    </header>

    <div v-if="!exercise" class="card center muted">Takový cvik neznám.</div>

    <div v-else class="stack">
      <section>
        <h1>{{ exercise.name }}</h1>
        <p class="muted small" style="margin-top: 4px">{{ exercise.target }}</p>
        <div class="row wrap" style="gap: 6px; margin-top: 10px">
          <span class="badge badge-info">{{ CATEGORY_LABELS[exercise.category] }}</span>
          <span class="badge">{{ LEVEL_LABELS[exercise.level] }}</span>
          <span class="badge badge-accent">{{ doseText }}</span>
          <span class="badge">pauza {{ exercise.restSeconds }} s</span>
        </div>
      </section>

      <section v-if="figure" class="card demo">
        <ExerciseFigure :figure="figure" :category="exercise.category" animated />
        <p class="tiny faint center" style="margin: 6px 0 0">Ukázka provedení</p>
      </section>

      <section class="card">
        <div class="card-title">Postup</div>
        <ol class="steps">
          <li v-for="(line, i) in exercise.instructions" :key="i">{{ line }}</li>
        </ol>
      </section>

      <section v-if="exercise.cues.length" class="card">
        <div class="card-title">Na co si dát pozor</div>
        <ul class="list-reset stack-sm">
          <li v-for="(cue, i) in exercise.cues" :key="i" class="small">– {{ cue }}</li>
        </ul>
      </section>

      <section class="card">
        <div class="card-title">Když je to moc / málo</div>
        <p class="small"><strong class="faint">Lehčí:</strong> {{ exercise.easier }}</p>
        <p class="small"><strong class="faint">Těžší:</strong> {{ exercise.harder }}</p>
      </section>

      <section v-if="exercise.warning" class="card warn">
        <div class="card-title" style="color: inherit">Kdy to nedělat</div>
        <p class="small">{{ exercise.warning }}</p>
      </section>

      <section>
        <div class="row wrap" style="gap: 6px">
          <span v-for="t in exercise.tags" :key="t" class="badge tiny">{{ TAG_LABELS[t] ?? t }}</span>
        </div>
      </section>

      <button class="btn btn-block" :class="excluded ? 'btn-primary' : 'btn-ghost'" @click="toggleExcluded">
        {{ excluded ? 'Vrátit zpátky do plánu' : 'Vyřadit z plánu' }}
      </button>
      <p class="tiny faint center">
        Vyřazený cvik Henry přestane nabízet a nahradí ho jiným ze stejné skupiny.
      </p>
    </div>
  </main>
</template>

<style scoped>
.demo {
  padding: 10px 12px 12px;
}

/* Ukázka nemá zabrat půl obrazovky – pod ní má být hned první krok postupu. */
.demo :deep(.figure) {
  max-width: 320px;
  margin: 0 auto;
}

.steps {
  margin: 0;
  padding-left: 1.2em;
  font-size: 0.94rem;
  line-height: 1.6;
}

.steps li { margin-bottom: 8px; }
.steps li:last-child { margin-bottom: 0; }

.warn {
  background: var(--warn-soft);
  border-color: color-mix(in srgb, var(--warn) 35%, var(--border));
  color: var(--warn);
}
</style>
