<script setup lang="ts">
import { computed, ref } from 'vue'
import { blocksPerDay } from '@/lib/plan'
import ProgressBar from '@/components/ProgressBar.vue'
import WeekStrip from '@/components/WeekStrip.vue'
import { addWeeks, daysBetween, formatWeekRange, type WeekKey } from '@/lib/date'
import { blocks as fmtBlocks, num, steps as fmtSteps, walkTime } from '@/lib/format'
import { summarizeWeek } from '@/lib/engine'
import {
  canDeclareBankruptcy,
  currentWeek,
  declareBankruptcy,
  state,
  streakData,
  today,
  toggleTaskDone,
} from '@/stores/app'

const viewWeek = ref<WeekKey>(currentWeek.value)

const summary = computed(() => summarizeWeek(state, viewWeek.value, today.value))
const isCurrent = computed(() => viewWeek.value === currentWeek.value)

/** „Tenhle týden“ / „Minulý týden“ / „Před 5 týdny“. */
const weekLabel = computed(() => {
  const back = Math.round(daysBetween(viewWeek.value, currentWeek.value) / 7)
  if (back === 0) return 'Tenhle týden'
  if (back === 1) return 'Minulý týden'
  // Instrumentál je v češtině pro všechny počty stejný: „před 2 týdny“ i „před 9 týdny“.
  return `Před ${back} týdny`
})
const canGoForward = computed(() => viewWeek.value < currentWeek.value)

function shift(delta: number): void {
  const next = addWeeks(viewWeek.value, delta)
  if (next > currentWeek.value) return
  viewWeek.value = next
}

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

/** Kolik bloků jde za týden vůbec stihnout – strop dluhu z toho vychází. */
const maxBlocks = computed(() => blocksPerDay(state) * 7)

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
        <div class="eyebrow">{{ weekLabel }}</div>
        <h1>{{ formatWeekRange(viewWeek) }}</h1>
      </div>
      <div class="row" style="gap: 6px">
        <button class="btn btn-sm btn-ghost" aria-label="Předchozí týden" @click="shift(-1)">‹</button>
        <button
          class="btn btn-sm btn-ghost"
          aria-label="Následující týden"
          :disabled="!canGoForward"
          @click="shift(1)"
        >
          ›
        </button>
      </div>
    </header>

    <div class="stack">
      <!-- Dny --------------------------------------------------------- -->
      <section class="card">
        <WeekStrip :week="viewWeek" :today="today" />
        <p class="tiny faint center" style="margin-top: 12px">
          Den se počítá do série, když z něj máš aspoň 60 % – půl za kroky, půl za bloky.
          Modrá je den odpočinku.
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
          Z {{ maxBlocks }} možných bloků se vyžaduje {{ summary.blocks.base }} –
          {{ state.settings.exercise.graceDaysPerWeek }} {{ state.settings.exercise.graceDaysPerWeek === 1 ? 'den' : 'dny' }}
          v týdnu smíš vynechat bez postihu.
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
              :aria-label="`Splnit ${t.task.title}`"
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

      <!-- Série -------------------------------------------------------- -->
      <section v-if="isCurrent" class="card">
        <div class="card-title">Série</div>
        <div class="row-between">
          <div>
            <div class="big-number">{{ streakData.days }}</div>
            <div class="tiny faint">{{ streakData.days === 1 ? 'den' : streakData.days < 5 ? 'dny' : 'dní' }} v řadě</div>
          </div>
          <div class="right">
            <div class="strong num">{{ streakData.freezesLeft }}</div>
            <div class="tiny faint">záchran v záloze</div>
          </div>
        </div>
        <p class="tiny faint" style="margin-top: 10px">
          Jeden propadlý den za sedm dní sérii neshodí – spotřebuje záchranu. Kolik jich máš,
          se řídí nastavením „dny milosti“.
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
.rows { margin-top: 14px; }

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

.tick.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
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

.right { text-align: right; }
</style>
