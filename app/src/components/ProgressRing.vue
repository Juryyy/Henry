<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 0–100 (a klidně přes 100, kruh se zastaví na plném). */
    percent: number
    size?: number
    thickness?: number
    color?: string
    /** Druhý, slabší kruh – kolik by mělo být hotovo touhle dobou. */
    marker?: number | null
    label?: string
    sublabel?: string
  }>(),
  { size: 148, thickness: 12, color: 'var(--accent)', marker: null, label: '', sublabel: '' },
)

const radius = computed(() => (props.size - props.thickness) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const clamped = computed(() => Math.max(0, Math.min(100, props.percent)))
const dash = computed(() => (clamped.value / 100) * circumference.value)
/** Úhel značky očekávaného tempa, posunutý o -90° (kruh začíná nahoře). */
const markerAngle = computed(() =>
  props.marker === null ? null : (Math.max(0, Math.min(100, props.marker)) / 100) * 360 - 90,
)
const markerPos = computed(() => {
  if (markerAngle.value === null) return null
  const rad = (markerAngle.value * Math.PI) / 180
  const c = props.size / 2
  return { x: c + radius.value * Math.cos(rad), y: c + radius.value * Math.sin(rad) }
})
</script>

<template>
  <div class="ring" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" aria-hidden="true">
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        stroke="var(--surface-3)"
        :stroke-width="thickness"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        :stroke="color"
        :stroke-width="thickness"
        stroke-linecap="round"
        :stroke-dasharray="`${dash} ${circumference}`"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`"
        class="arc"
      />
      <circle
        v-if="markerPos"
        :cx="markerPos.x"
        :cy="markerPos.y"
        :r="thickness / 2 - 2.5"
        fill="var(--bg)"
        stroke="var(--text-faint)"
        stroke-width="2"
      />
    </svg>
    <div class="inner">
      <slot>
        <div class="value num">{{ label }}</div>
        <div class="sub">{{ sublabel }}</div>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.ring {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.ring svg { position: absolute; inset: 0; }

.arc { transition: stroke-dasharray 0.45s cubic-bezier(0.4, 0, 0.2, 1); }

.inner {
  position: relative;
  text-align: center;
  line-height: 1.15;
  padding: 0 10px;
}

.value {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.sub {
  font-size: 0.74rem;
  color: var(--text-faint);
  margin-top: 2px;
}
</style>
