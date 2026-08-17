<script setup lang="ts">
import { computed } from 'vue'
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

/** Index aktivní záložky – řídí posun zvýrazňovací pilulky. */
const activeIndex = computed(() => {
  const found = tabs.findIndex((t) => isActive(t.to))
  return found >= 0 ? found : -1
})
</script>

<template>
  <nav class="tabbar" aria-label="Hlavní navigace">
    <div class="inner">
      <div
        v-if="activeIndex >= 0"
        class="pill"
        aria-hidden="true"
        :style="{ transform: `translateX(${activeIndex * 100}%)` }"
      />
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
            <rect x="3.5" y="5" width="17" height="15" rx="3.2" />
            <path d="M3.5 9.5h17M8.5 3v4M15.5 3v4" />
          </template>
          <template v-else-if="tab.icon === 'train'">
            <path d="M4.5 9.5v5M19.5 9.5v5M8 6.5v11M16 6.5v11M8 12h8" />
          </template>
          <template v-else-if="tab.icon === 'steps'">
            <path d="M7 3.6c1.7 0 2.7 1.4 2.7 3.4 0 1.7-.6 2.8-.6 4 0 1 .7 1.7.7 2.9 0 1.4-1.1 2.5-2.8 2.5s-2.8-1.1-2.8-2.5c0-1.2.7-1.9.7-2.9 0-1.2-.6-2.3-.6-4C4.3 5 5.3 3.6 7 3.6Z" />
            <path d="M17 7.6c1.7 0 2.7 1.4 2.7 3.4 0 1.7-.6 2.8-.6 4 0 1 .7 1.7.7 2.9 0 1.4-1.1 2.5-2.8 2.5s-2.8-1.1-2.8-2.5c0-1.2.7-1.9.7-2.9 0-1.2-.6-2.3-.6-4 0-2 1-3.4 2.7-3.4Z" />
          </template>
          <template v-else-if="tab.icon === 'week'">
            <rect x="3.5" y="5" width="17" height="15" rx="3.2" />
            <path d="M3.5 10h17M9 10v10M15 10v10" />
          </template>
          <template v-else>
            <path d="M4 19.5V4.5M4 19.5h16" />
            <path d="m7.5 15 3.4-4.2 3 2.4 4.6-6" />
          </template>
        </svg>
        <span>{{ tab.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  padding-bottom: var(--safe-bottom);
  background: color-mix(in srgb, var(--bg-soft) 86%, transparent);
  backdrop-filter: saturate(1.7) blur(18px);
  -webkit-backdrop-filter: saturate(1.7) blur(18px);
  border-top: 1px solid var(--border);
}

.inner {
  position: relative;
  display: flex;
  width: 100%;
  max-width: 460px;
  margin: 0 auto;
}

/* Pilulka pod aktivní záložkou se posouvá místo toho, aby probliknutím
   přeskočila – pohyb pomáhá pochopit, kam jsem se dostal. */
.pill {
  position: absolute;
  top: 6px;
  left: 0;
  width: 20%;
  height: calc(var(--tabbar-height) - 12px);
  padding: 0 8px;
  background-clip: content-box;
  background-color: var(--accent-soft);
  border-radius: 15px;
  transition: transform 0.34s var(--ease);
}

.tab {
  position: relative;
  flex: 1;
  height: var(--tabbar-height);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-decoration: none;
  color: var(--text-faint);
  font-size: 0.675rem;
  font-weight: 650;
  letter-spacing: -0.005em;
  transition: color 0.22s var(--ease);
}

.tab.active { color: var(--accent); }
.tab:active .icon { transform: scale(0.9); }

.icon {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.18s var(--ease-spring);
}
</style>
