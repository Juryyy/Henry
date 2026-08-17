<script setup lang="ts">
import { freshMilestones } from '@/stores/app'

/**
 * Gratulace k milníku. Zobrazí se přes obsah, zavírá se klepnutím.
 * Fronta se odbavuje po jednom – dvě oslavy naráz vyzní jako spam.
 */

function dismiss(): void {
  freshMilestones.value = freshMilestones.value.slice(1)
}
</script>

<template>
  <Transition name="pop">
    <div v-if="freshMilestones.length" class="wrap" role="status" @click="dismiss">
      <div class="toast">
        <div class="emoji">{{ freshMilestones[0].emoji }}</div>
        <div class="grow">
          <div class="eyebrow" style="margin: 0">Milník</div>
          <div class="title">{{ freshMilestones[0].title }}</div>
          <div class="tiny muted">{{ freshMilestones[0].detail }}</div>
        </div>
        <button class="icon-btn" aria-label="Zavřít" @click.stop="dismiss">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.wrap {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(var(--tabbar-height) + var(--safe-bottom) + 12px);
  z-index: 60;
  display: flex;
  justify-content: center;
}

.toast {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  max-width: calc(var(--page-max) - 24px);
  padding: 14px;
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1px solid var(--accent-line);
  box-shadow: var(--shadow);
}

.emoji {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: var(--accent-soft);
  font-size: 1.5rem;
}

.title {
  font-weight: 680;
  letter-spacing: -0.015em;
  margin-bottom: 1px;
}
</style>
