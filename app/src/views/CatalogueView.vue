<script setup lang="ts">
import { computed, ref } from 'vue'
import { CATEGORY_LABELS, EXERCISES, LEVEL_LABELS, TAG_LABELS } from '@/data/exercises'
import type { Exercise, ExerciseCategory } from '@/lib/types'
import { state } from '@/stores/app'

const query = ref('')
const category = ref<ExerciseCategory | 'all'>('all')
const tag = ref<string>('')

const categories: { key: ExerciseCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'Vše' },
  { key: 'core', label: CATEGORY_LABELS.core },
  { key: 'stretch', label: CATEGORY_LABELS.stretch },
  { key: 'mobility', label: CATEGORY_LABELS.mobility },
  { key: 'strength', label: CATEGORY_LABELS.strength },
  { key: 'cardio', label: CATEGORY_LABELS.cardio },
]

/** Značky, které se v katalogu vyplatí nabídnout jako rychlý filtr. */
const QUICK_TAGS = ['hamstringy', 'kycle', 'brisni-lis', 'bederni-patere', 'hyzde', 'lytka', 'srdce']

const filtered = computed<Exercise[]>(() => {
  const q = query.value.trim().toLowerCase()
  return EXERCISES.filter((e) => {
    if (category.value !== 'all' && e.category !== category.value) return false
    if (tag.value && !e.tags.includes(tag.value)) return false
    if (!q) return true
    return (
      e.name.toLowerCase().includes(q) ||
      e.nameEn.toLowerCase().includes(q) ||
      e.target.toLowerCase().includes(q)
    )
  })
})

const grouped = computed(() => {
  const map = new Map<ExerciseCategory, Exercise[]>()
  for (const e of filtered.value) {
    const list = map.get(e.category) ?? []
    list.push(e)
    map.set(e.category, list)
  }
  return [...map.entries()]
})

function isExcluded(id: string): boolean {
  return state.settings.exercise.excludedExerciseIds.includes(id)
}
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">{{ EXERCISES.length }} cviků</div>
        <h1>Katalog</h1>
      </div>
    </header>

    <div class="stack">
      <input v-model="query" type="text" placeholder="Hledat cvik…" />

      <div class="scroll-x">
        <button
          v-for="c in categories"
          :key="c.key"
          class="chip"
          :class="{ on: category === c.key }"
          @click="category = c.key"
        >
          {{ c.label }}
        </button>
      </div>

      <div class="scroll-x">
        <button class="chip" :class="{ on: tag === '' }" @click="tag = ''">Bez filtru</button>
        <button
          v-for="t in QUICK_TAGS"
          :key="t"
          class="chip"
          :class="{ on: tag === t }"
          @click="tag = tag === t ? '' : t"
        >
          {{ TAG_LABELS[t] ?? t }}
        </button>
      </div>

      <p v-if="filtered.length === 0" class="muted center small">Nic takového tu není.</p>

      <section v-for="[cat, list] in grouped" :key="cat">
        <div class="card-title">{{ CATEGORY_LABELS[cat] }} · {{ list.length }}</div>
        <ul class="list-reset stack-sm">
          <li v-for="e in list" :key="e.id">
            <RouterLink :to="`/cviky/${e.id}`" class="row card card-tight ex" :class="{ off: isExcluded(e.id) }">
              <span class="grow">
                <span class="strong">{{ e.name }}</span>
                <span class="tiny faint block">{{ e.target }}</span>
              </span>
              <span v-if="isExcluded(e.id)" class="badge tiny">vyřazený</span>
              <span v-else class="badge tiny">{{ LEVEL_LABELS[e.level] }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </div>
  </main>
</template>

<style scoped>
.chip {
  flex-shrink: 0;
  padding: 7px 13px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.chip.on {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  color: var(--accent);
}

.ex {
  text-decoration: none;
  color: inherit;
  gap: 10px;
}

.ex.off { opacity: 0.45; }

.block { display: block; }
</style>
