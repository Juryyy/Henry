/**
 * Práce s časem v konkrétním časovém pásmu. Server může běžet kdekoli
 * (Fly.io v UTC, Raspberry doma), ale připomínky musí chodit podle
 * uživatelova času.
 */

export interface ZonedNow {
  /** 'YYYY-MM-DD' v daném pásmu. */
  date: string
  /** Minuty od půlnoci v daném pásmu. */
  minutes: number
  /** 0 = pondělí … 6 = neděle. */
  weekday: number
}

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
}

export function zonedNow(timeZone: string, now: Date = new Date()): ZonedNow {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  const hour = Number(parts.hour) % 24
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
    weekday: WEEKDAY_MAP[parts.weekday as string] ?? 0,
  }
}

/** 'HH:MM' -> minuty od půlnoci. Vrací null, když je vstup nesmysl. */
export function parseClock(hhmm: unknown): number | null {
  if (typeof hhmm !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Je `minutes` uvnitř nočního klidu od–do (může přecházet přes půlnoc)? */
export function inQuietHours(minutes: number, from: number | null, to: number | null): boolean {
  if (from === null || to === null) return false
  if (from === to) return false
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to
}

/** Posun data o n dní (vstup i výstup 'YYYY-MM-DD'). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
