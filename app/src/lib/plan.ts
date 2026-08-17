/**
 * Sestavení denního plánu.
 *
 * Den má tři patnáctiminutové bloky a každý má jiný úkol:
 *
 *   0 – RÁNO      rozhýbat páteř, nadechnout se, McGillova trojka.
 *                 Schválně bez cviků, kde se ohýbá bederní páteř pod zátěží:
 *                 po probuzení jsou ploténky nasáklé vodou a flexe je pro ně
 *                 nejnáročnější. (McGill; proto sedy-lehy až odpoledne.)
 *   1 – POLEDNE   core okruh – tady se buduje síla středu těla.
 *                 Plus jeden cvik na kyčle, protože sezení je ten hlavní problém.
 *   2 – VEČER     protahování se zaměřením na zadní stranu stehen.
 *                 Večer je rozsah pohybu největší a sval je prohřátý.
 *
 * Cviky se v rámci bloku střídají podle dne, takže to není každý den to samé,
 * ale kostra zůstává – protažení hamstringů je každý večer, protože ROM roste
 * jen z pravidelnosti (Ingram et al. 2024: ~10 min na svalovou skupinu týdně).
 */

import { getExercise } from '@/data/exercises'
import { daysBetween, hashString } from './date'
import type { AppState, BlockPlan, BlockSlot, Exercise, PlanItem } from './types'
import type { DateKey } from './date'

/* ------------------------------------------------------------------ */
/*  Šablony bloků                                                      */
/* ------------------------------------------------------------------ */

type Pick =
  /** Vždy stejný cvik – kostra bloku. */
  | { fixed: string }
  /** Střídá se podle dne. */
  | { pool: string[] }

interface BlockTemplate {
  slot: BlockSlot
  title: string
  subtitle: string
  emoji: string
  picks: Pick[]
  /** Cviky, které se přidají, jen když zbývá čas. */
  bonus: string[]
}

export const BLOCK_TEMPLATES: BlockTemplate[] = [
  {
    slot: 0,
    title: 'Ráno',
    subtitle: 'Rozhýbat a nastartovat',
    emoji: '🌅',
    picks: [
      { fixed: 'kocka-velbloud' },
      { fixed: 'branicni-dychani' },
      { fixed: 'mcgillova-zkracovacka' },
      { fixed: 'ptaci-pes' },
      { pool: ['bocne-prkno-na-kolenou', 'bocne-prkno', 'bocne-prkno-s-rotaci'] },
      { pool: ['hyzdovy-most', 'hyzdovy-most-jednonoz'] },
    ],
    bonus: ['sciatic-nerve-glide', 'thread-the-needle'],
  },
  {
    slot: 1,
    title: 'Poledne',
    subtitle: 'Core – tady se to zpevňuje',
    emoji: '💪',
    picks: [
      { pool: ['prkno-na-kolenou', 'prkno-na-predlokti', 'prkno-s-dotykem-ramen'] },
      { fixed: 'mrtvy-brouk' },
      { pool: ['zkracovacky', 'sedy-lehy', 'hollow-hold'] },
      { pool: ['lodicka-na-brise', 'hyzdovy-most-jednonoz', 'hyzdovy-most'] },
      { pool: ['bocne-prkno-na-kolenou', 'bocne-prkno'] },
      { fixed: 'kneeling-hip-flexor-stretch' },
    ],
    bonus: ['hip-hinge-dowel', 'cossack-adductor-rock'],
  },
  {
    slot: 2,
    title: 'Večer',
    subtitle: 'Protažení – cesta na zem',
    emoji: '🧘',
    picks: [
      { pool: ['sciatic-nerve-glide', 'hip-hinge-dowel'] },
      { fixed: 'supine-hamstring-strap' },
      { pool: ['standing-forward-fold', 'seated-forward-fold', 'elevated-hamstring-hinge', 'pnf-hamstring-contract-relax'] },
      { pool: ['kneeling-hip-flexor-stretch', 'couch-stretch'] },
      { pool: ['supine-figure-four', 'ninety-ninety-hip', 'seated-butterfly-adductor'] },
      { fixed: 'wall-calf-stretch' },
      { pool: ['childs-pose', 'thread-the-needle'] },
    ],
    bonus: ['jefferson-curl-bodyweight', 'seated-butterfly-adductor'],
  },
]

/** Cviky, kde se pod zátěží ohýbá bederní páteř – ráno se vynechávají. */
const AVOID_IN_MORNING = 'flexe-patere'

/* ------------------------------------------------------------------ */
/*  Dávkování                                                          */
/* ------------------------------------------------------------------ */

/** Kolik sekund zabere jedno opakování (odhad pro výpočet délky bloku). */
const SECONDS_PER_REP = 3.5

/** Škálování podle zvolené úrovně – vyšší úroveň = víc sérií. */
function scaleSets(exercise: Exercise, level: 1 | 2 | 3): number {
  if (level === 1) return Math.max(1, exercise.sets - 1)
  if (level === 3) return exercise.sets + (exercise.category === 'stretch' ? 0 : 1)
  return exercise.sets
}

/** Odhad délky položky včetně pauz mezi sériemi. */
export function itemSeconds(exercise: Exercise, sets: number, dose: number): number {
  const work =
    exercise.mode === 'reps'
      ? dose * SECONDS_PER_REP
      : exercise.mode === 'time_per_side'
        ? dose * 2
        : dose
  return Math.round(sets * work + (sets - 1) * exercise.restSeconds)
}

function toPlanItem(exercise: Exercise, level: 1 | 2 | 3): PlanItem {
  const sets = scaleSets(exercise, level)
  const dose = exercise.dose
  return { exerciseId: exercise.id, sets, dose, seconds: itemSeconds(exercise, sets, dose) }
}

/* ------------------------------------------------------------------ */
/*  Výběr cviků                                                        */
/* ------------------------------------------------------------------ */

/** Pevný bod, od kterého se počítá rotace – jen aby byla stabilní. */
const ROTATION_EPOCH = '2024-01-01'

function isUsable(state: AppState, exercise: Exercise | undefined, slot: BlockSlot): exercise is Exercise {
  if (!exercise) return false
  if (state.settings.exercise.excludedExerciseIds.includes(exercise.id)) return false
  if (slot === 0 && exercise.tags.includes(AVOID_IN_MORNING)) return false
  return true
}

/**
 * Vybere cvik z poolu. Rotace jede podle dne, ale přeskakuje cviky nad
 * zvolenou úrovní a ty, které si uživatel vyřadil.
 */
function pickFromPool(state: AppState, pool: string[], slot: BlockSlot, rotation: number): Exercise | null {
  const level = state.settings.exercise.level
  const candidates = pool
    .map(getExercise)
    .filter((e): e is Exercise => isUsable(state, e, slot))

  if (candidates.length === 0) return null

  const atLevel = candidates.filter((e) => e.level <= level)
  const usable = atLevel.length > 0 ? atLevel : [candidates.reduce((a, b) => (a.level <= b.level ? a : b))]
  return usable[rotation % usable.length] ?? null
}

/* ------------------------------------------------------------------ */
/*  Sestavení bloku                                                    */
/* ------------------------------------------------------------------ */

export function buildBlock(state: AppState, date: DateKey, slot: BlockSlot): BlockPlan {
  const template = BLOCK_TEMPLATES.find((t) => t.slot === slot) ?? BLOCK_TEMPLATES[0]
  const level = state.settings.exercise.level
  const budget = state.settings.exercise.minutesPerBlock * 60
  const rotation = Math.max(0, daysBetween(ROTATION_EPOCH, date))

  const chosen: Exercise[] = []
  template.picks.forEach((pick, index) => {
    const exercise =
      'fixed' in pick
        ? (isUsable(state, getExercise(pick.fixed), slot) ? getExercise(pick.fixed)! : null)
        : pickFromPool(state, pick.pool, slot, rotation + index)
    if (exercise && !chosen.some((e) => e.id === exercise.id)) chosen.push(exercise)
  })

  let items = chosen.map((e) => toPlanItem(e, level))
  const total = () => items.reduce((sum, i) => sum + i.seconds, 0)

  // Přetéká? Ubereme od konce – kostra bloku je na začátku.
  while (total() > budget * 1.08 && items.length > 3) {
    items = items.slice(0, -1)
  }

  // Zbývá čas? Doplníme nejdřív bonusovými cviky, potom nevyužitými
  // alternativami ze stejných skupin. Blok má mít slíbených patnáct minut,
  // ne osm.
  const fillers = [
    ...template.bonus,
    ...template.picks.flatMap((p) => ('pool' in p ? p.pool : [])),
  ]
  for (const id of fillers) {
    if (total() >= budget * 0.88) break
    const exercise = getExercise(id)
    if (!isUsable(state, exercise, slot)) continue
    if (exercise.level > level) continue
    if (items.some((i) => i.exerciseId === id)) continue
    items.push(toPlanItem(exercise, level))
  }

  // Pořád krátké (málo cviků v katalogu, hodně vyřazených)? Přidáme sérii
  // těm, u kterých to dává smysl – u protahování se sérií nepřehání.
  for (let round = 0; round < 2 && total() < budget * 0.8; round++) {
    for (const item of items) {
      if (total() >= budget * 0.88) break
      const exercise = getExercise(item.exerciseId)
      if (!exercise || exercise.category === 'stretch') continue
      if (item.sets >= 5) continue
      item.sets += 1
      item.seconds = itemSeconds(exercise, item.sets, item.dose)
    }
  }

  return {
    slot,
    title: template.title,
    subtitle: template.subtitle,
    id: planId(state, date, slot),
    items,
    totalSeconds: total(),
  }
}

/**
 * Identifikátor plánu. Když se změní nastavení (úroveň, délka bloku,
 * vyřazené cviky), změní se i id a rozdělaný blok se resetuje.
 */
export function planId(state: AppState, date: DateKey, slot: BlockSlot): string {
  const { level, minutesPerBlock, excludedExerciseIds } = state.settings.exercise
  const seed = `${date}|${slot}|${level}|${minutesPerBlock}|${excludedExerciseIds.slice().sort().join(',')}`
  return `p${hashString(seed).toString(36)}`
}

export function buildDay(state: AppState, date: DateKey): BlockPlan[] {
  const count = Math.max(1, Math.min(3, state.settings.exercise.blocksPerDay))
  return Array.from({ length: count }, (_, i) => buildBlock(state, date, i as BlockSlot))
}

export function blockEmoji(slot: BlockSlot): string {
  return BLOCK_TEMPLATES.find((t) => t.slot === slot)?.emoji ?? '💪'
}

/** Popis dávky pro UI: „3× 30 s na každou stranu“. */
export function doseLabel(exercise: Exercise, item: PlanItem): string {
  if (exercise.mode === 'reps') return `${item.sets}× ${item.dose} opakování`
  if (exercise.mode === 'time_per_side') return `${item.sets}× ${item.dose} s na každou stranu`
  return `${item.sets}× ${item.dose} s`
}
