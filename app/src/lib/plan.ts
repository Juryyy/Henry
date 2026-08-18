/**
 * Sestavení denního plánu.
 *
 * Den má tři patnáctiminutové bloky a každý má jinou práci:
 *
 *   0 – RÁNO      rozhýbat páteř, nadechnout se, McGillova trojka.
 *                 Schválně bez cviků, kde se ohýbá bederní páteř pod zátěží:
 *                 po probuzení jsou ploténky nasáklé vodou a flexe je pro ně
 *                 nejnáročnější. (McGill; proto sedy-lehy až odpoledne.)
 *   1 – POLEDNE   core okruh – tady se buduje síla středu těla.
 *                 Plus cvik na kyčle a krátký kardio finiš, protože sezení
 *                 je ten hlavní problém a hubne se z výdeje, ne z prkna.
 *   2 – VEČER     protahování se zaměřením na zadní stranu stehen.
 *                 Večer je rozsah pohybu největší a sval je prohřátý.
 *
 * Kostra bloku je každý den stejná, obmění se jen zaměnitelné cviky. Protažení
 * hamstringů je proto každý večer – rozsah roste jen z pravidelnosti
 * (Ingram et al. 2024: ~10 min na svalovou skupinu týdně).
 */

import { getExercise } from '@/data/exercises'
import { daysBetween, hashString } from './date'
import type { AppState, BlockPlan, BlockSlot, Exercise, PlanItem } from './types'
import type { DateKey } from './date'

/* ------------------------------------------------------------------ */
/*  Šablony bloků                                                      */
/* ------------------------------------------------------------------ */

/**
 * Tři způsoby, jak se do bloku dostane cvik. Rozdíl mezi `progression`
 * a `pool` je podstatný: obtížnostní varianty téhož pohybu se **nestřídají**
 * (to by znamenalo jeden den prkno na kolenou, druhý den plné – tedy náhodné
 * podcvičení), zatímco zaměnitelné cviky se střídat mají, jinak je plán
 * každý den do písmene stejný.
 */
type Pick =
  /** Vždy stejný cvik – kostra bloku. */
  | { fixed: string }
  /** Tentýž pohyb od nejlehčí varianty po nejtěžší. Vybere se nejtěžší, na kterou má uživatel úroveň. */
  | { progression: string[] }
  /** Zaměnitelné cviky – střídají se podle dne. `sets`/`dose` přebijí doporučení z katalogu. */
  | { pool: string[]; sets?: number; dose?: number }

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
      { progression: ['bocne-prkno-na-kolenou', 'bocne-prkno', 'bocne-prkno-s-rotaci'] },
      { progression: ['hyzdovy-most', 'hyzdovy-most-jednonoz'] },
      { pool: ['sciatic-nerve-glide', 'wall-calf-stretch', 'childs-pose', 'thread-the-needle'] },
    ],
    bonus: ['hip-hinge-dowel', 'supine-figure-four'],
  },
  {
    slot: 1,
    title: 'Poledne',
    subtitle: 'Core a rozproudit krev',
    emoji: '💪',
    picks: [
      { progression: ['prkno-na-kolenou', 'prkno-na-predlokti', 'prkno-s-dotykem-ramen'] },
      { fixed: 'mrtvy-brouk' },
      { progression: ['zkracovacky', 'sedy-lehy', 'hollow-hold'] },
      { pool: ['hyzdovy-most', 'lodicka-na-brise', 'hyzdovy-most-jednonoz'] },
      // Dvouminutový kardio finiš. Dávky v katalogu počítají se samostatným
      // tréninkem, do patnáctiminutového bloku se musí zkrátit.
      { pool: ['marching-in-place', 'step-jacks-low-impact', 'shadow-boxing', 'jumping-jacks', 'stair-climbing'], sets: 1, dose: 120 },
      { fixed: 'kneeling-hip-flexor-stretch' },
    ],
    bonus: ['hip-hinge-dowel', 'ninety-ninety-hip', 'cossack-adductor-rock'],
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
      { progression: ['kneeling-hip-flexor-stretch', 'couch-stretch'] },
      { pool: ['supine-figure-four', 'ninety-ninety-hip', 'seated-butterfly-adductor'] },
      { fixed: 'wall-calf-stretch' },
      { pool: ['childs-pose', 'thread-the-needle'] },
    ],
    bonus: ['seated-butterfly-adductor', 'jefferson-curl-bodyweight'],
  },
]

/** Cviky, kde se pod zátěží ohýbá bederní páteř – ráno se vynechávají. */
const AVOID_IN_MORNING = 'flexe-patere'

/* ------------------------------------------------------------------ */
/*  Dávkování                                                          */
/* ------------------------------------------------------------------ */

/** Kolik sekund zabere jedno opakování (odhad pro výpočet délky bloku). */
const SECONDS_PER_REP = 3.5

/**
 * Výchozí počet sérií. Začátečníkovi jednu ubereme, jinak se drží doporučení
 * z katalogu. Objem navíc pro pokročilé se nepřidává tady, ale až při
 * dorovnávání na délku bloku – jinak by patnáctiminutový blok přetekl
 * a musely by se z něj vyhazovat cviky.
 */
function scaleSets(exercise: Exercise, level: 1 | 2 | 3): number {
  return level === 1 ? Math.max(1, exercise.sets - 1) : exercise.sets
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

function toPlanItem(exercise: Exercise, level: 1 | 2 | 3, override?: { sets?: number; dose?: number }): PlanItem {
  const sets = override?.sets ?? scaleSets(exercise, level)
  const dose = override?.dose ?? exercise.dose
  return { exerciseId: exercise.id, sets, dose, seconds: itemSeconds(exercise, sets, dose) }
}

/* ------------------------------------------------------------------ */
/*  Výběr cviků                                                        */
/* ------------------------------------------------------------------ */

/** Kolik cviků se do bloku nejvýš vejde – delší seznam se přestává číst. */
const MAX_ITEMS = 8

/** Pevný bod, od kterého se počítá rotace – jen aby byla stabilní. */
const ROTATION_EPOCH = '2024-01-01'

function isUsable(state: AppState, exercise: Exercise | undefined, slot: BlockSlot): exercise is Exercise {
  if (!exercise) return false
  if (state.settings.exercise.excludedExerciseIds.includes(exercise.id)) return false
  if (slot === 0 && exercise.tags.includes(AVOID_IN_MORNING)) return false
  return true
}

function usableFrom(state: AppState, ids: string[], slot: BlockSlot): Exercise[] {
  return ids.map(getExercise).filter((e): e is Exercise => isUsable(state, e, slot))
}

/**
 * Nejtěžší varianta pohybu, na kterou má uživatel úroveň. Když je celá
 * progrese nad jeho úrovní (pool bez lehké varianty), vezme se ta nejlehčí –
 * lepší lehčí náhrada než díra v bloku.
 */
function pickProgression(state: AppState, ids: string[], slot: BlockSlot): Exercise | null {
  const level = state.settings.exercise.level
  const candidates = usableFrom(state, ids, slot)
  if (candidates.length === 0) return null
  const atLevel = candidates.filter((e) => e.level <= level)
  if (atLevel.length === 0) return candidates.reduce((a, b) => (a.level <= b.level ? a : b))
  // Pořadí v šabloně jde od nejlehčího – při shodě úrovní vyhrává pozdější.
  return atLevel.reduce((a, b) => (b.level >= a.level ? b : a))
}

/**
 * Vybere cvik ze zaměnitelných. Rotace jede podle dne, ale přeskakuje cviky
 * nad zvolenou úrovní a ty, které si uživatel vyřadil.
 */
function pickFromPool(state: AppState, ids: string[], slot: BlockSlot, rotation: number): Exercise | null {
  const level = state.settings.exercise.level
  const candidates = usableFrom(state, ids, slot)
  if (candidates.length === 0) return null

  const atLevel = candidates.filter((e) => e.level <= level)
  const usable = atLevel.length > 0 ? atLevel : [candidates.reduce((a, b) => (a.level <= b.level ? a : b))]
  return usable[rotation % usable.length] ?? null
}

/* ------------------------------------------------------------------ */
/*  Sestavení bloku                                                    */
/* ------------------------------------------------------------------ */

export function buildBlock(state: AppState, date: DateKey, slot: BlockSlot): BlockPlan {
  const template = BLOCK_TEMPLATES.find((t) => t.slot === slot) ?? BLOCK_TEMPLATES[0]!
  const level = state.settings.exercise.level
  const budget = state.settings.exercise.minutesPerBlock * 60
  const rotation = Math.max(0, daysBetween(ROTATION_EPOCH, date))

  /** Cviky s ručně nastavenou dávkou – těm se pak nepřidávají série. */
  const capped = new Set<string>()
  const items: PlanItem[] = []

  template.picks.forEach((pick, index) => {
    let exercise: Exercise | null = null
    let override: { sets?: number; dose?: number } | undefined

    if ('fixed' in pick) {
      const found = getExercise(pick.fixed)
      exercise = isUsable(state, found, slot) ? found : null
    } else if ('progression' in pick) {
      exercise = pickProgression(state, pick.progression, slot)
    } else {
      exercise = pickFromPool(state, pick.pool, slot, rotation + index)
      if (pick.sets !== undefined || pick.dose !== undefined) override = { sets: pick.sets, dose: pick.dose }
    }

    if (!exercise || items.some((i) => i.exerciseId === exercise!.id)) return
    if (override) capped.add(exercise.id)
    items.push(toPlanItem(exercise, level, override))
  })

  const total = (): number => items.reduce((sum, i) => sum + i.seconds, 0)
  const setSets = (item: PlanItem, count: number): void => {
    const exercise = getExercise(item.exerciseId)
    if (!exercise) return
    item.sets = count
    item.seconds = itemSeconds(exercise, count, item.dose)
  }

  // Přetéká? Nejdřív ubíráme série od konce – vyhodit celý cvik je horší než
  // odcvičit ho v méně sériích. Teprve pak se zkracuje seznam.
  const trimSetsTo = (floor: number): void => {
    for (let i = items.length - 1; i >= 0 && total() > budget * 1.08; i--) {
      const item = items[i]!
      if (capped.has(item.exerciseId)) continue
      while (item.sets > floor && total() > budget * 1.08) setSets(item, item.sets - 1)
    }
  }
  trimSetsTo(2)
  while (total() > budget * 1.08 && items.length > 4) items.pop()
  trimSetsTo(1)
  while (total() > budget * 1.08 && items.length > 3) items.pop()

  // Zbývá čas? Nejdřív bonusové cviky. Pořadí se posouvá podle dne, aby se
  // doplňovalo pokaždé něco jiného. Zaměnitelné varianty se sem netahají –
  // z každé skupiny patří do bloku jeden cvik, ne celá skupina.
  const bonus = template.bonus
  for (let i = 0; i < bonus.length; i++) {
    if (items.length >= MAX_ITEMS || total() >= budget * 0.88) break
    const id = bonus[(i + (bonus.length ? rotation % bonus.length : 0)) % bonus.length]!
    const exercise = getExercise(id)
    if (!isUsable(state, exercise, slot) || exercise.level > level) continue
    if (items.some((it) => it.exerciseId === id)) continue
    const candidate = toPlanItem(exercise, level)
    if (total() + candidate.seconds > budget * 1.08) continue
    items.push(candidate)
  }

  /**
   * Dorovnání sérií. Nejdřív zpátky na to, co doporučuje katalog (úroveň 1
   * jednu sérii ubírá), teprve potom nad rámec – a to jen tam, kde to dává
   * smysl. U protahování ne: přes ~4 minuty na svalovou skupinu a sezení už
   * rozsah neroste (Ingram et al. 2024).
   */
  const topUp = (limit: (e: Exercise) => number): void => {
    let changed = true
    while (changed && total() < budget * 0.88) {
      changed = false
      for (const item of items) {
        if (total() >= budget * 0.88) break
        const exercise = getExercise(item.exerciseId)
        if (!exercise || capped.has(item.exerciseId)) continue
        if (item.sets >= limit(exercise)) continue
        const next = itemSeconds(exercise, item.sets + 1, item.dose)
        if (total() - item.seconds + next > budget * 1.08) continue
        item.sets += 1
        item.seconds = next
        changed = true
      }
    }
  }
  topUp((e) => e.sets)
  topUp((e) => (e.category === 'stretch' ? e.sets : Math.min(5, e.sets + (level === 3 ? 2 : 1))))

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
