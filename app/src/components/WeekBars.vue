<script setup lang="ts">
import { computed, ref } from 'vue'
import { num } from '@/lib/format'
import { weekdayShort, type DateKey } from '@/lib/date'

/**
 * Sloupcový graf sedmi dní. Jedna veličina, jedna barva – barva tady nenese
 * identitu, jen zvýrazňuje dny nad cílem. To, jestli den vyšel, se dá přečíst
 * i bez barvy podle polohy vůči čárkované čáře cíle.
 */

const props = withDefaults(
  defineProps<{
    days: { date: DateKey; value: number; future?: boolean }[]
    target: number
    /** Popisek pod grafem. */
    unit?: string
    height?: number
  }>(),
  { unit: 'kroků', height: 132 },
)

const selected = ref<number | null>(null)

const max = computed(() => Math.max(props.target * 1.15, ...props.days.map((d) => d.value), 1))
const targetPct = computed(() => (props.target / max.value) * 100)

function barPct(value: number): number {
  return Math.max(value > 0 ? 3 : 0, (value / max.value) * 100)
}

const active = computed(() => (selected.value !== null ? props.days[selected.value] : null))
</script>

<template>
  <figure class="chart">
    <div class="plot" :style="{ height: `${height}px` }">
      <!-- Cílová čára: čtená pozičně, ne barvou -->
      <div class="target-line" :style="{ bottom: `${targetPct}%` }">
        <span class="target-label tiny">cíl {{ num(target) }}</span>
      </div>

      <div class="bars">
        <button
          v-for="(day, i) in days"
          :key="day.date"
          class="bar-slot"
          :class="{ selected: selected === i }"
          :aria-label="`${weekdayShort(day.date)}: ${num(day.value)} ${unit}`"
          @click="selected = selected === i ? null : i"
        >
          <span
            class="bar"
            :class="{ met: day.value >= target && target > 0, future: day.future }"
            :style="{ height: `${barPct(day.value)}%` }"
          />
        </button>
      </div>
    </div>

    <div class="labels">
      <span v-for="day in days" :key="day.date" class="tiny faint">{{ weekdayShort(day.date) }}</span>
    </div>

    <figcaption class="tiny" :class="active ? 'muted' : 'faint'">
      <template v-if="active">
        {{ weekdayShort(active.date) }}: <span class="num strong">{{ num(active.value) }}</span> {{ unit }}
      </template>
      <template v-else>Klepni na sloupec pro přesné číslo.</template>
    </figcaption>
  </figure>
</template>

<style scoped>
.chart { margin: 0; }

.plot {
  position: relative;
  border-bottom: 1px solid var(--border);
}

.bars {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  gap: 2px;
}

.bar-slot {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  background: none;
  border: 0;
  cursor: pointer;
}

.bar {
  display: block;
  width: 76%;
  background: var(--surface-3);
  /* Zaoblený jen horní konec – spodek je ukotvený na základní čáře. */
  border-radius: 4px 4px 0 0;
  transition: height 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.bar.met { background: var(--accent); }
.bar.future { opacity: 0.35; }

.bar-slot.selected .bar {
  outline: 2px solid var(--text-faint);
  outline-offset: 1px;
}

.target-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1.5px dashed var(--border-strong);
  z-index: 1;
  pointer-events: none;
}

.target-label {
  position: absolute;
  right: 0;
  top: -15px;
  color: var(--text-faint);
  background: var(--surface);
  padding: 0 3px;
}

.labels {
  display: flex;
  margin-top: 5px;
}

.labels span { flex: 1; text-align: center; }

figcaption { margin-top: 8px; }
</style>
