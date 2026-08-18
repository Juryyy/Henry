import { describe, expect, it } from 'vitest'
import { BLOCK_TEMPLATES, buildBlock, buildDay, defaultBlocks, doseLabel, itemSeconds, planId } from './plan'
import { EXERCISES, getExercise } from '@/data/exercises'
import { defaultState } from './storage'
import type { AppState, BlockSlot } from './types'

function makeState(patch: (s: AppState) => void = () => {}): AppState {
  const s = defaultState()
  patch(s)
  return s
}

const DAY = '2026-08-17'
const SLOTS: BlockSlot[] = [0, 1, 2]

/** Sedm po sobě jdoucích dní – rotace se musí projevit napříč nimi. */
const WEEK = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23']

/** Cviky, ze kterých jedna skupina v šabloně vybírá. */
function groupIds(pick: (typeof BLOCK_TEMPLATES)[number]['picks'][number]): string[] {
  if ('fixed' in pick) return [pick.fixed]
  if ('progression' in pick) return pick.progression
  return pick.pool
}

/**
 * Cviky, které smí být nad zvolenou úrovní: skupiny, kde nic lehčího není.
 * Typicky břišní flexe – nejlehčí varianta v katalogu je úroveň 2, a blok
 * bez ní by přišel o celý pohybový vzorec.
 */
function allowedAboveLevel(level: 1 | 2 | 3): Set<string> {
  const out = new Set<string>()
  for (const template of BLOCK_TEMPLATES) {
    for (const pick of template.picks) {
      const ids = groupIds(pick)
      if (ids.some((id) => (getExercise(id)?.level ?? 9) <= level)) continue
      for (const id of ids) out.add(id)
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  Šablony                                                            */
/* ------------------------------------------------------------------ */

describe('šablony bloků', () => {
  it('odkazují jen na cviky, které v katalogu existují', () => {
    const ids = BLOCK_TEMPLATES.flatMap((t) => [...t.picks.flatMap(groupIds), ...t.bonus])
    const missing = ids.filter((id) => !getExercise(id))
    expect(missing).toEqual([])
  })

  it('nabízejí všechna zaměření a každé právě jednou', () => {
    expect(BLOCK_TEMPLATES.map((t) => t.focus).sort()).toEqual(['core', 'kardio', 'protazeni', 'rozhybani'])
  })

  it('výchozí den nezávisí na pořadí šablon', () => {
    // Kdyby se `defaultBlocks` řídilo pozicí v poli, přidání nebo přeházení
    // šablony by tiše změnilo výchozí den každému, kdo si ho nepřenastavil.
    expect(defaultBlocks().map((b) => b.focus)).toEqual(['rozhybani', 'core', 'protazeni'])
    expect(defaultBlocks().map((b) => b.slot)).toEqual([0, 1, 2])
    expect(defaultBlocks().every((b) => b.enabled && b.minutes === 15)).toBe(true)
  })

  it('ranní rozhýbání vynechává ohýbání beder, ostatní zaměření ne', () => {
    // Pravidlo patří k rozhýbání, ne k tomu, že je blok první v pořadí.
    const morning = buildBlock(makeState(), DAY, 0)
    expect(morning.items.some((i) => i.exerciseId === 'sedy-lehy')).toBe(false)

    const flipped = makeState((s) => {
      s.settings.exercise.blocks[0]!.focus = 'core'
      s.settings.exercise.blocks[1]!.focus = 'rozhybani'
    })
    // Po prohození drží pravidlo se zaměřením, ne se slotem.
    expect(buildBlock(flipped, DAY, 1).items.some((i) => i.exerciseId === 'sedy-lehy')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  Sestavení bloku                                                    */
/* ------------------------------------------------------------------ */

describe('sestavení bloku', () => {
  it('vrátí neprázdný blok s názvem a délkou', () => {
    const state = makeState()
    for (const slot of SLOTS) {
      const block = buildBlock(state, DAY, slot)
      expect(block.slot).toBe(slot)
      expect(block.title).toBeTruthy()
      expect(block.items.length).toBeGreaterThan(2)
      expect(block.totalSeconds).toBeGreaterThan(0)
    }
  })

  it('žádný cvik se v bloku neopakuje', () => {
    const state = makeState()
    for (const day of WEEK) {
      for (const slot of SLOTS) {
        const ids = buildBlock(state, day, slot).items.map((i) => i.exerciseId)
        expect(new Set(ids).size).toBe(ids.length)
      }
    }
  })

  it('délka bloku sedí na slíbených patnácti minutách', () => {
    const state = makeState()
    for (const day of WEEK) {
      for (const slot of SLOTS) {
        const block = buildBlock(state, day, slot)
        // Slíbeno je 15 min; tolerance je ta samá, se kterou pracuje buildBlock.
        expect(block.totalSeconds).toBeGreaterThanOrEqual(15 * 60 * 0.85)
        expect(block.totalSeconds).toBeLessThanOrEqual(15 * 60 * 1.08)
      }
    }
  })

  it('délka sedí na každé úrovni i na každé nastavené délce', () => {
    for (const level of [1, 2, 3] as const) {
      for (const minutes of [10, 15, 20]) {
        const state = makeState((s) => {
          s.settings.exercise.level = level
          s.settings.exercise.blocks.forEach((b) => (b.minutes = minutes))
        })
        for (const day of WEEK) {
          for (const slot of SLOTS) {
            const total = buildBlock(state, day, slot).totalSeconds
            expect(total).toBeLessThanOrEqual(minutes * 60 * 1.08)
            expect(total).toBeGreaterThanOrEqual(minutes * 60 * 0.85)
          }
        }
      }
    }
  })

  it('dlouhý protahovací blok se nedoplní na sílu', () => {
    // Přes zhruba čtyři minuty na svalovou skupinu a sezení už rozsah neroste
    // (Ingram et al. 2024). Půlhodinový protahovací blok se proto nemá dorovnat
    // sériemi navíc – radši vyjde kratší. Appka to u délky napíše.
    const state = makeState((s) => {
      s.settings.exercise.blocks[2]!.minutes = 30
    })
    const block = buildBlock(state, DAY, 2)
    expect(block.totalSeconds).toBeLessThan(30 * 60)
    // Ale ani se nesmí scvrknout na nic – pořád je to plnohodnotný blok.
    expect(block.totalSeconds).toBeGreaterThan(15 * 60)
  })

  it('kratší nastavená délka bloku plán opravdu zkrátí', () => {
    const long = buildBlock(makeState(), DAY, 1)
    const short = buildBlock(
      makeState((s) => {
        s.settings.exercise.blocks.forEach((b) => (b.minutes = 8))
      }),
      DAY,
      1,
    )
    expect(short.totalSeconds).toBeLessThan(long.totalSeconds)
    expect(short.totalSeconds).toBeLessThanOrEqual(8 * 60 * 1.08)
  })

  it('ráno se neohýbá bederní páteř pod zátěží', () => {
    const state = makeState()
    for (const day of WEEK) {
      const ids = buildBlock(state, day, 0).items.map((i) => i.exerciseId)
      const flexe = ids.filter((id) => getExercise(id)?.tags.includes('flexe-patere'))
      expect(flexe).toEqual([])
    }
  })

  it('protažení hamstringů je v každém večerním bloku', () => {
    const state = makeState()
    for (const day of WEEK) {
      const ids = buildBlock(state, day, 2).items.map((i) => i.exerciseId)
      expect(ids).toContain('supine-hamstring-strap')
    }
  })

  it('na první úrovni nenabídne pokročilé cviky', () => {
    const state = makeState((s) => {
      s.settings.exercise.level = 1
    })
    const vyjimky = allowedAboveLevel(1)
    for (const day of WEEK) {
      for (const slot of SLOTS) {
        for (const item of buildBlock(state, day, slot).items) {
          const exercise = getExercise(item.exerciseId)!
          if (exercise.level > 1) expect(vyjimky.has(exercise.id)).toBe(true)
        }
      }
    }
  })

  it('s úrovní roste obtížnost varianty, ne náhoda', () => {
    const plank = (level: 1 | 2 | 3): string[] =>
      buildBlock(makeState((s) => { s.settings.exercise.level = level }), DAY, 1).items.map((i) => i.exerciseId)
    expect(plank(1)).toContain('prkno-na-kolenou')
    expect(plank(2)).toContain('prkno-na-predlokti')
    expect(plank(3)).toContain('prkno-s-dotykem-ramen')
  })

  it('obtížnostní varianta se během týdne nepřehazuje', () => {
    // Jinak by uživatel jeden den cvičil prkno na kolenou a druhý plné –
    // což není pestrost, ale náhodné podcvičení.
    const state = makeState((s) => { s.settings.exercise.level = 3 })
    const varianty = new Set(
      WEEK.map((d) => buildBlock(state, d, 1).items.find((i) => i.exerciseId.startsWith('prkno'))?.exerciseId),
    )
    expect(varianty.size).toBe(1)
  })

  it('u protahování se počet sérií nepřehání ani na třetí úrovni', () => {
    const state = makeState((s) => { s.settings.exercise.level = 3 })
    for (const day of WEEK) {
      for (const item of buildBlock(state, day, 2).items) {
        const exercise = getExercise(item.exerciseId)!
        if (exercise.category === 'stretch') expect(item.sets).toBeLessThanOrEqual(exercise.sets)
      }
    }
  })

  it('polední blok končí krátkým kardiem – kvůli hubnutí', () => {
    const state = makeState()
    for (const day of WEEK) {
      const items = buildBlock(state, day, 1).items
      const cardio = items.filter((i) => getExercise(i.exerciseId)?.category === 'cardio')
      expect(cardio).toHaveLength(1)
      // Dávka z katalogu počítá se samostatným tréninkem; do bloku patří zkrácená.
      expect(cardio[0]!.seconds).toBeLessThanOrEqual(180)
    }
  })

  it('blok zůstane čitelně krátký', () => {
    const state = makeState()
    for (const day of WEEK) {
      for (const slot of SLOTS) {
        expect(buildBlock(state, day, slot).items.length).toBeLessThanOrEqual(8)
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/*  Vyřazené cviky                                                     */
/* ------------------------------------------------------------------ */

describe('vyřazené cviky', () => {
  it('se v plánu neobjeví a nahradí je jiné', () => {
    const state = makeState((s) => {
      s.settings.exercise.excludedExerciseIds = ['sedy-lehy', 'zkracovacky', 'prkno-na-predlokti']
    })
    for (const day of WEEK) {
      for (const slot of SLOTS) {
        const ids = buildBlock(state, day, slot).items.map((i) => i.exerciseId)
        expect(ids).not.toContain('sedy-lehy')
        expect(ids).not.toContain('zkracovacky')
        expect(ids).not.toContain('prkno-na-predlokti')
      }
    }
  })

  it('i po vyřazení celého katalogu vrátí prázdný blok, ne výjimku', () => {
    const state = makeState((s) => {
      s.settings.exercise.excludedExerciseIds = EXERCISES.map((e) => e.id)
    })
    const block = buildBlock(state, DAY, 1)
    expect(block.items).toEqual([])
    expect(block.totalSeconds).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/*  Rotace a identita plánu                                            */
/* ------------------------------------------------------------------ */

describe('rotace', () => {
  it('stejný den dá vždycky stejný plán', () => {
    const state = makeState()
    expect(buildBlock(state, DAY, 1)).toEqual(buildBlock(state, DAY, 1))
  })

  it('během týdne se skladba obmění, kostra zůstává', () => {
    const state = makeState()
    const days = WEEK.map((d) => buildBlock(state, d, 1).items.map((i) => i.exerciseId).join(','))
    expect(new Set(days).size).toBeGreaterThan(1)
    // „Mrtvý brouk“ je v šabloně pevný – musí být každý den.
    for (const day of WEEK) {
      expect(buildBlock(state, day, 1).items.map((i) => i.exerciseId)).toContain('mrtvy-brouk')
    }
  })
})

describe('identifikátor plánu', () => {
  it('se nemění, dokud se nemění nastavení', () => {
    const state = makeState()
    expect(planId(state, DAY, 0)).toBe(planId(makeState(), DAY, 0))
  })

  it('se změní po úpravě nastavení – rozdělaný blok se tím zneplatní', () => {
    const before = planId(makeState(), DAY, 0)
    expect(planId(makeState((s) => { s.settings.exercise.level = 3 }), DAY, 0)).not.toBe(before)
    expect(planId(makeState((s) => { s.settings.exercise.blocks.forEach((b) => (b.minutes = 10)) }), DAY, 0)).not.toBe(before)
    expect(
      planId(makeState((s) => { s.settings.exercise.excludedExerciseIds = ['sedy-lehy'] }), DAY, 0),
    ).not.toBe(before)
  })

  it('nezáleží na pořadí vyřazených cviků', () => {
    const a = planId(makeState((s) => { s.settings.exercise.excludedExerciseIds = ['a', 'b'] }), DAY, 0)
    const b = planId(makeState((s) => { s.settings.exercise.excludedExerciseIds = ['b', 'a'] }), DAY, 0)
    expect(a).toBe(b)
  })

  it('liší se mezi sloty i dny', () => {
    const state = makeState()
    expect(planId(state, DAY, 0)).not.toBe(planId(state, DAY, 1))
    expect(planId(state, DAY, 0)).not.toBe(planId(state, '2026-08-18', 0))
  })
})

/* ------------------------------------------------------------------ */
/*  Den                                                                */
/* ------------------------------------------------------------------ */

describe('denní plán', () => {
  it('má tolik bloků, kolik jich má uživatel zapnutých', () => {
    expect(buildDay(makeState(), DAY)).toHaveLength(3)
    expect(buildDay(makeState((s) => { s.settings.exercise.blocks[2]!.enabled = false }), DAY)).toHaveLength(2)
  })

  it('cvičit jen večer je legitimní plán – vypnou se první dva', () => {
    const state = makeState((s) => {
      s.settings.exercise.blocks[0]!.enabled = false
      s.settings.exercise.blocks[1]!.enabled = false
    })
    const day = buildDay(state, DAY)
    expect(day).toHaveLength(1)
    // Pozice zůstává 2, ne 0: visí na ní zápis odcvičení i odkaz z notifikace.
    expect(day[0]!.slot).toBe(2)
  })

  it('když si všechno vypne, zbyde první blok – jinak by dluh nešlo splatit', () => {
    const state = makeState((s) => s.settings.exercise.blocks.forEach((b) => (b.enabled = false)))
    expect(buildDay(state, DAY)).toHaveLength(1)
  })

  it('bloky jdou po sobě od rána', () => {
    expect(buildDay(makeState(), DAY).map((b) => b.slot)).toEqual([0, 1, 2])
  })
})

/* ------------------------------------------------------------------ */
/*  Dávkování                                                          */
/* ------------------------------------------------------------------ */

describe('dávkování', () => {
  it('délka položky počítá i pauzy mezi sériemi', () => {
    const exercise = { mode: 'time', dose: 30, restSeconds: 20 } as never
    // 3 série po 30 s + 2 pauzy po 20 s
    expect(itemSeconds(exercise, 3, 30)).toBe(3 * 30 + 2 * 20)
  })

  it('cvik na obě strany trvá dvakrát tak dlouho', () => {
    const oneSide = { mode: 'time', dose: 30, restSeconds: 0 } as never
    const bothSides = { mode: 'time_per_side', dose: 30, restSeconds: 0 } as never
    expect(itemSeconds(bothSides, 2, 30)).toBe(2 * itemSeconds(oneSide, 2, 30))
  })

  it('jedna série nemá žádnou pauzu', () => {
    expect(itemSeconds({ mode: 'time', dose: 40, restSeconds: 99 } as never, 1, 40)).toBe(40)
  })

  it('popisek dávky odpovídá režimu cviku', () => {
    const item = { exerciseId: 'x', sets: 3, dose: 30, seconds: 0 }
    expect(doseLabel({ mode: 'reps' } as never, item)).toBe('3× 30 opakování')
    expect(doseLabel({ mode: 'time' } as never, item)).toBe('3× 30 s')
    expect(doseLabel({ mode: 'time_per_side' } as never, item)).toBe('3× 30 s na každou stranu')
  })
})
