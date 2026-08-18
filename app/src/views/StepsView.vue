<script setup lang="ts">
import { computed, ref } from 'vue'
import WeekBars from '@/components/WeekBars.vue'
import ProgressBar from '@/components/ProgressBar.vue'
import { addDays, formatDayWithWeekday, relativeDayLabel, weekDays } from '@/lib/date'
import { num, parseNumber, walkTime } from '@/lib/format'
import { dailyStepTarget } from '@/lib/engine'
import { isServerConfigured, lastSyncError, syncing, syncNow } from '@/lib/sync'
import {
  currentWeek,
  setSteps,
  state,
  stepsNeededToday,
  today,
  todayLog,
  weekSummary,
} from '@/stores/app'

const week = computed(() => weekSummary.value)

const chartDays = computed(() =>
  weekDays(currentWeek.value).map((date) => ({
    date,
    value: state.days[date]?.steps ?? 0,
    // Cíl se liší den od dne podle nastaveného rozložení, takže se sloupec
    // porovnává se svým dnem, ne s plochým průměrem.
    target: dailyStepTarget(state, date),
    future: date > today.value,
  })),
)

const avgTarget = computed(() => Math.round(state.settings.steps.weeklyTarget / 7))

/* Zápis ---------------------------------------------------------------- */

const draft = ref<string | number>('')

const todaySteps = computed(() => todayLog.value?.steps ?? 0)

function save(): void {
  const value = parseNumber(draft.value)
  if (value === null || value < 0) return
  setSteps(today.value, value, 'manual')
  draft.value = ''
}

function bump(delta: number): void {
  setSteps(today.value, Math.max(0, todaySteps.value + delta), 'manual')
}

/* Historie ------------------------------------------------------------- */

const historyDays = computed(() =>
  Array.from({ length: 21 }, (_, i) => addDays(today.value, -i)).map((date) => ({
    date,
    steps: state.days[date]?.steps ?? 0,
    target: dailyStepTarget(state, date),
    source: state.days[date]?.stepsSource,
  })),
)

function commitEdit(date: string, input: HTMLInputElement): void {
  const value = parseNumber(input.value)
  // Prázdné pole neznamená nula. Kdyby ano, stačilo by ťuknout do políčka,
  // omylem ho vymazat a přijít o celý den.
  if (value !== null && value >= 0) {
    setSteps(date, value, 'manual')
  }
  // Vrátit do pole to, co je opravdu uložené – jinak by tam odmítnutá
  // hodnota zůstala viset a tvářila se jako zapsaná.
  const stored = state.days[date]?.steps ?? 0
  input.value = stored ? String(stored) : ''
}

/* Server --------------------------------------------------------------- */

const syncMessage = ref('')

async function pull(): Promise<void> {
  syncMessage.value = ''
  const ok = await syncNow(true)
  syncMessage.value = ok ? 'Staženo z Health.' : (lastSyncError.value ?? 'Nepodařilo se.')
}
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">{{ formatDayWithWeekday(today) }}</div>
        <h1>Kroky</h1>
      </div>
      <button v-if="isServerConfigured()" class="btn btn-sm btn-ghost" :disabled="syncing" @click="pull">
        {{ syncing ? '…' : 'Stáhnout' }}
      </button>
    </header>

    <div class="stack">
      <section class="card">
        <div class="row-between" style="align-items: flex-start">
          <div>
            <div class="tiny faint">Dnes nachozeno</div>
            <div class="big-number">{{ num(todaySteps) }}</div>
          </div>
          <div class="right">
            <div class="tiny faint">Ještě dnes</div>
            <div class="strong num" :class="stepsNeededToday > 0 ? 'c-warn' : 'c-accent'">
              {{ stepsNeededToday > 0 ? num(stepsNeededToday) : 'splněno' }}
            </div>
            <div class="tiny faint">{{ stepsNeededToday > 0 ? walkTime(stepsNeededToday) : '' }}</div>
          </div>
        </div>

        <div class="input-row">
          <input
            v-model="draft"
            type="number"
            inputmode="numeric"
            :placeholder="`Např. ${num(avgTarget)}`"
            @keyup.enter="save"
          />
          <button class="btn btn-primary" :disabled="!draft" @click="save">Zapsat</button>
        </div>

        <div class="row wrap" style="gap: 6px; margin-top: 8px">
          <button class="btn btn-sm btn-ghost" @click="bump(500)">+500</button>
          <button class="btn btn-sm btn-ghost" @click="bump(1000)">+1 000</button>
          <button class="btn btn-sm btn-ghost" @click="bump(2500)">+2 500</button>
          <button class="btn btn-sm btn-ghost" @click="bump(-500)">−500</button>
        </div>

        <p v-if="syncMessage" class="tiny muted" style="margin-top: 8px">{{ syncMessage }}</p>
        <p v-if="todayLog?.stepsSource === 'shortcut'" class="tiny faint" style="margin-top: 8px">
          Poslední hodnota přišla automaticky z Apple Health.
        </p>
      </section>

      <!-- Týden ------------------------------------------------------- -->
      <section class="card">
        <div class="card-title">Tenhle týden</div>
        <WeekBars :days="chartDays" :target="avgTarget" />

        <div class="divider" style="margin: 14px 0 10px" />

        <div class="row-between tiny" style="margin-bottom: 4px">
          <span class="muted">Splněno z týdenního cíle</span>
          <span class="num muted">{{ num(week.steps.achieved) }} / {{ num(week.steps.required) }}</span>
        </div>
        <ProgressBar
          :percent="week.steps.progressPct"
          :marker="week.steps.required > 0 ? (week.steps.expectedByNow / week.steps.required) * 100 : null"
          :debt-percent="week.steps.required > 0 ? (week.steps.debtIn / week.steps.required) * 100 : 0"
        />
        <p class="tiny faint" style="margin-top: 8px">
          <template v-if="week.steps.debtIn > 0">
            V tom je {{ num(week.steps.debtIn) }} dluhu z minulého týdne (šrafovaná část).
          </template>
          <template v-else-if="week.steps.creditIn > 0">
            Z minula si neseš {{ num(week.steps.creditIn) }} kroků k dobru – cíl je o tolik nižší.
          </template>
          <template v-else> Cíl {{ num(week.steps.base) }} kroků za týden, bez dluhu. </template>
        </p>
      </section>

      <!-- Historie ---------------------------------------------------- -->
      <section class="card">
        <div class="card-title">Posledních 21 dní</div>
        <ul class="list-reset history">
          <li v-for="row in historyDays" :key="row.date">
            <span class="day">{{ relativeDayLabel(row.date, today) }}</span>
            <span class="grow">
              <ProgressBar
                :percent="row.target > 0 ? (row.steps / row.target) * 100 : 0"
                :height="6"
                :color="row.steps >= row.target ? 'var(--accent)' : 'var(--text-faint)'"
              />
            </span>
            <!-- Input je v DOMu pořád. Kdyby se objevil až po kliknutí,
                 iOS by k němu neotevřel klávesnici – fokus nastavený mimo
                 přímou reakci na dotek Safari ignoruje. -->
            <input
              class="edit num"
              type="number"
              inputmode="numeric"
              :value="row.steps || ''"
              :aria-label="`Kroky ${row.date}`"
              placeholder="0"
              @change="commitEdit(row.date, $event.target as HTMLInputElement)"
            />
          </li>
        </ul>
        <p class="tiny faint" style="margin-top: 10px">Číslo se dá rovnou přepsat.</p>
      </section>

      <RouterLink v-if="!isServerConfigured()" to="/nastaveni" class="card link-card">
        <div class="strong">Naimportovat kroky automaticky?</div>
        <div class="tiny muted">
          Zkratka v iOS umí každý večer poslat počet kroků z Health rovnou sem. Nastavení → Server.
        </div>
      </RouterLink>
    </div>
  </main>
</template>

<style scoped>
.right { text-align: right; }

.input-row {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.input-row input { flex: 1; }

.history li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
}

.history li + li { border-top: 1px solid var(--border); }

.day {
  width: 68px;
  flex-shrink: 0;
  font-size: 0.8rem;
  color: var(--text-dim);
}

.edit {
  width: 82px;
  flex-shrink: 0;
  min-height: 34px;
  padding: 2px 8px;
  text-align: right;
  /* 16px, aby iOS při fokusu nezoomoval; opticky to sráží menší výška. */
  font-size: 16px;
  background: transparent;
  border-color: transparent;
}

.edit:focus {
  background: var(--surface-2);
  border-color: var(--accent);
}

.link-card { display: block; text-decoration: none; color: inherit; }
</style>
