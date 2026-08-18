/**
 * Práce s daty. Všechno v aplikaci běží v *lokálním* čase uživatele
 * a datum se všude reprezentuje jako řetězec `YYYY-MM-DD` (klíč dne).
 *
 * Týden začíná v pondělí. Klíč týdne = datum pondělí daného týdne,
 * takže se vyhneme peklu ISO týdnů na přelomu roku.
 */

export type DateKey = string // 'YYYY-MM-DD'
export type WeekKey = string // 'YYYY-MM-DD' (pondělí)

const MS_DAY = 86_400_000

/** Dnešní datum jako klíč dne v lokálním čase. */
export function todayKey(now: Date = new Date()): DateKey {
  return toKey(now)
}

/** Date -> 'YYYY-MM-DD' v lokálním čase (ne UTC, `toISOString()` by posunul den). */
export function toKey(d: Date): DateKey {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'YYYY-MM-DD' -> Date v poledne lokálního času (poledne kvůli přechodu na letní čas). */
export function fromKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

/** Posune klíč dne o `n` dní (může být záporné). */
export function addDays(key: DateKey, n: number): DateKey {
  const d = fromKey(key)
  d.setDate(d.getDate() + n)
  return toKey(d)
}

/** Počet dní mezi dvěma klíči (b - a). Kladné = `b` je později. */
export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / MS_DAY)
}

/** Den v týdnu jako 0 = pondělí … 6 = neděle. */
export function weekdayIndex(key: DateKey): number {
  return (fromKey(key).getDay() + 6) % 7
}

/** Klíč týdne (pondělí) pro daný den. */
export function weekKeyOf(key: DateKey): WeekKey {
  return addDays(key, -weekdayIndex(key))
}

/** Všech 7 klíčů dní daného týdne, od pondělí. */
export function weekDays(week: WeekKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(week, i))
}

/** Posune klíč týdne o `n` týdnů. */
export function addWeeks(week: WeekKey, n: number): WeekKey {
  return addDays(week, n * 7)
}

/** Kolikátý den týdne už uběhl včetně dneška (1..7); pro budoucí týden 0. */
export function elapsedDaysInWeek(week: WeekKey, today: DateKey): number {
  const diff = daysBetween(week, today)
  if (diff < 0) return 0
  return Math.min(7, diff + 1)
}

const WEEKDAYS_SHORT = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']
const WEEKDAYS_LONG = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle']
const MONTHS_GEN = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
]

export function weekdayShort(key: DateKey): string {
  return WEEKDAYS_SHORT[weekdayIndex(key)]
}

export function weekdayLong(key: DateKey): string {
  return WEEKDAYS_LONG[weekdayIndex(key)]
}

/** '17. srpna' */
export function formatDay(key: DateKey): string {
  const d = fromKey(key)
  return `${d.getDate()}. ${MONTHS_GEN[d.getMonth()]}`
}

/** '17. 8.' */
export function formatDayShort(key: DateKey): string {
  const d = fromKey(key)
  return `${d.getDate()}. ${d.getMonth() + 1}.`
}

/** 'Po 17. 8.' */
export function formatDayWithWeekday(key: DateKey): string {
  return `${weekdayShort(key)} ${formatDayShort(key)}`
}

/** '11.–17. srpna' pro celý týden. */
export function formatWeekRange(week: WeekKey): string {
  const from = fromKey(week)
  const to = fromKey(addDays(week, 6))
  if (from.getMonth() === to.getMonth()) {
    return `${from.getDate()}.–${to.getDate()}. ${MONTHS_GEN[to.getMonth()]}`
  }
  return `${from.getDate()}. ${MONTHS_GEN[from.getMonth()]} – ${to.getDate()}. ${MONTHS_GEN[to.getMonth()]}`
}

/** Popisek relativní k dnešku: 'dnes' / 'včera' / 'Po 11. 8.' */
export function relativeDayLabel(key: DateKey, today: DateKey = todayKey()): string {
  const diff = daysBetween(today, key)
  if (diff === 0) return 'dnes'
  if (diff === -1) return 'včera'
  if (diff === 1) return 'zítra'
  return formatDayWithWeekday(key)
}

/** Sekundy -> '12:05' nebo '1:02:05'. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** Deterministický hash z řetězce – používá se pro „náhodný, ale stabilní“ výběr plánu dne. */
export function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}
