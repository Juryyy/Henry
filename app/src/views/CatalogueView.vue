<script setup lang="ts">
import { computed, ref } from 'vue'
import { CATEGORY_LABELS, CATEGORY_TONE, EXERCISES, LEVEL_LABELS, TAG_LABELS } from '@/data/exercises'
import { getFigure } from '@/data/figures'
import ExerciseFigure from '@/components/ExerciseFigure.vue'
import type { Exercise, ExerciseCategory } from '@/lib/types'
import { state } from '@/stores/app'

/**
 * Katalog cviků – a zároveň místo, kde si člověk vybere, co chce cvičit.
 *
 * Dřív se vyřazovalo jen v detailu cviku, takže projít šestačtyřicet cviků
 * znamenalo šestačtyřicetkrát tam a zpátky. Vyřazení je proto rovnou tady
 * u obrázku: cvik se dá posoudit podle toho, jak vypadá, a hned zaškrtnout.
 *
 * Obrázky jsou schválně velké a barevné podle zaměření – když si vybíráš
 * cviky, chceš je vidět, ne číst seznam názvů.
 */
const query = ref('')
const category = ref<ExerciseCategory | 'all'>('all')
const tag = ref<string>('')
/** Přepínač „ukaž jen to, co jsem vyhodil" – ať se dá výběr projít zpátky. */
const onlyExcluded = ref(false)

/** Značky, které se v katalogu vyplatí nabídnout jako rychlý filtr. */
const QUICK_TAGS = ['hamstringy', 'kycle', 'brisni-lis', 'bederni-patere', 'hyzde', 'lytka', 'srdce']

const excludedIds = computed(() => state.settings.exercise.excludedExerciseIds)

function isExcluded(id: string): boolean {
  return excludedIds.value.includes(id)
}

function toggleExcluded(id: string): void {
  const list = state.settings.exercise.excludedExerciseIds
  const at = list.indexOf(id)
  if (at >= 0) list.splice(at, 1)
  else list.push(id)
}

function restoreAll(): void {
  state.settings.exercise.excludedExerciseIds.splice(0)
}

/* ------------------------------------------------------------------ */
/*  Filtry                                                             */
/* ------------------------------------------------------------------ */

/** Kolik cviků v každé skupině zbývá – tedy z čeho má Henry co vybírat. */
const counts = computed(() => {
  const out = new Map<ExerciseCategory, { total: number; left: number }>()
  for (const e of EXERCISES) {
    const row = out.get(e.category) ?? { total: 0, left: 0 }
    row.total++
    if (!isExcluded(e.id)) row.left++
    out.set(e.category, row)
  }
  return out
})

const categories = computed(() =>
  (Object.keys(CATEGORY_LABELS) as ExerciseCategory[]).map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    tone: CATEGORY_TONE[key],
    left: counts.value.get(key)?.left ?? 0,
    total: counts.value.get(key)?.total ?? 0,
  })),
)

/** Skupiny, ze kterých nezbyl ani jeden cvik. Ty Henry do plánu nedá. */
const emptied = computed(() => categories.value.filter((c) => c.left === 0))

const filtered = computed<Exercise[]>(() => {
  const q = query.value.trim().toLowerCase()
  return EXERCISES.filter((e) => {
    if (onlyExcluded.value && !isExcluded(e.id)) return false
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
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">
          {{ EXERCISES.length }} cviků<template v-if="excludedIds.length">
            · {{ excludedIds.length }} vyřazených</template
          >
        </div>
        <h1>Katalog</h1>
      </div>
    </header>

    <div class="stack">
      <input v-model="query" type="text" placeholder="Hledat cvik…" />

      <!-- Barevná tečka je ta samá barva, kterou má postavička u cviku.
           Tím se filtr a obrázky drží pohromadě: co si vyfiltruješ modře,
           je modré i v mřížce. -->
      <div class="scroll-x">
        <button class="chip" :class="{ on: category === 'all' }" @click="category = 'all'">
          Vše
        </button>
        <button
          v-for="c in categories"
          :key="c.key"
          class="chip tone"
          :class="{ on: category === c.key, empty: c.left === 0 }"
          :style="{ '--tone': c.tone }"
          :aria-label="`${c.label} – zbývá ${c.left} z ${c.total}`"
          :aria-pressed="category === c.key"
          @click="category = c.key"
        >
          <span class="tone-dot" aria-hidden="true"></span>
          {{ c.label }}
          <!-- Kolik jich ve skupině zbývá, a z kolika – ať je vidět, kde se
               výběr zúžil, ještě než se do skupiny vejde. -->
          <span class="count">{{ c.left }}<template v-if="c.left !== c.total">/{{ c.total }}</template></span>
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

      <p class="tiny faint" style="margin: -4px 0 0">
        Kolečko v rohu cvik vyřadí – Henry ho přestane nabízet a vezme jiný ze stejné skupiny.
        Klepnutí na kartu otevře postup.
      </p>

      <!-- Stav výběru. Ukazuje se, jen když je co ukazovat. -->
      <section v-if="excludedIds.length" class="card card-tight stack-sm">
        <span class="small">
          Vyřazené cviky: <span class="strong">{{ excludedIds.length }}</span>
        </span>
        <span class="row wrap" style="gap: 6px">
          <button class="btn btn-sm btn-ghost" @click="onlyExcluded = !onlyExcluded">
            {{ onlyExcluded ? 'Zobrazit vše' : 'Projít je' }}
          </button>
          <button class="btn btn-sm btn-ghost" @click="restoreAll">Vrátit všechny</button>
        </span>
      </section>

      <section v-if="emptied.length" class="card warn">
        <div class="card-title" style="color: inherit">Tahle skupina zůstala prázdná</div>
        <p class="small" style="margin: 0">
          {{ emptied.map((c) => c.label).join(', ') }} – ze skupiny nezbyl ani jeden cvik, takže ji
          Henry do plánu nedá. Jestli o ni nestojíš, vypni si rovnou celý blok v nastavení; pokud
          ano, vrať aspoň jeden cvik zpátky.
        </p>
      </section>

      <p v-if="filtered.length === 0" class="muted center small">
        {{ onlyExcluded ? 'Nic vyřazeného tu není.' : 'Nic takového tu není.' }}
      </p>

      <section v-for="[cat, list] in grouped" :key="cat">
        <div class="card-title row" style="gap: 7px">
          <span class="tone-dot" :style="{ '--tone': CATEGORY_TONE[cat] }" aria-hidden="true"></span>
          {{ CATEGORY_LABELS[cat] }} · {{ list.length }}
        </div>
        <ul class="list-reset grid">
          <li v-for="e in list" :key="e.id" class="cell" :class="{ off: isExcluded(e.id) }">
            <RouterLink :to="`/cviky/${e.id}`" class="card card-tight pick">
              <!-- Obrázek je pro čtečku schovaný: název i zaměření jsou hned
                   pod ním, takže popis provedení by jen nafoukl jméno odkazu. -->
              <span class="thumb" aria-hidden="true">
                <ExerciseFigure :figure="getFigure(e.id)" :category="e.category" />
              </span>
              <span class="small strong name">{{ e.name }}</span>
              <span class="tiny faint target">{{ e.target }}</span>
              <span class="tiny faint level">{{ LEVEL_LABELS[e.level] }}</span>
            </RouterLink>
            <button
              class="toggle"
              :aria-pressed="!isExcluded(e.id)"
              :aria-label="
                isExcluded(e.id) ? `Vrátit do plánu: ${e.name}` : `Vyřadit z plánu: ${e.name}`
              "
              @click="toggleExcluded(e.id)"
            >
              <span aria-hidden="true">{{ isExcluded(e.id) ? '+' : '✓' }}</span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </main>
</template>

<style scoped>
.chip.tone {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.chip.tone.on {
  background: color-mix(in srgb, var(--tone) 16%, transparent);
  border-color: color-mix(in srgb, var(--tone) 55%, transparent);
  color: var(--text);
}

/* Vyprázdněná skupina: tečka zůstane, ale je vidět, že z ní nic nezbývá. */
.chip.empty .tone-dot {
  background: var(--text-faint);
}

.count {
  font-size: 0.72rem;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px;
}

.cell {
  position: relative;
}

.pick {
  display: flex;
  flex-direction: column;
  gap: 2px;
  height: 100%;
  text-decoration: none;
  color: inherit;
  padding: 8px 10px 10px;
}

.thumb :deep(.figure) {
  background: var(--bg-soft);
  border-radius: var(--r-sm);
  margin-bottom: 4px;
}

.name {
  line-height: 1.25;
}

/* Zaměření pomáhá vybrat, ale nesmí kartu natáhnout přes celou obrazovku –
   delší popis se ořízne a celý je v detailu cviku. */
.target {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

.level {
  margin-top: auto;
  padding-top: 4px;
}

/*
 * Kolečko pro vyřazení. Je to samostatné tlačítko nad odkazem, protože obojí
 * má na kartě smysl: podívat se na postup i cvik vyhodit. Cíl je 40 × 40,
 * i když kolečko vypadá menší – palec na telefonu nemá pixelovou přesnost.
 */
.toggle {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
}

.toggle > span {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--accent) 55%, transparent);
  background: var(--accent-soft);
}

.toggle:active > span {
  transform: scale(0.9);
}

.cell.off .toggle {
  color: var(--text-faint);
}

.cell.off .toggle > span {
  border-color: var(--border-strong);
  background: var(--surface-2);
}

/* Vyřazený cvik nezmizí – jen zešedne, ať je vidět, že tu pořád je. */
.cell.off .pick {
  opacity: 0.42;
}
</style>
