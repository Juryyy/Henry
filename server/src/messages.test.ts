import { describe, expect, it } from 'vitest'
import {
  blockMessage,
  eveningMessage,
  formatNumber,
  lastCallMessage,
  mondayMessage,
  plural,
  stepCheckMessage,
  taskReminderMessage,
  weeklyMessage,
} from './messages.js'
import type { StateSnapshot } from './store.js'

/**
 * Texty notifikací.
 *
 * Zajímají nás dvě věci: že se do šablon dosazují správná čísla (porce dne
 * není totéž co „zbývá dnes“ – zaměnit je znamená notifikaci, která si sama
 * odporuje) a že v odeslané zprávě nezůstane nedosazený zástupný symbol.
 */
function snapshot(patch: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    updatedAt: '2026-08-17T10:00:00.000Z',
    date: '2026-08-17',
    steps: 3_000,
    stepsNeededToday: 2_000,
    stepPortionToday: 5_000,
    stepTarget: 5_000,
    blocksDone: 1,
    blocksTarget: 3,
    doneSlots: [0],
    stepDebt: 0,
    stepsRemainingThisWeek: 20_000,
    streak: 4,
    openTasks: [],
    name: 'Martin',
    history: [],
    ...patch,
  }
}

/** Všechny zprávy, které umí server poslat – pro plošné kontroly. */
function everyMessage(snap: StateSnapshot, seed = 's'): { title: string; body: string }[] {
  return [
    ...[0, 1, 2].map((slot) => blockMessage(slot, snap, 'coach', seed)),
    stepCheckMessage(snap, 'coach', seed),
    lastCallMessage(snap, seed),
    eveningMessage(snap, 'coach', seed),
    weeklyMessage(snap, 'coach', seed),
    mondayMessage(snap, seed),
    taskReminderMessage(['Posilovna'], seed),
  ]
}

describe('čísla v textech', () => {
  it('česká čísla mají oddělené tisíce', () => {
    expect(formatNumber(4_000)).toMatch(/^4\s000$/)
  })

  it('skloňování sedí na jednotce, dvojce i pětce', () => {
    expect(plural(1, 'krok', 'kroky', 'kroků')).toBe('krok')
    expect(plural(3, 'krok', 'kroky', 'kroků')).toBe('kroky')
    expect(plural(12, 'krok', 'kroky', 'kroků')).toBe('kroků')
    expect(plural(0, 'krok', 'kroky', 'kroků')).toBe('kroků')
  })
})

describe('dosazování do šablon', () => {
  it('v žádné zprávě nezůstane nedosazený zástupný symbol', () => {
    for (const tone of ['kind', 'coach', 'drsny'] as const) {
      for (let i = 0; i < 40; i++) {
        const seed = `seed-${tone}-${i}`
        const all = [
          ...[0, 1, 2].map((slot) => blockMessage(slot, snapshot(), tone, seed)),
          stepCheckMessage(snapshot(), tone, seed),
          lastCallMessage(snapshot(), seed),
          eveningMessage(snapshot(), tone, seed),
          eveningMessage(snapshot({ steps: 9_000, blocksDone: 3 }), tone, seed),
          weeklyMessage(snapshot(), tone, seed),
          weeklyMessage(snapshot({ stepsRemainingThisWeek: 0 }), tone, seed),
          mondayMessage(snapshot(), seed),
          taskReminderMessage(['Posilovna', 'Procházka'], seed),
        ]
        for (const message of all) {
          expect(message.body).not.toMatch(/\{\w+\}/)
          expect(message.title).not.toMatch(/\{\w+\}/)
          expect(message.title.length).toBeGreaterThan(0)
          expect(message.body.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('porce dne a zbytek dne se nepletou', () => {
    // Nachozeno 3 000, porce 5 000, zbývá 2 000. Text, ve kterém by porce
    // vyšla menší než nachozené kroky, je nesmysl.
    const snap = snapshot()
    for (let i = 0; i < 40; i++) {
      for (const message of everyMessage(snap, `seed-${i}`)) {
        expect(message.body).not.toMatch(/porce 2\s000/)
        expect(message.body).not.toMatch(/3\s000 z 2\s000/)
      }
    }
  })

  it('bez porce ve snímku se dopočítá z nachozených a zbývajících', () => {
    // Starší appka pole stepPortionToday neposílala.
    const snap = snapshot({ stepPortionToday: 0 })
    const body = blockMessage(1, snap, 'coach', 'x').body + eveningMessage(snap, 'coach', 'x').body
    expect(body).not.toMatch(/\{P\}/)
    expect(body).not.toMatch(/z 0\b/)
  })

  it('nulový snímek nevyrobí zápornou ani nesmyslnou hlášku', () => {
    const snap = snapshot({ steps: 0, stepsNeededToday: 0, stepPortionToday: 0, stepTarget: 0, blocksDone: 0 })
    for (let i = 0; i < 40; i++) {
      for (const message of everyMessage(snap, `seed-${i}`)) {
        // Pomlčka v textu je v pořádku („kočka-velbloud“), záporné číslo ne.
        expect(message.body).not.toMatch(/-\d/)
        expect(message.body).not.toContain('NaN')
      }
    }
  })

  it('chybějící snímek nikoho neshodí', () => {
    for (const message of [mondayMessage(null, 's'), weeklyMessage(null, 'coach', 's')]) {
      expect(message.body).not.toMatch(/\{\w+\}/)
      expect(message.body.length).toBeGreaterThan(0)
    }
  })
})

describe('konkrétní zprávy', () => {
  it('odpolední kontrola říká, kolik ještě zbývá', () => {
    const message = stepCheckMessage(snapshot(), 'coach', 's')
    expect(message.title).toMatch(/2\s000/)
  })

  it('drsný tón nemluví jako laskavý', () => {
    const kind = stepCheckMessage(snapshot(), 'kind', 's').title
    const drsny = stepCheckMessage(snapshot(), 'drsny', 's').title
    expect(kind).not.toBe(drsny)
  })

  it('splněný den se pozná podle titulku', () => {
    const done = eveningMessage(snapshot({ steps: 9_000, blocksDone: 3 }), 'coach', 's')
    expect(['Čistý den', 'Všechno splněno', 'Tohle byl dobrý den']).toContain(done.title)
  })

  it('zavřený týden v plusu nevyhrožuje dluhem', () => {
    const message = weeklyMessage(snapshot({ stepsRemainingThisWeek: 0 }), 'coach', 's')
    expect(message.title).toBe('Týden zavřený v plusu')
  })

  it('stejný seed dá stejnou zprávu, jiný seed jinou', () => {
    expect(mondayMessage(snapshot(), 'a')).toEqual(mondayMessage(snapshot(), 'a'))
    const varianty = new Set(Array.from({ length: 12 }, (_, i) => mondayMessage(snapshot(), `s${i}`).body))
    expect(varianty.size).toBeGreaterThan(1)
  })
})
