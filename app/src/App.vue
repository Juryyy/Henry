<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { guardDestination } from '@/router'
import TabBar from '@/components/TabBar.vue'
import MilestoneToast from '@/components/MilestoneToast.vue'
import SignInView from '@/views/SignInView.vue'
import { applyUpdate, isIos, isStandalone, updateAvailable } from '@/lib/sw-client'
import { maybeSync, stateReady } from '@/lib/sync'
import { authReady, signedIn } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
// Dokud nevíme, jestli jsme přihlášení, nemá smysl ukazovat ani appku,
// ani přihlášení – prázdná obrazovka na půl vteřiny je lepší než probliknutí.
const showTabs = computed(() => signedIn.value && !route.meta.fullscreen)

const showInstallHint = ref(false)

onMounted(() => {
  // Na iPhonu bez „přidat na plochu“ nefungují notifikace – řekneme to hned,
  // ale jen jednou a jen když už uživatel prošel úvodním nastavením.
  const dismissed = localStorage.getItem('henry.installHintDismissed') === '1'
  showInstallHint.value = isIos() && !isStandalone() && !dismissed
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void maybeSync()
  })
})

// Synchronizovat jde až po přihlášení, a to dorazí asynchronně po startu.
// Proto se čeká na něj, ne na `onMounted` – jinak by první synchronizace
// proběhla naprázdno a data z druhého zařízení by se objevila až za pět minut.
watch(signedIn, (yes) => {
  if (yes) void maybeSync()
}, { immediate: true })

/**
 * Jakmile data dorazí, rozhodnutí padne znovu – tentokrát podle skutečného
 * stavu, ne podle prázdné místní kopie. Volá se ta samá funkce jako ve
 * strážci: opakovaná navigace na tu samou adresu by ho nespustila.
 */
watch(stateReady, (ready) => {
  if (!ready) return
  const target = guardDestination(router.currentRoute.value)
  if (target) void router.replace(target)
})

/**
 * Než se stav ustálí, appka se neukazuje. Půl vteřiny prázdna je lepší než
 * probliknutí úvodního průvodce někomu, kdo ho prošel před půl rokem.
 */
const booting = computed(() => !authReady.value || (signedIn.value && !stateReady.value))

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

    <template v-if="booting">
      <div class="loading" />
    </template>

    <SignInView v-else-if="!signedIn" />

    <RouterView v-else v-slot="{ Component }">
      <Transition name="fade" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>

    <TabBar v-if="showTabs" />
    <MilestoneToast v-if="showTabs" />
  </div>
</template>

<style scoped>
.loading { min-height: 100dvh; }

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
