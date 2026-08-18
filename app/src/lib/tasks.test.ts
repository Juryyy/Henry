import { describe, expect, it } from 'vitest'
import {
  blankTask,
  defaultWeeklyTasks,
  moveTask,
  nextOrder,
  normalizeTask,
  sortTasks,
  TASK_EMOJI,
  TASK_LIBRARY,
  taskFromLibrary,
} from './tasks'
import type { WeeklyTask } from './types'

/**
 * Týdenní úkoly.
 *
 * Nejzajímavější část je pořadí. Vypadá jako kosmetika, ale je to jediná věc,
 * která drží seznam pohromadě přes dvě zařízení: synchronizace posílá úkoly
 * po jednom a v libovolném pořadí, takže pozice v poli nic neznamená.
 */

function task(id: string, order: number, patch: Partial<WeeklyTask> = {}): WeeklyTask {
  return { id, title: id, target: 1, emoji: '✅', active: true, rollover: true, order, ...patch }
}

describe('výchozí sada', () => {
  it('má stabilní pořadí a nezačíná ničím, co si člověk nevybral', () => {
    const tasks = defaultWeeklyTasks()
    expect(tasks.map((t) => t.id)).toEqual(['gym', 'long-walk', 'weigh-in', 'toe-test', 'no-alcohol'])
    expect(tasks.map((t) => t.order)).toEqual([0, 10, 20, 30, 40])
    // Abstinence je nabídka, ne předpoklad.
    expect(tasks.find((t) => t.id === 'no-alcohol')?.active).toBe(false)
  })

  it('u posilovny zůstane poznámka, co vlastně cvičit', () => {
    expect(defaultWeeklyTasks()[0]?.note).toContain('dřep')
  })
})

describe('knihovna úkolů', () => {
  it('nemá dvakrát totéž id – jinak by se úkol nedal přidat podruhé ani odlišit', () => {
    const ids = TASK_LIBRARY.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('každý návrh dává smysl jako týdenní úkol', () => {
    for (const suggestion of TASK_LIBRARY) {
      expect(suggestion.title.length, suggestion.id).toBeGreaterThan(2)
      expect(suggestion.target, suggestion.id).toBeGreaterThanOrEqual(1)
      expect(suggestion.target, suggestion.id).toBeLessThanOrEqual(7)
      expect(suggestion.emoji, suggestion.id).not.toBe('')
    }
  })

  it('emoji z návrhů jde vybrat i ručně z nabídky ikon', () => {
    for (const suggestion of TASK_LIBRARY) {
      expect(TASK_EMOJI, suggestion.id).toContain(suggestion.emoji)
    }
  })

  it('úkol z knihovny se přidá i s poznámkou a zapnutý', () => {
    const added = taskFromLibrary('swim', 70)
    expect(added).toMatchObject({ id: 'swim', emoji: '🏊', active: true, order: 70 })
  })

  it('neznámé id nespadne, ale vyrobí prázdný úkol', () => {
    const added = taskFromLibrary('neexistuje', 10)
    expect(added.id).toMatch(/^task-/)
    expect(added.order).toBe(10)
  })
})

describe('pořadí', () => {
  it('řadí podle čísla, ne podle pole', () => {
    const scrambled = [task('c', 20), task('a', 0), task('b', 10)]
    expect(sortTasks(scrambled).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('při shodném čísle rozhodne id, ať se seznam netřese', () => {
    const tie = [task('b', 10), task('a', 10)]
    expect(sortTasks(tie).map((t) => t.id)).toEqual(['a', 'b'])
    expect(sortTasks([...tie].reverse()).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('nový úkol jde na konec i po přeházení', () => {
    const tasks = [task('a', 0), task('b', 999)]
    expect(nextOrder(tasks)).toBeGreaterThan(999)
  })

  it('posun prohodí sousedy', () => {
    const tasks = [task('a', 0), task('b', 10), task('c', 20)]
    expect(moveTask(tasks, 'b', -1).map((t) => t.id)).toEqual(['b', 'a', 'c'])
    expect(moveTask(tasks, 'b', 1).map((t) => t.id)).toEqual(['a', 'c', 'b'])
  })

  it('posun přečísluje celý seznam, ne jen ty dva', () => {
    // Po synchronizaci můžou být rozestupy jakékoli – prohodit jen dvě čísla
    // by pořadí rozhodilo.
    const tasks = [task('a', 3), task('b', 4), task('c', 900)]
    const moved = moveTask(tasks, 'c', -1)
    expect(moved.map((t) => t.order)).toEqual([0, 10, 20])
    expect(moved.map((t) => t.id)).toEqual(['a', 'c', 'b'])
  })

  it('na kraji se nestane nic a seznam zůstane ten samý', () => {
    const tasks = [task('a', 0), task('b', 10)]
    expect(moveTask(tasks, 'a', -1)).toBe(tasks)
    expect(moveTask(tasks, 'b', 1)).toBe(tasks)
    expect(moveTask(tasks, 'neznamy', 1)).toBe(tasks)
  })
})

describe('normalizace z formuláře', () => {
  it('ořízne mezery a prázdný název nahradí', () => {
    expect(normalizeTask(task('a', 0, { title: '   ' })).title).toBe('Úkol')
    expect(normalizeTask(task('a', 0, { title: '  Bazén  ' })).title).toBe('Bazén')
  })

  it('drží počet za týden v rozsahu 1–7', () => {
    expect(normalizeTask(task('a', 0, { target: 0 })).target).toBe(1)
    expect(normalizeTask(task('a', 0, { target: 99 })).target).toBe(7)
    expect(normalizeTask(task('a', 0, { target: 2.6 })).target).toBe(3)
    // Prázdné pole v inputu dorazí jako NaN – nesmí z toho vzniknout NaN cíl.
    expect(normalizeTask(task('a', 0, { target: Number.NaN })).target).toBe(1)
  })

  it('prázdná poznámka se zahodí, ať se nikde nezobrazuje prázdný řádek', () => {
    expect(normalizeTask(task('a', 0, { note: '   ' })).note).toBeUndefined()
    expect(normalizeTask(task('a', 0, { note: ' pozor na záda ' })).note).toBe('pozor na záda')
  })

  it('emoji se nesmí zvrhnout v celou větu', () => {
    expect(normalizeTask(task('a', 0, { emoji: 'úplně dlouhý popisek' })).emoji.length).toBeLessThanOrEqual(8)
    expect(normalizeTask(task('a', 0, { emoji: '' })).emoji).toBe('✅')
    // Emoji s variantovým selektorem má víc kódových jednotek – nesmí se uříznout.
    expect(normalizeTask(task('a', 0, { emoji: '🏋️' })).emoji).toBe('🏋️')
  })
})

describe('vlastní úkol', () => {
  it('dostane jedinečné id i při dvou založeních v jedné milisekundě', () => {
    const ids = new Set(Array.from({ length: 50 }, () => blankTask(0).id))
    expect(ids.size).toBe(50)
  })
})
