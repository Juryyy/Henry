<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import TabBar from '@/components/TabBar.vue'
import { applyUpdate, isIos, isStandalone, updateAvailable } from '@/lib/sw-client'
import { maybeSync } from '@/lib/sync'

const route = useRoute()
const showTabs = computed(() => !route.meta.fullscreen)

const showInstallHint = ref(false)

onMounted(() => {
  // Na iPhonu bez „přidat na plochu“ nefungují notifikace – řekneme to hned,
  // ale jen jednou a jen když už uživatel prošel úvodním nastavením.
  const dismissed = localStorage.getItem('henry.installHintDismissed') === '1'
  showInstallHint.value = isIos() && !isStandalone() && !dismissed
  void maybeSync()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void maybeSync()
  })
})

function dismissHint(): void {
  localStorage.setItem('henry.installHintDismissed', '1')
  showInstallHint.value = false
}
</script>

<template>
  <div class="app-shell">
    <div v-if="showInstallHint && showTabs" class="banner">
      <div class="grow">
        <strong>Přidej si Henryho na plochu.</strong>
        <div class="tiny muted">Sdílet → Přidat na plochu. Jinak na iPhonu nepůjdou notifikace.</div>
      </div>
      <button class="btn btn-sm btn-ghost" @click="dismissHint">Rozumím</button>
    </div>

    <div v-if="updateAvailable && showTabs" class="banner update">
      <div class="grow"><strong>Je tu nová verze.</strong></div>
      <button class="btn btn-sm btn-primary" @click="applyUpdate">Načíst</button>
    </div>

    <RouterView v-slot="{ Component }">
      <Transition name="fade" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>

    <TabBar v-if="showTabs" />
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: calc(var(--safe-top) + 10px) 16px 10px;
  background: var(--info-soft);
  color: var(--text);
  font-size: 0.85rem;
}

.banner.update { background: var(--accent-soft); }
</style>
