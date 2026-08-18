import { describe, expect, it } from 'vitest'
import { parseNumber, plural, steps, walkTime } from './format'

describe('parseNumber', () => {
  it('bere řetězce i čísla', () => {
    // Vue u `v-model` na type="number" pošle číslo, u type="text" řetězec.
    expect(parseNumber('6200')).toBe(6200)
    expect(parseNumber(6200)).toBe(6200)
  })

  it('rozumí českému zápisu', () => {
    expect(parseNumber('8 423')).toBe(8423)
    expect(parseNumber('8\u00a0423')).toBe(8423) // pevná mezera
    expect(parseNumber('92,4')).toBe(92.4)
    expect(parseNumber(' 104 ')).toBe(104)
  })

  it('odmítne nesmysly', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('   ')).toBeNull()
    expect(parseNumber('spousta')).toBeNull()
    expect(parseNumber(Number.NaN)).toBeNull()
    expect(parseNumber(null)).toBeNull()
    expect(parseNumber(undefined)).toBeNull()
    expect(parseNumber({})).toBeNull()
  })
})

describe('skloňování', () => {
  it('trefí správný tvar', () => {
    expect(plural(1, 'krok', 'kroky', 'kroků')).toBe('krok')
    expect(plural(3, 'krok', 'kroky', 'kroků')).toBe('kroky')
    expect(plural(8, 'krok', 'kroky', 'kroků')).toBe('kroků')
    expect(plural(0, 'krok', 'kroky', 'kroků')).toBe('kroků')
  })

  it('funguje i ve větě', () => {
    expect(steps(1)).toBe('1 krok')
    expect(steps(4200)).toContain('kroků')
  })
})

describe('odhad chůze', () => {
  it('počítá minuty a hodiny', () => {
    expect(walkTime(1000)).toBe('~10 min chůze')
    expect(walkTime(6000)).toBe('~1 h chůze')
    expect(walkTime(9000)).toBe('~1 h 30 min chůze')
  })
})
