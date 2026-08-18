/**
 * Týdenní úkoly.
 *
 * Úkol je cokoli, co chceš dělat *tolikrát za týden*, ale je jedno kdy –
 * posilovna, bazén, dlouhá procházka, zvážit se. Denní věci (kroky, bloky
 * cvičení) do toho nepatří, ty má appka po svém.
 *
 * Výchozí sada je jen návrh. Všechno se dá přejmenovat, přenastavit, vypnout
 * i smazat a knihovna níž je jen nabídka na dvě klepnutí – ne omezení.
 */

import type { WeeklyTask } from './types'

/** Nový úkol dostane pořadí na konec seznamu. */
export const TASK_ORDER_STEP = 10

/**
 * Nabídka hotových úkolů. Není to výčet toho, co appka umí – je to zkratka,
 * aby člověk nemusel vypisovat „Posilovna" ručně a vybírat emoji.
 */
export interface TaskSuggestion {
  id: string
  title: string
  emoji: string
  target: number
  rollover: boolean
  note?: string
  /** Do jaké skupiny to patří v nabídce. */
  group: 'pohyb' | 'zdraví' | 'návyky'
}

export const TASK_LIBRARY: TaskSuggestion[] = [
  // Pohyb
  {
    id: 'gym',
    title: 'Posilovna',
    emoji: '🏋️',
    target: 1,
    rollover: true,
    note: 'Full-body okruh – dřep, tlak, tah, mrtvý tah s lehkou vahou.',
    group: 'pohyb',
  },
  {
    id: 'long-walk',
    title: 'Dlouhá procházka (60+ min)',
    emoji: '🥾',
    target: 1,
    rollover: true,
    group: 'pohyb',
  },
  { id: 'swim', title: 'Bazén', emoji: '🏊', target: 1, rollover: true, group: 'pohyb' },
  { id: 'bike', title: 'Kolo', emoji: '🚴', target: 1, rollover: true, group: 'pohyb' },
  { id: 'run', title: 'Běh', emoji: '🏃', target: 2, rollover: true, group: 'pohyb' },
  { id: 'yoga', title: 'Jóga nebo delší protažení', emoji: '🧘', target: 1, rollover: false, group: 'pohyb' },
  { id: 'sport', title: 'Sport s někým', emoji: '🎾', target: 1, rollover: false, group: 'pohyb' },
  { id: 'stairs', title: 'Schody místo výtahu', emoji: '🪜', target: 5, rollover: false, group: 'pohyb' },

  // Zdraví
  {
    id: 'weigh-in',
    title: 'Zvážit se a změřit pas',
    emoji: '⚖️',
    target: 1,
    rollover: false,
    note: 'Ráno, nalačno, po probuzení – jinak čísla skáčou o kilo sem tam.',
    group: 'zdraví',
  },
  {
    id: 'toe-test',
    title: 'Test předklonu (cm od země)',
    emoji: '📏',
    target: 1,
    rollover: false,
    note: 'Měř vždy ve stejnou denní dobu, rozsah kolísá i o 5 cm.',
    group: 'zdraví',
  },
  { id: 'plank-test', title: 'Změřit výdrž v prkně', emoji: '⏱️', target: 1, rollover: false, group: 'zdraví' },
  { id: 'sleep', title: 'Jít spát do 23:00', emoji: '😴', target: 5, rollover: false, group: 'zdraví' },
  { id: 'massage', title: 'Masáž nebo válec', emoji: '🎯', target: 1, rollover: false, group: 'zdraví' },

  // Návyky
  { id: 'no-alcohol', title: 'Dny bez alkoholu', emoji: '🚱', target: 5, rollover: false, group: 'návyky' },
  { id: 'cook', title: 'Uvařit si doma', emoji: '🍳', target: 4, rollover: false, group: 'návyky' },
  { id: 'water', title: 'Den s dostatkem vody', emoji: '💧', target: 5, rollover: false, group: 'návyky' },
  { id: 'no-sweets', title: 'Den bez sladkého', emoji: '🍫', target: 4, rollover: false, group: 'návyky' },
  { id: 'meditate', title: 'Deset minut v klidu', emoji: '🌿', target: 3, rollover: false, group: 'návyky' },
  { id: 'screen-off', title: 'Večer bez displeje', emoji: '📵', target: 3, rollover: false, group: 'návyky' },
]

/** Emoji do výběru. Ruční zápis je pořád možný, tohle je jen zkratka. */
export const TASK_EMOJI = [
  '🏋️', '🏃', '🚴', '🏊', '🥾', '🧘', '🎾', '⛷️', '🪜', '🤸',
  '⚖️', '📏', '⏱️', '😴', '💧', '🥗', '🍳', '🍫', '🚱', '💊',
  '🌿', '📵', '📚', '🎯', '🧊', '☀️', '🧹', '✅', '⭐', '🔥',
]

/** Výchozí sada – to, s čím appka začíná. Dá se kdykoli obnovit. */
export function defaultWeeklyTasks(): WeeklyTask[] {
  return ['gym', 'long-walk', 'weigh-in', 'toe-test', 'no-alcohol'].map((id, index) => {
    const task = taskFromLibrary(id, index * TASK_ORDER_STEP)
    // „Dny bez alkoholu" je nabídka, ne předpoklad – ať si to zapne, kdo chce.
    return task.id === 'no-alcohol' ? { ...task, active: false } : task
  })
}

export function taskFromLibrary(id: string, order: number): WeeklyTask {
  const found = TASK_LIBRARY.find((t) => t.id === id)
  if (!found) return blankTask(order)
  return {
    id: found.id,
    title: found.title,
    target: found.target,
    emoji: found.emoji,
    active: true,
    rollover: found.rollover,
    note: found.note,
    order,
  }
}

export function blankTask(order: number, title = ''): WeeklyTask {
  return {
    // Čas v id stačí: úkoly zakládá jeden člověk na jednom zařízení a i kdyby
    // dvě zařízení trefila stejnou milisekundu, sync to vyřeší jako jeden úkol.
    id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    target: 1,
    emoji: '✅',
    active: true,
    rollover: true,
    order,
  }
}

/* ------------------------------------------------------------------ */
/*  Pořadí a normalizace                                               */
/* ------------------------------------------------------------------ */

/**
 * Seřadí úkoly. Pořadí je vlastní číslo, ne pozice v poli: po synchronizaci
 * přiletí úkoly v pořadí, v jakém je server vydal, takže na pole není
 * spolehnutí. Shodná čísla rozhodne id, ať je řazení stabilní.
 */
export function sortTasks(tasks: WeeklyTask[]): WeeklyTask[] {
  return [...tasks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** Pořadí pro úkol na konec seznamu. */
export function nextOrder(tasks: WeeklyTask[]): number {
  return tasks.reduce((max, t) => Math.max(max, t.order ?? 0), 0) + TASK_ORDER_STEP
}

/**
 * Prohodí úkol se sousedem. Vrací seznam s novými pořadovými čísly, nebo
 * ten samý, když už je úkol na kraji.
 */
export function moveTask(tasks: WeeklyTask[], id: string, direction: -1 | 1): WeeklyTask[] {
  const sorted = sortTasks(tasks)
  const index = sorted.findIndex((t) => t.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= sorted.length) return tasks

  const swapped = [...sorted]
  swapped[index] = sorted[target]!
  swapped[target] = sorted[index]!
  // Pořadí se přečísluje celé. Prohodit jen ta dvě čísla by nestačilo,
  // protože po synchronizaci můžou být rozestupy nepravidelné.
  return swapped.map((task, i) => ({ ...task, order: i * TASK_ORDER_STEP }))
}

/** Ořeže a srovná hodnoty z formuláře do rozsahu, který dává smysl. */
export function normalizeTask(task: WeeklyTask): WeeklyTask {
  const title = task.title.trim().slice(0, 60)
  return {
    ...task,
    title: title || 'Úkol',
    // Emoji může být i víceznakové (🏋️ nese variantový selektor), ale ne celá věta.
    emoji: (task.emoji || '✅').trim().slice(0, 8),
    // Sedmkrát týdně je strop: víc než jednou denně už není týdenní úkol.
    target: Math.max(1, Math.min(7, Math.round(task.target) || 1)),
    note: task.note?.trim().slice(0, 200) || undefined,
  }
}
