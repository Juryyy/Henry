<script setup lang="ts">
import { computed, ref } from 'vue'
import { removeTask, reorderTask, resetTasks, state, upsertTask } from '@/stores/app'
import {
  blankTask,
  nextOrder,
  normalizeTask,
  sortTasks,
  TASK_EMOJI,
  TASK_LIBRARY,
  taskFromLibrary,
  type TaskSuggestion,
} from '@/lib/tasks'
import type { WeeklyTask } from '@/lib/types'

/**
 * Editor týdenních úkolů.
 *
 * Seznam je celý uživatelův: přejmenovat, změnit emoji, počet za týden,
 * přenášení dluhu, poznámku, pořadí i smazat. Výchozí sada je jen návrh,
 * ke kterému se dá vrátit.
 *
 * Řádek se rozbaluje: zavřený ukazuje jen to podstatné (zapnuto, název,
 * kolikrát), rozbalený všechno ostatní. Deset úkolů s osmi poli každý by
 * jinak byla nepoužitelná zeď.
 */
const tasks = computed(() => sortTasks(state.weeklyTasks))

/** Který řádek je rozbalený. Vždy nejvýš jeden – jinak se v tom ztratíš. */
const open = ref<string | null>(null)
const adding = ref(false)
const confirmingReset = ref(false)

const usedIds = computed(() => new Set(state.weeklyTasks.map((t) => t.id)))
const groups: TaskSuggestion['group'][] = ['pohyb', 'zdraví', 'návyky']

function suggestionsIn(group: TaskSuggestion['group']): TaskSuggestion[] {
  return TASK_LIBRARY.filter((s) => s.group === group && !usedIds.value.has(s.id))
}

function patch(task: WeeklyTask, changes: Partial<WeeklyTask>): void {
  upsertTask(normalizeTask({ ...task, ...changes }))
}

function toggleOpen(id: string): void {
  open.value = open.value === id ? null : id
}

function addFromLibrary(suggestion: TaskSuggestion): void {
  upsertTask(taskFromLibrary(suggestion.id, nextOrder(state.weeklyTasks)))
  adding.value = false
  open.value = suggestion.id
}

function addBlank(): void {
  const task = blankTask(nextOrder(state.weeklyTasks), 'Nový úkol')
  upsertTask(task)
  adding.value = false
  // Rovnou rozbalený, ať je kam psát – prázdný název sám o sobě nepomůže.
  open.value = task.id
}

function drop(task: WeeklyTask): void {
  if (open.value === task.id) open.value = null
  removeTask(task.id)
}

function doReset(): void {
  resetTasks()
  confirmingReset.value = false
  open.value = null
}

const targetHint = (task: WeeklyTask): string =>
  `${task.target}× týdně${task.rollover ? ' · nesplněné se přenáší' : ''}`
</script>

<template>
  <section class="card">
    <div class="row-between">
      <div class="card-title" style="margin: 0">Týdenní úkoly</div>
      <span class="tiny faint">{{ tasks.filter((t) => t.active).length }} zapnutých</span>
    </div>

    <p class="tiny faint" style="margin: 6px 0 12px">
      Cokoli, co chceš stihnout tolikrát za týden, ale je jedno kdy. Všechno se dá přepsat –
      výchozí sada je jen návrh.
    </p>

    <ul class="list-reset stack-sm">
      <li v-for="(task, index) in tasks" :key="task.id" class="task" :class="{ off: !task.active }">
        <div class="head">
          <label class="toggle grow">
            <input type="checkbox" :checked="task.active" @change="patch(task, { active: !task.active })" />
            <span>
              <span class="emoji" aria-hidden="true">{{ task.emoji }}</span>
              {{ task.title }}
              <span class="tiny faint block">{{ targetHint(task) }}</span>
            </span>
          </label>
          <button
            class="btn btn-sm btn-ghost"
            :aria-expanded="open === task.id"
            :aria-label="`Upravit ${task.title}`"
            @click="toggleOpen(task.id)"
          >
            {{ open === task.id ? 'Hotovo' : 'Upravit' }}
          </button>
        </div>

        <div v-if="open === task.id" class="body stack-sm">
          <div class="field">
            <label :for="`name-${task.id}`">Název</label>
            <input
              :id="`name-${task.id}`"
              type="text"
              :value="task.title"
              maxlength="60"
              @change="patch(task, { title: ($event.target as HTMLInputElement).value })"
            />
          </div>

          <div class="field">
            <label>Ikona</label>
            <div class="emoji-grid">
              <button
                v-for="option in TASK_EMOJI"
                :key="option"
                class="emoji-btn"
                type="button"
                :class="{ on: task.emoji === option }"
                :aria-pressed="task.emoji === option"
                :aria-label="`Ikona ${option}`"
                @click="patch(task, { emoji: option })"
              >
                {{ option }}
              </button>
            </div>
          </div>

          <div class="field">
            <label :for="`target-${task.id}`">Kolikrát za týden</label>
            <div class="chips">
              <button
                v-for="n in 7"
                :id="n === 1 ? `target-${task.id}` : undefined"
                :key="n"
                class="chip"
                type="button"
                :class="{ on: task.target === n }"
                :aria-pressed="task.target === n"
                :aria-label="`${n}× týdně`"
                @click="patch(task, { target: n })"
              >
                {{ n }}×
              </button>
            </div>
          </div>

          <label class="toggle">
            <input type="checkbox" :checked="task.rollover" @change="patch(task, { rollover: !task.rollover })" />
            <span>
              Přenášet nesplněné
              <span class="tiny faint block">
                Co za týden nestihneš, se přičte k dalšímu. U měření se to nehodí – zmeškané vážení
                dohánět nemusíš.
              </span>
            </span>
          </label>

          <div class="field">
            <label :for="`note-${task.id}`">Poznámka (nepovinná)</label>
            <input
              :id="`note-${task.id}`"
              type="text"
              :value="task.note ?? ''"
              maxlength="200"
              placeholder="Např. co přesně v posilovně cvičit"
              @change="patch(task, { note: ($event.target as HTMLInputElement).value })"
            />
          </div>

          <div class="row" style="gap: 8px">
            <button
              class="btn btn-sm btn-ghost"
              type="button"
              :disabled="index === 0"
              aria-label="Posunout nahoru"
              @click="reorderTask(task.id, -1)"
            >
              ↑
            </button>
            <button
              class="btn btn-sm btn-ghost"
              type="button"
              :disabled="index === tasks.length - 1"
              aria-label="Posunout dolů"
              @click="reorderTask(task.id, 1)"
            >
              ↓
            </button>
            <button class="btn btn-sm btn-ghost danger" type="button" @click="drop(task)">Smazat úkol</button>
          </div>
        </div>
      </li>
    </ul>

    <p v-if="!tasks.length" class="small faint" style="margin: 12px 0">
      Zatím tu není žádný úkol. Přidej si ho níž, nebo se vrať k výchozí sadě.
    </p>

    <div class="row" style="gap: 8px; margin-top: 12px">
      <button class="btn btn-sm btn-primary" type="button" @click="adding = !adding">
        {{ adding ? 'Zavřít nabídku' : 'Přidat úkol' }}
      </button>
      <button class="btn btn-sm btn-ghost" type="button" @click="confirmingReset = !confirmingReset">
        Výchozí sada
      </button>
    </div>

    <div v-if="confirmingReset" class="notice" style="margin-top: 10px">
      <p class="small" style="margin: 0 0 8px">
        Tímhle se seznam vrátí na výchozích pět úkolů. Co sis přidal, zmizí – odškrtnuté týdny
        zůstanou.
      </p>
      <div class="row" style="gap: 8px">
        <button class="btn btn-sm btn-primary" type="button" @click="doReset">Vrátit výchozí</button>
        <button class="btn btn-sm btn-ghost" type="button" @click="confirmingReset = false">Nechat být</button>
      </div>
    </div>

    <div v-if="adding" class="library stack-sm">
      <template v-for="group in groups" :key="group">
        <div v-if="suggestionsIn(group).length">
          <div class="tiny faint" style="margin-bottom: 6px; text-transform: capitalize">{{ group }}</div>
          <div class="chips">
            <button
              v-for="suggestion in suggestionsIn(group)"
              :key="suggestion.id"
              class="chip"
              type="button"
              @click="addFromLibrary(suggestion)"
            >
              {{ suggestion.emoji }} {{ suggestion.title }}
            </button>
          </div>
        </div>
      </template>
      <button class="btn btn-sm btn-ghost btn-block" type="button" @click="addBlank">
        Nebo si napiš vlastní
      </button>
    </div>
  </section>
</template>

<style scoped>
.task {
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  background: var(--surface-2);
}

.task.off {
  opacity: 0.62;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.emoji {
  margin-right: 4px;
}

.body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 6px;
}

.emoji-btn {
  aspect-ratio: 1;
  font-size: 1.1rem;
  line-height: 1;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: inherit;
  cursor: pointer;
}

.emoji-btn.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: inherit;
  padding: 6px 12px;
  font-size: 0.85rem;
  cursor: pointer;
}

.chip.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.library {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.btn.danger {
  color: var(--danger);
  margin-left: auto;
}
</style>
