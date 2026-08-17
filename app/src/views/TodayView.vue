<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import ProgressRing from '@/components/ProgressRing.vue'
import ProgressBar from '@/components/ProgressBar.vue'
import { formatDay, weekdayLong } from '@/lib/date'
import { num, steps as fmtSteps, walkTime } from '@/lib/format'
import { buildDay, blockEmoji } from '@/lib/plan'
import type { PaceStatus } from '@/lib/engine'
import {
  addSteps,
  isBlockDone,
  setSteps,
  state,
  stepsNeededToday,
  streak,
  today,
  todayLog,
  todayStatus,
  toggleTaskDone,
  weekSummary,
} from '@/stores/app'

const router = useRouter()

const plans = computed(() => buildDay(state, today.value))

const walked = computed(() => todayStatus.value.steps)
const needed = computed(() => stepsNeededToday.value)
const ringPercent = computed(() => {
  const goal = walked.value + needed.value
  return goal > 0 ? (walked.value / goal) * 100 : 100
})

const week = computed(() => weekSummary.value)
const debt = computed(() => week.value.steps.debtIn)

const greeting = computed(() => {
  const h = new Date().getHours()
  const name = state.settings.name?.trim()
  const base = h < 10 ? 'Dobré ráno' : h < 17 ? 'Ahoj' : 'Dobrý večer'
  return name ? `${base}, ${name}` : base
})

const blocksDone = computed(() => todayStatus.value.blocksDone)

/* Rychlé přidání kroků ------------------------------------------------ */

const quickInput = ref<string>('')

function saveQuick(): void {
  const value = Number(quickInput.value.replace(/\s/g, ''))
  if (Number.isFinite(value) && value >= 0) {
    setSteps(today.value, value, 'manual')
    quickInput.value = ''
  }
}

const QUICK_ADDS = [500, 1000, 2000]

/* Týdenní úkoly ------------------------------------------------------- */

const openTasks = computed(() => week.value.tasks.filter((t) => t.remaining > 0))

/**
 * Barva se řídí tempem vůči tomu, kde bys touhle dobou měl být – ne holým
 * procentem. Jinak by ráno svítilo všechno červeně, což je nejlepší způsob,
 * jak si den zkazit hned po probuzení.
 */
function paceColor(pace: PaceStatus): string {
  switch (pace) {
    case 'done':
    case 'ahead':
      return 'var(--accent)'
    case 'on-track':
      return 'var(--info)'
    case 'behind':
      return 'var(--warn)'
    default:
      return 'var(--danger)'
  }
}

const stepColor = computed(() => paceColor(week.value.steps.pace))
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">{{ weekdayLong(today) }} {{ formatDay(today) }}</div>
        <h1>{{ greeting }}</h1>
      </div>
      <div v-if="streak > 0" class="badge badge-accent" title="Série splněných dní">
        🔥 {{ streak }}
      </div>
    </header>

    <div class="stack">
      <!-- Kroky ------------------------------------------------------- -->
      <section class="card steps-card">
        <div class="row" style="gap: 18px">
          <ProgressRing
            :percent="ringPercent"
            :marker="week.steps.required > 0 ? (week.steps.expectedByNow / week.steps.required) * 100 : null"
            :color="stepColor"
            :size="132"
          >
            <div class="value num">{{ num(walked) }}</div>
            <div class="sub">z {{ num(walked + needed) }}</div>
          </ProgressRing>

          <div class="grow stack-sm">
            <div>
              <div class="tiny faint">Dnes ještě</div>
              <div class="big-number" :style="{ color: stepColor }">
                {{ needed > 0 ? num(needed) : 'hotovo' }}
              </div>
              <div class="tiny muted">{{ needed > 0 ? walkTime(needed) : 'Denní porce je doma.' }}</div>
            </div>
            <div class="tiny faint">
              Cíl dne {{ num(walked + needed) }} · týdně {{ num(week.steps.required) }}
            </div>
          </div>
        </div>

        <div class="adds">
          <button v-for="q in QUICK_ADDS" :key="q" class="btn btn-sm btn-ghost" @click="addSteps(today, q)">
            +{{ num(q) }}
          </button>
        </div>

        <div class="quick-row">
          <input
            v-model="quickInput"
            type="number"
            inputmode="numeric"
            placeholder="Zapsat kroky z hodinek…"
            @keyup.enter="saveQuick"
          />
          <button class="btn btn-sm btn-primary" :disabled="!quickInput" @click="saveQuick">Uložit</button>
        </div>

        <div v-if="todayLog?.stepsSource === 'shortcut'" class="tiny faint" style="margin-top: 6px">
          Automaticky z Apple Health.
        </div>
      </section>

      <!-- Dluh -------------------------------------------------------- -->
      <RouterLink v-if="debt > 0" to="/tyden" class="card debt-card">
        <div class="row-between">
          <div>
            <div class="strong c-warn">Dluh z minulého týdne: {{ num(debt) }}</div>
            <div class="tiny muted">
              Rozpustil se do zbytku týdne. Denní porce je proto vyšší než obvykle.
            </div>
          </div>
          <span class="faint">›</span>
        </div>
      </RouterLink>

      <!-- Bloky cvičení ----------------------------------------------- -->
      <section>
        <div class="row-between" style="margin-bottom: 8px">
          <h2>Cvičení</h2>
          <span class="tiny faint">{{ blocksDone }}/{{ plans.length }} hotovo</span>
        </div>
        <div class="stack-sm">
          <button
            v-for="plan in plans"
            :key="plan.slot"
            class="block-row"
            :class="{ done: isBlockDone(today, plan.slot) }"
            @click="router.push(`/cviceni/${plan.slot}`)"
          >
            <span class="emoji">{{ blockEmoji(plan.slot) }}</span>
            <span class="grow text">
              <span class="strong">{{ plan.title }}</span>
              <span class="tiny muted">{{ plan.subtitle }}</span>
            </span>
            <span class="meta">
              <span class="tiny faint">{{ Math.round(plan.totalSeconds / 60) }} min</span>
              <span class="check" :class="{ on: isBlockDone(today, plan.slot) }">✓</span>
            </span>
          </button>
        </div>
      </section>

      <!-- Týden ------------------------------------------------------- -->
      <RouterLink to="/tyden" class="card week-card">
        <div class="row-between" style="margin-bottom: 10px">
          <div class="card-title" style="margin: 0">Týden</div>
          <span class="tiny faint">{{ week.daysRemaining }} dní zbývá</span>
        </div>
        <div class="stack-sm">
          <div>
            <div class="row-between tiny" style="margin-bottom: 4px">
              <span class="muted">Kroky</span>
              <span class="num muted">{{ num(week.steps.achieved) }} / {{ num(week.steps.required) }}</span>
            </div>
            <ProgressBar
              :percent="week.steps.progressPct"
              :marker="week.steps.required > 0 ? (week.steps.expectedByNow / week.steps.required) * 100 : null"
              :debt-percent="week.steps.required > 0 ? (week.steps.debtIn / week.steps.required) * 100 : 0"
              :color="stepColor"
            />
          </div>
          <div>
            <div class="row-between tiny" style="margin-bottom: 4px">
              <span class="muted">Bloky</span>
              <span class="num muted">{{ week.blocks.achieved }} / {{ week.blocks.required }}</span>
            </div>
            <ProgressBar
              :percent="week.blocks.progressPct"
              :marker="week.blocks.required > 0 ? (week.blocks.expectedByNow / week.blocks.required) * 100 : null"
              :color="paceColor(week.blocks.pace)"
            />
          </div>
        </div>
      </RouterLink>

      <!-- Úkoly ------------------------------------------------------- -->
      <section v-if="openTasks.length" class="card">
        <div class="card-title">Zbývá tenhle týden</div>
        <ul class="list-reset stack-sm">
          <li v-for="t in openTasks" :key="t.task.id" class="task-row">
            <button class="tick" @click="toggleTaskDone(t.task.id)" :aria-label="`Splnit ${t.task.title}`" />
            <span class="grow">
              {{ t.task.emoji }} {{ t.task.title }}
              <span v-if="t.target > 1" class="tiny faint">({{ t.done }}/{{ t.target }})</span>
            </span>
            <span v-if="t.carried > 0" class="badge badge-warn tiny">z minula</span>
          </li>
        </ul>
      </section>

      <p class="tiny faint center" style="margin-top: 4px">
        {{ fmtSteps(week.steps.remaining) }} do splnění týdne · {{ walkTime(week.steps.remaining) }}
      </p>
    </div>
  </main>
</template>

<style scoped>
.steps-card .value { font-size: 1.5rem; }

.adds {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 14px;
}

.quick-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.quick-row input { flex: 1; }

.debt-card {
  display: block;
  text-decoration: none;
  color: inherit;
  border-color: color-mix(in srgb, var(--warn) 40%, var(--border));
  background: color-mix(in srgb, var(--warn-soft) 60%, var(--surface));
}

.block-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  text-align: left;
  cursor: pointer;
  transition: transform 0.08s ease, border-color 0.15s ease;
}

.block-row:active { transform: scale(0.99); }
.block-row.done { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }

.block-row .emoji { font-size: 1.35rem; }

.block-row .text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.block-row .meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.check {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  color: transparent;
  font-size: 0.8rem;
  font-weight: 700;
}

.check.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #06120b;
}

.week-card { display: block; text-decoration: none; color: inherit; }

.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.92rem;
}

.tick {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  background: transparent;
  cursor: pointer;
}

.tick:active { background: var(--surface-3); }
</style>
