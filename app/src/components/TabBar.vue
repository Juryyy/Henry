<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()

const tabs = [
  { to: '/', label: 'Dnes', icon: 'today' },
  { to: '/cviceni', label: 'Cvičení', icon: 'train' },
  { to: '/kroky', label: 'Kroky', icon: 'steps' },
  { to: '/tyden', label: 'Týden', icon: 'week' },
  { to: '/pokrok', label: 'Pokrok', icon: 'chart' },
] as const

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}
</script>

<template>
  <nav class="tabbar" aria-label="Hlavní navigace">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="tab"
      :class="{ active: isActive(tab.to) }"
      :aria-current="isActive(tab.to) ? 'page' : undefined"
    >
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <template v-if="tab.icon === 'today'">
          <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <path d="M4 9h16M9 3v3M15 3v3" />
        </template>
        <template v-else-if="tab.icon === 'train'">
          <path d="M5 9v6M19 9v6M8 7v10M16 7v10M8 12h8" />
        </template>
        <template v-else-if="tab.icon === 'steps'">
          <path d="M7 4c1.6 0 2.5 1.3 2.5 3.2 0 1.6-.5 2.6-.5 3.8 0 1 .6 1.6.6 2.7 0 1.3-1 2.3-2.6 2.3S4.4 15 4.4 13.7c0-1.1.6-1.7.6-2.7 0-1.2-.5-2.2-.5-3.8C4.5 5.3 5.4 4 7 4Z" />
          <path d="M16.5 8c1.6 0 2.5 1.3 2.5 3.2 0 1.6-.5 2.6-.5 3.8 0 1 .6 1.6.6 2.7 0 1.3-1 2.3-2.6 2.3s-2.6-1-2.6-2.3c0-1.1.6-1.7.6-2.7 0-1.2-.5-2.2-.5-3.8 0-1.9.9-3.2 2.5-3.2Z" />
        </template>
        <template v-else-if="tab.icon === 'week'">
          <path d="M4 5h16v15H4z" />
          <path d="M4 10h16M9 10v10M14 10v10" />
        </template>
        <template v-else>
          <path d="M4 19V5M4 19h16" />
          <path d="m7 15 3.5-4 3 2.5L19 7" />
        </template>
      </svg>
      <span>{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  display: flex;
  justify-content: center;
  gap: 2px;
  padding-bottom: var(--safe-bottom);
  background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
  backdrop-filter: saturate(1.4) blur(14px);
  -webkit-backdrop-filter: saturate(1.4) blur(14px);
  border-top: 1px solid var(--border);
}

.tab {
  flex: 1;
  max-width: 110px;
  height: var(--tabbar-height);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  text-decoration: none;
  color: var(--text-faint);
  font-size: 0.68rem;
  font-weight: 600;
  transition: color 0.15s ease;
}

.tab.active { color: var(--accent); }

.icon {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
