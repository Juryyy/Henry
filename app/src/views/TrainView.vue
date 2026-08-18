<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { getExercise } from '@/data/exercises'
import { blockEmoji, buildDay, doseLabel } from '@/lib/plan'
import { formatDay, weekdayLong } from '@/lib/date'
import {
  completeBlock,
  isBlockDone,
  state,
  today,
  todayStatus,
  uncompleteBlock,
  weekSummary,
} from '@/stores/app'
import { blocks as fmtBlocks } from '@/lib/format'
import ProgressBar from '@/components/ProgressBar.vue'

const router = useRouter()
const plans = computed(() => buildDay(state, today.value))
const week = computed(() => weekSummary.value)

function toggleDone(slot: number): void {
  const s = slot as 0 | 1 | 2
  if (isBlockDone(today.value, s)) uncompleteBlock(today.value, s)
  else completeBlock(today.value, s, plans.value[slot]!.id)
}
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">{{ weekdayLong(today) }} {{ formatDay(today) }}</div>
        <h1>Cvičení</h1>
      </div>
      <RouterLink to="/cviky" class="btn btn-sm btn-ghost">Katalog</RouterLink>
    </header>

    <div class="stack">
      <section class="card">
        <div class="row-between tiny" style="margin-bottom: 6px">
          <span class="muted">Bloky tenhle týden</span>
          <span class="num muted">{{ week.blocks.achieved }} / {{ week.blocks.required }}</span>
        </div>
        <ProgressBar
          :percent="week.blocks.progressPct"
          :marker="week.blocks.required > 0 ? (week.blocks.expectedByNow / week.blocks.required) * 100 : null"
        />
        <p v-if="week.blocks.debtIn > 0" class="tiny c-warn" style="margin-top: 8px">
          Z minulého týdne visí {{ fmtBlocks(week.blocks.debtIn) }} navíc.
        </p>
        <p v-else class="tiny faint" style="margin-top: 8px">
          Jeden den v týdnu smíš vynechat, aniž by ti to naskočilo do dluhu.
        </p>
      </section>

      <section v-for="plan in plans" :key="plan.slot" class="card block">
        <div class="row-between" style="margin-bottom: 10px">
          <div class="row" style="gap: 10px">
            <span style="font-size: 1.3rem">{{ blockEmoji(plan.slot) }}</span>
            <div>
              <div class="strong">{{ plan.title }}</div>
              <div class="tiny faint">{{ plan.subtitle }} · {{ Math.round(plan.totalSeconds / 60) }} min</div>
            </div>
          </div>
          <button
            class="check"
            :class="{ on: isBlockDone(today, plan.slot) }"
            :aria-label="`Označit blok ${plan.title} jako hotový`"
            @click="toggleDone(plan.slot)"
          >
            ✓
          </button>
        </div>

        <ul class="list-reset exercise-list">
          <li v-for="pItem in plan.items" :key="pItem.exerciseId">
            <RouterLink :to="`/cviky/${pItem.exerciseId}`" class="ex-link">
              <span class="grow">{{ getExercise(pItem.exerciseId)?.name ?? pItem.exerciseId }}</span>
              <span class="tiny faint">{{
                getExercise(pItem.exerciseId) ? doseLabel(getExercise(pItem.exerciseId)!, pItem) : ''
              }}</span>
            </RouterLink>
          </li>
        </ul>

        <button class="btn btn-primary btn-block" style="margin-top: 12px" @click="router.push(`/cviceni/${plan.slot}`)">
          {{ isBlockDone(today, plan.slot) ? 'Projít znovu' : 'Spustit blok' }}
        </button>
      </section>

      <p class="tiny faint center">
        Dnes hotovo {{ todayStatus.blocksDone }} z {{ todayStatus.blocksTarget }}.
        Plán se každý den mírně mění, kostra zůstává.
      </p>
    </div>
  </main>
</template>

<style scoped>
.check {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  background: transparent;
  color: transparent;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}

.check.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }

.exercise-list li + li { border-top: 1px solid var(--border); }

.ex-link {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 0;
  text-decoration: none;
  color: inherit;
  font-size: 0.92rem;
}

.ex-link:active { opacity: 0.6; }
</style>
