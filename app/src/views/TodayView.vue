<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import ProgressRing from '@/components/ProgressRing.vue'
import ProgressBar from '@/components/ProgressBar.vue'
import WeekStrip from '@/components/WeekStrip.vue'
import { formatDay, weekdayLong } from '@/lib/date'
import { num, parseNumber, steps as fmtSteps, walkTime } from '@/lib/format'
import { buildDay, blockEmoji } from '@/lib/plan'
import type { PaceStatus } from '@/lib/engine'
import {
  addSteps,
  currentWeek,
  isBlockDone,
  setNote,
  setRestDay,
  setSteps,
  state,
  stepsNeededToday,
  streakData,
  today,
  todayLog,
  todayStatus,
  toggleTaskDone,
  weekSummary,
} from '@/stores/app'

const router = useRouter()

const plans = computed(() => buildDay(state, today.value))
const week = computed(() => weekSummary.value)

const walked = computed(() => todayStatus.value.steps)
const needed = computed(() => stepsNeededToday.value)
const portion = computed(() => week.value.steps.todayShare)
const ringPercent = computed(() => (portion.value > 0 ? (walked.value / portion.value) * 100 : 100))

const debt = computed(() => week.value.steps.debtIn)
const restDay = computed(() => !!todayLog.value?.restDay)

const greeting = computed(() => {
  const h = new Date().getHours()
  const name = state.settings.name?.trim()
  const long = h < 10 ? 'Dobré ráno' : h < 17 ? 'Ahoj' : 'Dobrý večer'
  if (!name) return long
  // „Dobrý večer, Bartoloměji“ by se zalomilo přes dva řádky a rozhodilo
  // hlavičku. S delším jménem se použije kratší pozdrav, ne holé jméno.
  return long.length + name.length > 16 ? `Ahoj, ${name}` : `${long}, ${name}`
})

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

/* Kroky --------------------------------------------------------------- */

const quickInput = ref<string | number>('')
const QUICK_ADDS = [500, 1000, 2000]

function saveQuick(): void {
  const value = parseNumber(quickInput.value)
  if (value === null || value < 0) return
  setSteps(today.value, value, 'manual')
  quickInput.value = ''
}

/* Poznámka a volno ----------------------------------------------------- */

const noteOpen = ref(false)
const noteDraft = ref('')

function openNote(): void {
  noteDraft.value = todayLog.value?.note ?? ''
  noteOpen.value = true
}

function saveNote(): void {
  setNote(today.value, noteDraft.value)
  noteOpen.value = false
}

/* Úkoly ---------------------------------------------------------------- */

const openTasks = computed(() => week.value.tasks.filter((t) => t.remaining > 0))
const blocksDone = computed(() => todayStatus.value.blocksDone)
const allBlocksDone = computed(() => blocksDone.value >= plans.value.length)
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">{{ weekdayLong(today) }} {{ formatDay(today) }}</div>
        <h1>{{ greeting }}</h1>
      </div>
      <div class="row" style="gap: 8px">
        <div
          v-if="streakData.days > 0"
          class="badge badge-accent"
          :title="`Série ${streakData.days} dní · záchrany ${streakData.freezesLeft}`"
        >
          🔥 {{ streakData.days }}
        </div>
        <!-- Jediná cesta do nastavení – v dolní liště na něj není místo. -->
        <RouterLink to="/nastaveni" class="icon-btn" aria-label="Nastavení">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3.1" />
            <path
              d="M19.1 14.6a1.6 1.6 0 0 0 .32 1.77l.06.06a1.94 1.94 0 1 1-2.75 2.75l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47v.17a1.94 1.94 0 1 1-3.88 0v-.09a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a1.94 1.94 0 1 1-2.75-2.75l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3.1a1.94 1.94 0 1 1 0-3.88h.09a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06A1.94 1.94 0 1 1 7.03 4.2l.06.06a1.6 1.6 0 0 0 1.77.32h.08a1.6 1.6 0 0 0 .97-1.47V3.1a1.94 1.94 0 1 1 3.88 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.94 1.94 0 1 1 2.75 2.75l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.47.97h.17a1.94 1.94 0 1 1 0 3.88h-.09a1.6 1.6 0 0 0-1.47.97z"
            />
          </svg>
        </RouterLink>
      </div>
    </header>

    <div class="stack">
      <!-- Kroky ------------------------------------------------------- -->
      <section class="card card-hero">
        <div class="hero-top">
          <ProgressRing
            :percent="ringPercent"
            :marker="week.steps.required > 0 ? (week.steps.expectedByNow / week.steps.required) * 100 : null"
            :color="stepColor"
            :size="124"
            :thickness="11"
          >
            <div class="ring-value num">{{ num(walked) }}</div>
            <div class="ring-sub tiny">z {{ num(portion) }}</div>
          </ProgressRing>

          <div class="grow">
            <div class="eyebrow" style="margin-bottom: 2px">
              {{ restDay ? 'Dnes je volno' : 'Dnes ještě' }}
            </div>
            <div class="display" :style="{ color: restDay ? 'var(--info)' : stepColor }">
              {{ restDay ? '—' : needed > 0 ? num(needed) : 'hotovo' }}
            </div>
            <div class="tiny muted" style="margin-top: 4px">
              <template v-if="restDay">Den odpočinku se do série počítá.</template>
              <template v-else-if="needed > 0">{{ walkTime(needed) }}</template>
              <template v-else>Denní porce je doma.</template>
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
            aria-label="Zapsat kroky"
            @keyup.enter="saveQuick"
          />
          <button class="btn btn-primary" :disabled="!quickInput" @click="saveQuick">Uložit</button>
        </div>

        <div class="divider" style="margin: 16px 0 12px" />
        <WeekStrip :week="currentWeek" :today="today" />

        <div v-if="todayLog?.stepsSource === 'shortcut'" class="tiny faint" style="margin-top: 12px">
          Kroky přišly automaticky z Apple Health.
        </div>
      </section>

      <!-- Dluh -------------------------------------------------------- -->
      <RouterLink v-if="debt > 0" to="/tyden" class="card debt-card link-plain">
        <div class="row-between">
          <div>
            <div class="strong c-warn">Z minulého týdne visí {{ num(debt) }} kroků</div>
            <div class="tiny muted">
              Rozpustilo se to do zbytku týdne, proto je dnešní porce vyšší než obvykle.
            </div>
          </div>
          <span class="faint" aria-hidden="true">›</span>
        </div>
      </RouterLink>

      <!-- Bloky cvičení ----------------------------------------------- -->
      <section>
        <div class="row-between" style="margin-bottom: 10px">
          <h2>Cvičení</h2>
          <span class="badge" :class="allBlocksDone ? 'badge-accent' : ''">
            {{ blocksDone }}/{{ plans.length }} hotovo
          </span>
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
              <span class="tiny faint num">{{ Math.round(plan.totalSeconds / 60) }} min</span>
              <span class="check" :class="{ on: isBlockDone(today, plan.slot) }" aria-hidden="true">✓</span>
            </span>
          </button>
        </div>
      </section>

      <!-- Týden ------------------------------------------------------- -->
      <RouterLink to="/tyden" class="card link-plain">
        <div class="row-between" style="margin-bottom: 12px">
          <div class="card-title" style="margin: 0">Týden</div>
          <span class="tiny faint">
            {{ week.daysRemaining }} {{ week.daysRemaining === 1 ? 'den' : week.daysRemaining < 5 ? 'dny' : 'dní' }} zbývá
          </span>
        </div>
        <div class="stack-sm">
          <div>
            <div class="row-between tiny" style="margin-bottom: 5px">
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
            <div class="row-between tiny" style="margin-bottom: 5px">
              <span class="muted">Bloky</span>
              <span class="num muted">{{ week.blocks.achieved }} / {{ week.blocks.required }}</span>
            </div>
            <ProgressBar :percent="week.blocks.progressPct" :color="paceColor(week.blocks.pace)" />
          </div>
        </div>
      </RouterLink>

      <!-- Úkoly ------------------------------------------------------- -->
      <section v-if="openTasks.length" class="card">
        <div class="card-title">Zbývá tenhle týden</div>
        <ul class="list-reset stack-sm">
          <li v-for="t in openTasks" :key="t.task.id" class="task-row">
            <button class="tick" :aria-label="`Splnit ${t.task.title}`" @click="toggleTaskDone(t.task.id)" />
            <span class="grow">
              {{ t.task.emoji }} {{ t.task.title }}
              <span v-if="t.target > 1" class="tiny faint num">{{ t.done }}/{{ t.target }}</span>
            </span>
            <span v-if="t.carried > 0" class="badge badge-warn">z minula</span>
          </li>
        </ul>
      </section>

      <!-- Volno a poznámka -------------------------------------------- -->
      <section class="card">
        <div class="row-between">
          <div class="grow">
            <div class="strong small">Den odpočinku</div>
            <div class="tiny faint">
              Nemoc, služebka, opravdu nabitý den. Nezapočítá se jako propadnutí.
            </div>
          </div>
          <button
            class="switch"
            role="switch"
            :aria-checked="restDay"
            aria-label="Označit dnešek jako den odpočinku"
            @click="setRestDay(today, !restDay)"
          >
            <span class="knob" />
          </button>
        </div>

        <div class="divider" style="margin: 14px 0 12px" />

        <div v-if="!noteOpen">
          <button class="note-btn" @click="openNote">
            <span v-if="todayLog?.note" class="small">{{ todayLog.note }}</span>
            <span v-else class="small faint">Přidat poznámku k dnešku…</span>
          </button>
        </div>
        <div v-else class="stack-sm">
          <textarea v-model="noteDraft" placeholder="Co se dnes povedlo nebo nepovedlo…" maxlength="500" />
          <div class="row" style="gap: 8px">
            <button class="btn btn-sm btn-primary" @click="saveNote">Uložit poznámku</button>
            <button class="btn btn-sm btn-ghost" @click="noteOpen = false">Zrušit</button>
          </div>
        </div>
      </section>

      <p class="tiny faint center">
        {{ fmtSteps(week.steps.remaining) }} do splnění týdne · {{ walkTime(week.steps.remaining) }}
      </p>
    </div>
  </main>
</template>

<style scoped>
.hero-top {
  display: flex;
  align-items: center;
  gap: 18px;
}

.ring-value {
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.ring-sub { color: var(--text-faint); margin-top: 1px; }

.adds {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  margin-top: 18px;
}

.quick-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.quick-row input { flex: 1; }

.debt-card {
  border-color: var(--warn-line);
  background: color-mix(in srgb, var(--warn-soft) 55%, var(--surface));
}

.block-row {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  padding: 14px 15px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: transform 0.12s var(--ease), border-color 0.2s var(--ease);
}

.block-row:active { transform: scale(0.99); }
.block-row.done { border-color: var(--accent-line); }

.block-row .emoji { font-size: 1.4rem; line-height: 1; }

.block-row .text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.block-row .meta {
  display: flex;
  align-items: center;
  gap: 11px;
}

.check {
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  color: transparent;
  font-size: 0.8rem;
  font-weight: 700;
  transition: background 0.22s var(--ease), border-color 0.22s var(--ease), color 0.22s var(--ease);
}

.check.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
}

.task-row {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 0.92rem;
}

.tick {
  width: 25px;
  height: 25px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  background: transparent;
  cursor: pointer;
  transition: background 0.18s var(--ease);
}

.tick:active { background: var(--surface-3); }

.switch {
  width: 50px;
  height: 30px;
  flex-shrink: 0;
  padding: 3px;
  border-radius: 999px;
  border: 0;
  background: var(--surface-3);
  cursor: pointer;
  transition: background 0.24s var(--ease);
}

.switch[aria-checked='true'] { background: var(--info); }

.knob {
  display: block;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform 0.26s var(--ease);
}

.switch[aria-checked='true'] .knob { transform: translateX(20px); }

.note-btn {
  width: 100%;
  text-align: left;
  padding: 0;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  line-height: 1.5;
}
</style>
