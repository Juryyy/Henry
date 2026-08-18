<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDayShort, type DateKey } from '@/lib/date'

/**
 * Jednoduchý spojnicový graf jedné veličiny v čase.
 * Jedna řada = žádná legenda, název grafu říká, co se měří.
 */

const props = withDefaults(
  defineProps<{
    points: { date: DateKey; value: number }[]
    unit?: string
    /** Menší hodnota = lepší (váha, obvod pasu, vzdálenost od země). */
    lowerIsBetter?: boolean
    height?: number
    decimals?: number
  }>(),
  { unit: '', lowerIsBetter: false, height: 150, decimals: 1 },
)

const W = 300
const PAD = { top: 12, right: 10, bottom: 18, left: 10 }

const selected = ref<number | null>(null)

const bounds = computed(() => {
  const values = props.points.map((p) => p.value)
  if (values.length === 0) return { min: 0, max: 1 }
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return { min: min - 1, max: max + 1 }
  const pad = (max - min) * 0.15
  return { min: min - pad, max: max + pad }
})

const H = computed(() => props.height)

function x(i: number): number {
  if (props.points.length <= 1) return W / 2
  return PAD.left + (i / (props.points.length - 1)) * (W - PAD.left - PAD.right)
}

function y(value: number): number {
  const { min, max } = bounds.value
  const usable = H.value - PAD.top - PAD.bottom
  return PAD.top + (1 - (value - min) / (max - min)) * usable
}

const path = computed(() => props.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' '))

const areaPath = computed(() => {
  if (props.points.length < 2) return ''
  return `${path.value} L${x(props.points.length - 1).toFixed(1)},${H.value - PAD.bottom} L${x(0).toFixed(1)},${H.value - PAD.bottom} Z`
})

const change = computed(() => {
  if (props.points.length < 2) return null
  const first = props.points[0]!.value
  const last = props.points.at(-1)!.value
  const delta = last - first
  const good = props.lowerIsBetter ? delta < 0 : delta > 0
  return { delta, good }
})

function fmt(v: number): string {
  return v.toFixed(props.decimals).replace('.', ',').replace(/,0$/, '')
}

const active = computed(() => (selected.value !== null ? props.points[selected.value] : null))
</script>

<template>
  <figure class="chart">
    <div v-if="points.length === 0" class="empty tiny faint">Zatím žádná data.</div>

    <template v-else>
      <svg :viewBox="`0 0 ${W} ${H}`" :style="{ height: `${H}px` }" role="img" :aria-label="`Vývoj v čase, ${unit}`">
        <line
          :x1="PAD.left"
          :x2="W - PAD.right"
          :y1="H - PAD.bottom"
          :y2="H - PAD.bottom"
          stroke="var(--border)"
          stroke-width="1"
        />
        <path v-if="areaPath" :d="areaPath" fill="var(--accent-soft)" />
        <path :d="path" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <g v-for="(p, i) in points" :key="p.date">
          <circle
            :cx="x(i)"
            :cy="y(p.value)"
            :r="selected === i ? 5.5 : 3.5"
            fill="var(--accent)"
            stroke="var(--surface)"
            stroke-width="2"
          />
          <!-- Neviditelný větší terč, aby se dalo trefit prstem -->
          <circle :cx="x(i)" :cy="y(p.value)" r="14" fill="transparent" @click="selected = selected === i ? null : i" />
        </g>
        <text :x="x(0)" :y="H - 5" font-size="9" fill="var(--text-faint)" text-anchor="start">
          {{ formatDayShort(points[0]!.date) }}
        </text>
        <text v-if="points.length > 1" :x="x(points.length - 1)" :y="H - 5" font-size="9" fill="var(--text-faint)" text-anchor="end">
          {{ formatDayShort(points.at(-1)!.date) }}
        </text>
      </svg>

      <figcaption class="row-between tiny">
        <span :class="active ? 'muted' : 'faint'">
          <template v-if="active">{{ formatDayShort(active.date) }}: <span class="num strong">{{ fmt(active.value) }}{{ unit }}</span></template>
          <template v-else>Poslední: <span class="num strong">{{ fmt(points.at(-1)!.value) }}{{ unit }}</span></template>
        </span>
        <span v-if="change" class="num" :class="change.good ? 'c-accent' : 'faint'">
          {{ change.delta > 0 ? '+' : '' }}{{ fmt(change.delta) }}{{ unit }} celkem
        </span>
      </figcaption>
    </template>
  </figure>
</template>

<style scoped>
.chart { margin: 0; }
svg { width: 100%; display: block; }
.empty { padding: 20px 0; text-align: center; }
figcaption { margin-top: 4px; }
</style>
