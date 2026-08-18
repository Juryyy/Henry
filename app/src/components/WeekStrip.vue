<script setup lang="ts">
import { computed } from 'vue'
import { weekDays, type DateKey, type WeekKey } from '@/lib/date'
import { dayStatus } from '@/lib/engine'
import { state } from '@/stores/app'

/**
 * Sedm teček za týden. Rychlá odpověď na „jak jsem na tom“ bez čtení čísel:
 * plná = den se počítá, prstenec = něco se dělalo, prázdná = nic.
 */

const props = defineProps<{
  week: WeekKey
  today: DateKey
  /** Klepnutím lze den vybrat (jinak jen zobrazuje). */
  selectable?: boolean
}>()

const emit = defineEmits<{ select: [DateKey] }>()

const LABELS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

const cells = computed(() =>
  weekDays(props.week).map((date, index) => ({
    label: LABELS[index],
    isToday: date === props.today,
    ...dayStatus(state, date, props.today),
  })),
)
</script>

<template>
  <div class="strip">
    <component
      :is="selectable ? 'button' : 'div'"
      v-for="cell in cells"
      :key="cell.date"
      class="cell"
      :class="{ today: cell.isToday }"
      :aria-label="`${cell.label}: skóre ${cell.isFuture ? 'zatím nic' : Math.round(cell.score)}`"
      @click="selectable && emit('select', cell.date)"
    >
      <span class="label tiny">{{ cell.label }}</span>
      <span
        class="dot"
        :class="{
          full: cell.counts && !cell.isFuture,
          part: !cell.counts && cell.score > 0 && !cell.isFuture,
          rest: cell.restDay,
          future: cell.isFuture,
        }"
      >
        <span v-if="cell.restDay" class="rest-mark">z</span>
      </span>
    </component>
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  gap: 4px;
}

.cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  cursor: inherit;
}

button.cell { cursor: pointer; }

.label { color: var(--text-faint); font-weight: 620; }
.cell.today .label { color: var(--text); }

.dot {
  width: 100%;
  max-width: 30px;
  aspect-ratio: 1;
  border-radius: 10px;
  border: 1.5px solid var(--border);
  background: var(--surface-2);
  display: grid;
  place-items: center;
  font-size: 0.68rem;
  color: var(--text-faint);
  transition: background 0.3s var(--ease), border-color 0.3s var(--ease);
}

.dot.full {
  background: var(--accent);
  border-color: var(--accent);
}

.dot.part {
  background: var(--surface-3);
  border-color: var(--border-strong);
}

.dot.rest {
  background: var(--info-soft);
  border-color: transparent;
  color: var(--info);
}

.dot.future {
  background: transparent;
  border-style: dashed;
  border-color: var(--border-strong);
  opacity: 0.7;
}

.cell.today .dot {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--text-faint);
}

.cell.today .dot.full {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--accent);
}

.rest-mark { font-weight: 700; }
</style>
