import { describe, expect, it } from 'vitest'
import { coerceSteps, extractDailySteps, isValidDateKey, parseHaeDate } from './health-export.js'
import { addDays, inQuietHours, parseClock, zonedNow } from './time.js'

describe('kroky ze Zkratek', () => {
  it('bere čísla i řetězce s oddělovačem tisíců', () => {
    expect(coerceSteps(8423)).toBe(8423)
    expect(coerceSteps('8423')).toBe(8423)
    // Zkratky občas pošlou hodnotu naformátovanou podle národního prostředí.
    expect(coerceSteps('8 423')).toBe(8423)
    expect(coerceSteps('8\u00a0423')).toBe(8423) // pevná mezera
    expect(coerceSteps('8\u202f423')).toBe(8423) // úzká pevná mezera
    expect(coerceSteps('8,423')).toBe(8423)
    expect(coerceSteps('8.423')).toBe(8423)
  })

  it('odmítne nesmysly', () => {
    expect(coerceSteps(undefined)).toBeNull()
    expect(coerceSteps('')).toBeNull()
    expect(coerceSteps('spousta')).toBeNull()
    expect(coerceSteps(Number.NaN)).toBeNull()
    expect(coerceSteps({})).toBeNull()
  })

  it('zaokrouhluje desetinná čísla', () => {
    expect(coerceSteps(8423.6)).toBe(8424)
    // Desetinná tečka nesmí skončit jako další řád – '8423.6' není 84 236.
    expect(coerceSteps('8423.6')).toBe(8424)
    expect(coerceSteps('8423,6')).toBe(8424)
    expect(coerceSteps('8 423,5')).toBe(8424)
  })

  it('tři číslice za oddělovačem bere jako tisíce, ne jako desetiny', () => {
    expect(coerceSteps('8,423')).toBe(8423)
    expect(coerceSteps('8.423')).toBe(8423)
    expect(coerceSteps('12,345')).toBe(12345)
  })

  it('hlídá formát data', () => {
    expect(isValidDateKey('2026-08-17')).toBe(true)
    expect(isValidDateKey('17.8.2026')).toBe(false)
    expect(isValidDateKey('')).toBe(false)
    expect(isValidDateKey(20260817)).toBe(false)
  })
})

describe('Health Auto Export', () => {
  it('rozumí datu, které není ISO 8601', () => {
    // Formát 'yyyy-MM-dd HH:mm:ss Z' – mezera místo T, posun bez dvojtečky.
    expect(parseHaeDate('2026-02-06 07:00:00 -0800')).toBe('2026-02-06')
    expect(parseHaeDate('2026-08-17 23:59:00 +0200')).toBe('2026-08-17')
    expect(parseHaeDate('nesmysl')).toBeNull()
  })

  it('sečte hodinové rozpady do denních součtů', () => {
    const rows = extractDailySteps({
      data: {
        metrics: [
          {
            name: 'step_count',
            units: 'count',
            data: [
              { date: '2026-08-15 07:00:00 +0200', qty: 3000 },
              { date: '2026-08-15 12:00:00 +0200', qty: 2500 },
              { date: '2026-08-16 09:00:00 +0200', qty: 4000 },
            ],
          },
        ],
      },
    })
    expect(rows).toEqual([
      { date: '2026-08-15', steps: 5500 },
      { date: '2026-08-16', steps: 4000 },
    ])
  })

  it('ignoruje ostatní metriky – jejich body nemají pole qty', () => {
    const rows = extractDailySteps({
      data: {
        metrics: [
          { name: 'heart_rate', units: 'bpm', data: [{ date: '2026-08-15 07:00:00 +0200' }] },
        ],
      },
    })
    expect(rows).toEqual([])
  })

  it('nespadne na prázdném nebo pokřiveném vstupu', () => {
    expect(extractDailySteps({})).toEqual([])
    expect(extractDailySteps({ data: {} })).toEqual([])
    expect(extractDailySteps({ data: { metrics: [] } })).toEqual([])
  })
})

describe('čas', () => {
  it('parsuje hodiny a minuty', () => {
    expect(parseClock('07:15')).toBe(435)
    expect(parseClock('0:00')).toBe(0)
    expect(parseClock('23:59')).toBe(1439)
    expect(parseClock('24:00')).toBeNull()
    expect(parseClock('7:60')).toBeNull()
    expect(parseClock('ráno')).toBeNull()
    expect(parseClock(undefined)).toBeNull()
  })

  it('noční klid umí přejít přes půlnoc', () => {
    const from = parseClock('21:30')
    const to = parseClock('07:00')
    expect(inQuietHours(parseClock('23:00')!, from, to)).toBe(true)
    expect(inQuietHours(parseClock('03:00')!, from, to)).toBe(true)
    expect(inQuietHours(parseClock('06:59')!, from, to)).toBe(true)
    expect(inQuietHours(parseClock('07:00')!, from, to)).toBe(false)
    expect(inQuietHours(parseClock('12:00')!, from, to)).toBe(false)
    expect(inQuietHours(parseClock('21:29')!, from, to)).toBe(false)
  })

  it('klid v rámci jednoho dne', () => {
    expect(inQuietHours(600, 540, 720)).toBe(true) // 10:00 uvnitř 9:00–12:00
    expect(inQuietHours(800, 540, 720)).toBe(false)
  })

  it('posouvá datum přes konec měsíce i roku', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29') // přestupný rok
  })

  it('počítá lokální čas v zadaném pásmu', () => {
    // 2026-08-17 je pondělí; v Praze je v srpnu UTC+2.
    const zoned = zonedNow('Europe/Prague', new Date('2026-08-17T05:30:00Z'))
    expect(zoned.date).toBe('2026-08-17')
    expect(zoned.minutes).toBe(7 * 60 + 30)
    expect(zoned.weekday).toBe(0)
  })

  it('pásmo umí přehodit i datum', () => {
    // 22:30 UTC = 00:30 příštího dne v Praze.
    const zoned = zonedNow('Europe/Prague', new Date('2026-08-17T22:30:00Z'))
    expect(zoned.date).toBe('2026-08-18')
    expect(zoned.minutes).toBe(30)
    expect(zoned.weekday).toBe(1)
  })
})
