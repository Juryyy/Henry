<script setup lang="ts">
import { computed, ref } from 'vue'
import ProgressBar from '@/components/ProgressBar.vue'
import { addWeeks, formatWeekRange, weekDays, type WeekKey } from '@/lib/date'
import { blocks as fmtBlocks, num, steps as fmtSteps, walkTime } from '@/lib/format'
import { dayStatus, summarizeWeek } from '@/lib/engine'
import {
  canDeclareBankruptcy,
  currentWeek,
  declareBankruptcy,
  state,
  today,
  toggleTaskDone,
} from '@/stores/app'

const viewWeek = ref<WeekKey>(currentWeek.value)

const summary = computed(() => summarizeWeek(state, viewWeek.value, today.value))
const isCurrent = computed(() => viewWeek.value === currentWeek.value)
const canGoForward = computed(() => viewWeek.value < currentWeek.value)

function shift(delta: number): void {
  const next = addWeeks(viewWeek.value, delta)
  if (next > currentWeek.value) return
  viewWeek.value = next
}

const dayCells = computed(() =>
  weekDays(viewWeek.value).map((date, index) => ({
    index,
    label: ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'][index],
    ...dayStatus(state, date, today.value),
  })),
)

/* Uzavřené týdny ------------------------------------------------------- */

const closedEntries = computed(() =>
  state.ledger
    .filter((e) => e.kind === 'steps')
    .slice()
    .sort((a, b) => b.week.localeCompare(a.week))
    .slice(0, 8),
)

/* Bankrot -------------------------------------------------------------- */

const showBankruptcy = ref(false)
const bankruptcyDone = ref(false)

function doBankruptcy(): void {
  if (declareBankruptcy('all', 'ručně vyhlášeno v appce')) {
    bankruptcyDone.value = true
    showBankruptcy.value = false
  }
}

const totalDebt = computed(() => summary.value.steps.debtIn)

function paceLabel(pace: string): { text: string; cls: string } {
  switch (pace) {
    case 'done':
      return { text: 'splněno', cls: 'badge-accent' }
    case 'ahead':
      return { text: 's náskokem', cls: 'badge-accent' }
    case 'on-track':
      return { text: 'v tempu', cls: 'badge-info' }
    case 'behind':
      return { text: 'mírně pozadu', cls: 'badge-warn' }
    default:
      return { text: 'hodně pozadu', cls: 'badge-danger' }
  }
}
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">{{ isCurrent ? 'Tenhle týden' : 'Minulý týden' }}</div>
        <h1>{{ formatWeekRange(viewWeek) }}</h1>
      </div>
      <div class="row" style="gap: 4px">
        <button class="btn btn-sm btn-ghost" @click="shift(-1)">‹</button>
        <button class="btn btn-sm btn-ghost" :disabled="!canGoForward" @click="shift(1)">›</button>
      </div>
    </header>

    <div class="stack">
      <!-- Dny --------------------------------------------------------- -->
      <section class="card">
        <div class="days">
          <div v-for="cell in dayCells" :key="cell.date" class="day-cell">
            <div class="tiny faint">{{ cell.label }}</div>
            <div
              class="dot"
              :class="{
                full: cell.counts && !cell.isFuture,
                part: !cell.counts && cell.score > 0 && !cell.isFuture,
                future: cell.isFuture,
              }"
            >
              <span v-if="cell.restDay">z</span>
            </div>
            <div class="tiny faint num">{{ cell.isFuture ? '' : Math.round(cell.score) }}</div>
          </div>
        </div>
        <p class="tiny faint center" style="margin-top: 8px">
          Skóre dne = půl kroky, půl bloky. Od 60 se den počítá do série.
        </p>
      </section>

      <!-- Kroky ------------------------------------------------------- -->
      <section class="card">
        <div class="row-between" style="margin-bottom: 8px">
          <div class="card-title" style="margin: 0">Kroky</div>
          <span class="badge" :class="paceLabel(summary.steps.pace).cls">{{ paceLabel(summary.steps.pace).text }}</span>
        </div>
        <ProgressBar
          :percent="summary.steps.progressPct"
          :marker="summary.steps.required > 0 ? (summary.steps.expectedByNow / summary.steps.required) * 100 : null"
          :debt-percent="summary.steps.required > 0 ? (summary.steps.debtIn / summary.steps.required) * 100 : 0"
          :height="12"
        />
        <div class="rows">
          <div class="line"><span class="muted">Základní cíl</span><span class="num">{{ num(summary.steps.base) }}</span></div>
          <div v-if="summary.steps.debtIn > 0" class="line">
            <span class="c-warn">+ dluh z minula</span><span class="num c-warn">{{ num(summary.steps.debtIn) }}</span>
          </div>
          <div v-if="summary.steps.creditIn > 0" class="line">
            <span class="c-accent">− kredit z minula</span><span class="num c-accent">{{ num(summary.steps.creditIn) }}</span>
          </div>
          <div class="line total"><span>Splnit celkem</span><span class="num">{{ num(summary.steps.required) }}</span></div>
          <div class="line"><span class="muted">Nachozeno</span><span class="num">{{ num(summary.steps.achieved) }}</span></div>
          <div class="line total">
            <span>Zbývá</span>
            <span class="num">{{ num(summary.steps.remaining) }}</span>
          </div>
        </div>
        <p v-if="isCurrent && summary.steps.remaining > 0" class="tiny muted" style="margin-top: 8px">
          Na zbývajících {{ summary.daysRemaining }} dní vychází {{ num(summary.steps.perRemainingDay) }} kroků denně
          ({{ walkTime(summary.steps.perRemainingDay) }}).
        </p>
      </section>

      <!-- Bloky ------------------------------------------------------- -->
      <section class="card">
        <div class="row-between" style="margin-bottom: 8px">
          <div class="card-title" style="margin: 0">Bloky cvičení</div>
          <span class="badge" :class="paceLabel(summary.blocks.pace).cls">{{ paceLabel(summary.blocks.pace).text }}</span>
        </div>
        <ProgressBar :percent="summary.blocks.progressPct" :height="12" />
        <div class="rows">
          <div class="line"><span class="muted">Splnit</span><span class="num">{{ summary.blocks.required }}</span></div>
          <div class="line"><span class="muted">Odcvičeno</span><span class="num">{{ summary.blocks.achieved }}</span></div>
          <div class="line total"><span>Zbývá</span><span class="num">{{ summary.blocks.remaining }}</span></div>
        </div>
        <p class="tiny faint" style="margin-top: 8px">
          Z 21 možných bloků se vyžaduje {{ summary.blocks.base }} – jeden celý den v týdnu smíš vynechat.
        </p>
      </section>

      <!-- Úkoly ------------------------------------------------------- -->
      <section class="card">
        <div class="card-title">Týdenní úkoly</div>
        <ul class="list-reset stack-sm">
          <li v-for="t in summary.tasks" :key="t.task.id" class="task">
            <button
              class="tick"
              :class="{ on: t.remaining === 0 }"
              :disabled="!isCurrent"
              @click="toggleTaskDone(t.task.id)"
            >
              ✓
            </button>
            <span class="grow">
              {{ t.task.emoji }} {{ t.task.title }}
              <span v-if="t.target > 1" class="tiny faint">{{ t.done }}/{{ t.target }}</span>
            </span>
            <span v-if="t.carried > 0" class="badge badge-warn">+1 z minula</span>
          </li>
        </ul>
        <p class="tiny faint" style="margin-top: 10px">
          Nesplněný úkol se přenáší, ale maximálně o jeden kus – tři posilovny v jednom týdnu nikdo nedá.
        </p>
      </section>

      <!-- Dluh a bankrot ---------------------------------------------- -->
      <section v-if="isCurrent" class="card">
        <div class="card-title">Dluh</div>
        <p v-if="totalDebt > 0" class="small">
          Neseš si {{ fmtSteps(totalDebt) }} z minulého týdne. Strop je
          {{ num(Math.round((state.settings.steps.weeklyTarget / 7) * state.settings.steps.debtCapDays)) }} –
          víc se nikdy nepřenese, i kdyby ses týden vůbec nehnul.
        </p>
        <p v-else class="small muted">Žádný dluh. Čistý stůl.</p>

        <template v-if="totalDebt > 0">
          <button v-if="!showBankruptcy" class="btn btn-sm btn-ghost" style="margin-top: 10px" @click="showBankruptcy = true">
            Vyhlásit bankrot
          </button>
          <div v-else class="bankruptcy">
            <p class="small">
              Bankrot smaže celý dluh a začneš od nuly. Není to podvod – je to pojistka, aby ses
              po zkaženém měsíci nevykašlal na všechno. Jde to jednou za 30 dní.
            </p>
            <div class="row" style="gap: 8px">
              <button class="btn btn-sm btn-danger grow" :disabled="!canDeclareBankruptcy()" @click="doBankruptcy">
                {{ canDeclareBankruptcy() ? 'Smazat dluh' : 'Až za měsíc' }}
              </button>
              <button class="btn btn-sm btn-ghost" @click="showBankruptcy = false">Zpět</button>
            </div>
          </div>
          <p v-if="bankruptcyDone" class="tiny c-accent" style="margin-top: 8px">Hotovo. Jedeme dál.</p>
        </template>
      </section>

      <!-- Uzavřené týdny ---------------------------------------------- -->
      <section v-if="closedEntries.length" class="card">
        <div class="card-title">Uzavřené týdny</div>
        <ul class="list-reset">
          <li v-for="entry in closedEntries" :key="entry.week" class="ledger">
            <span class="grow small">{{ formatWeekRange(entry.week) }}</span>
            <span v-if="entry.skipped" class="badge">bez dat</span>
            <span v-else-if="entry.debt > 0" class="badge badge-warn num">dluh {{ num(entry.debt) }}</span>
            <span v-else-if="entry.credit > 0" class="badge badge-accent num">+{{ num(entry.credit) }}</span>
            <span v-else class="badge badge-accent">splněno</span>
            <span v-if="entry.raisedTargetTo" class="badge badge-violet num" :title="'Cíl zvednutý na ' + num(entry.raisedTargetTo)">
              ↑ {{ num(entry.raisedTargetTo) }}
            </span>
          </li>
        </ul>
        <p v-if="closedEntries.some((e) => e.forgiven > 0)" class="tiny faint" style="margin-top: 10px">
          Část dluhu se odpustila kvůli stropu – schválně, aby se z toho nestala nesplatitelná hypotéka.
        </p>
      </section>

      <p class="tiny faint center">
        {{ fmtBlocks(summary.blocks.remaining) }} a {{ fmtSteps(summary.steps.remaining) }} do konce týdne.
      </p>
    </div>
  </main>
</template>

<style scoped>
.days { display: flex; gap: 4px; }

.day-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.dot {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  display: grid;
  place-items: center;
  font-size: 0.7rem;
  color: var(--text-faint);
}

.dot.full { background: var(--accent); border-color: var(--accent); }
.dot.part { background: var(--surface-3); border-color: var(--border-strong); }
.dot.future { opacity: 0.4; }

.rows { margin-top: 12px; }

.line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.88rem;
  padding: 3px 0;
}

.line.total {
  font-weight: 650;
  border-top: 1px solid var(--border);
  margin-top: 3px;
  padding-top: 6px;
}

.task { display: flex; align-items: center; gap: 10px; font-size: 0.92rem; }

.tick {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  background: transparent;
  color: transparent;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}

.tick.on { background: var(--accent); border-color: var(--accent); color: #06120b; }
.tick:disabled { opacity: 0.5; cursor: default; }

.bankruptcy {
  margin-top: 10px;
  padding: 12px;
  border-radius: 12px;
  background: var(--surface-2);
}

.ledger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.ledger + .ledger { border-top: 1px solid var(--border); }
</style>
