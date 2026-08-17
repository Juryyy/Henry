<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    percent: number
    color?: string
    height?: number
    /** Slabá ryska „kde bys měl být“. */
    marker?: number | null
    /** Část pruhu, která je dluh z minula – kreslí se šrafovaně na začátku. */
    debtPercent?: number
  }>(),
  { color: 'var(--accent)', height: 10, marker: null, debtPercent: 0 },
)

const clamped = computed(() => Math.max(0, Math.min(100, props.percent)))
</script>

<template>
  <div class="bar" :style="{ height: `${height}px` }" role="progressbar" :aria-valuenow="Math.round(clamped)">
    <div v-if="debtPercent > 0" class="debt" :style="{ width: `${Math.min(100, debtPercent)}%` }" />
    <div class="fill" :style="{ width: `${clamped}%`, background: color }" />
    <div v-if="marker !== null" class="marker" :style="{ left: `${Math.max(0, Math.min(100, marker))}%` }" />
  </div>
</template>

<style scoped>
.bar {
  position: relative;
  width: 100%;
  background: var(--surface-3);
  border-radius: 999px;
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Šrafování ukazuje, jaká část cíle je dluh z minulého týdne. */
.debt {
  position: absolute;
  inset: 0 auto 0 0;
  background: repeating-linear-gradient(
    -45deg,
    var(--warn-soft) 0 6px,
    transparent 6px 12px
  );
}

.marker {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--text-faint);
  border-radius: 1px;
  transform: translateX(-1px);
}
</style>
