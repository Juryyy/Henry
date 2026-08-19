import { describe, expect, it } from 'vitest'
import { CATEGORY_LABELS, EXERCISES, MUSCLE_LABELS } from '@/data/exercises'
import type { MuscleId } from './types'

/**
 * Svaly u cviků.
 *
 * Mapa těla je jenom obrázek dat – a data se píšou ručně, takže jediné, co
 * se dá hlídat, je jejich vnitřní pořádek: že u žádného cviku nechybí,
 * že se hlavní a vedlejší skupina nepřekrývají a že se nekreslí sval,
 * který mapa neumí ukázat. Jestli je zrovna u kliku správně prsní sval,
 * se testem zjistit nedá – to je věc rešerše, ne kódu.
 */

const DRAWN = Object.keys(MUSCLE_LABELS) as MuscleId[]

describe('svaly u cviků', () => {
  it('každý cvik říká, co hlavně zatěžuje', () => {
    for (const e of EXERCISES) {
      expect(e.muscles.primary.length, e.id).toBeGreaterThan(0)
      // Víc než tři „hlavní" skupiny znamená, že cvik nedělá nic pořádně –
      // spíš je to překlep v datech než poctivý popis.
      expect(e.muscles.primary.length, e.id).toBeLessThanOrEqual(3)
    }
  })

  it('nikde není sval, který mapa neumí nakreslit', () => {
    for (const e of EXERCISES) {
      for (const id of [...e.muscles.primary, ...e.muscles.secondary]) {
        expect(DRAWN, `${e.id}: ${id}`).toContain(id)
      }
    }
  })

  it('jeden sval není zároveň hlavní i vedlejší', () => {
    for (const e of EXERCISES) {
      const overlap = e.muscles.primary.filter((m) => e.muscles.secondary.includes(m))
      expect(overlap, e.id).toEqual([])
    }
  })

  it('žádná skupina se neopakuje', () => {
    for (const e of EXERCISES) {
      for (const list of [e.muscles.primary, e.muscles.secondary]) {
        expect(new Set(list).size, e.id).toBe(list.length)
      }
    }
  })

  it('každá kreslená skupina se aspoň u jednoho cviku opravdu použije', () => {
    // Sval, který nikde nesvítí, je na obrázku navíc – buď chybí v datech,
    // nebo ho katalog nepotřebuje a nemá se kreslit vůbec.
    const used = new Set(EXERCISES.flatMap((e) => [...e.muscles.primary, ...e.muscles.secondary]))
    expect(DRAWN.filter((id) => !used.has(id))).toEqual([])
  })

  it('srdce se hlásí jen u kardia, a tam vždycky', () => {
    // Srdce sval není. Kdyby se objevilo u protahování, znamenalo by to,
    // že se někam dostalo omylem a mate.
    for (const e of EXERCISES) {
      const beats = [...e.muscles.primary, ...e.muscles.secondary].includes('srdce')
      expect(beats, `${e.id} (${CATEGORY_LABELS[e.category]})`).toBe(e.category === 'cardio')
    }
  })
})
