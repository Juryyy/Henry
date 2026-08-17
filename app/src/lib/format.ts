const nf = new Intl.NumberFormat('cs-CZ')

/** 8123 -> '8 123' (s pevnou mezerou, aby se číslo nezalomilo). */
export function num(value: number): string {
  return nf.format(Math.round(value)).replace(/ /g, ' ')
}

/** Skloňování: plural(3, 'krok', 'kroky', 'kroků') -> 'kroky' */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n))
  if (abs === 1) return one
  if (abs >= 2 && abs <= 4) return few
  return many
}

export function steps(n: number): string {
  return `${num(n)} ${plural(n, 'krok', 'kroky', 'kroků')}`
}

export function blocks(n: number): string {
  return `${n} ${plural(n, 'blok', 'bloky', 'bloků')}`
}

export function minutes(n: number): string {
  return `${n} ${plural(n, 'minuta', 'minuty', 'minut')}`
}

export function days(n: number): string {
  return `${n} ${plural(n, 'den', 'dny', 'dní')}`
}

/** Odhad, jak dlouho trvá ujít daný počet kroků (svižná chůze ≈ 100 kroků/min). */
export function walkTime(stepCount: number): string {
  const mins = Math.round(stepCount / 100)
  if (mins < 60) return `~${mins} min chůze`
  const h = Math.floor(mins / 60)
  const rest = mins % 60
  return rest === 0 ? `~${h} h chůze` : `~${h} h ${rest} min chůze`
}

/** Sekundy -> '15 min' / '2:30' podle kontextu. */
export function durationShort(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const m = Math.round(seconds / 60)
  return `${m} min`
}

export function signed(value: number, unit = ''): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${num(value)}${unit}`
}
