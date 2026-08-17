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


/**
 * Převede vstup z formuláře na číslo.
 *
 * Bere jak řetězec, tak číslo: Vue u `v-model` na `<input type="number">`
 * hodnotu samo převádí na číslo, kdežto u `type="text"` zůstane řetězec.
 * Zavolat `.replace()` na tom prvním by shodilo celou obsluhu události –
 * a tlačítko by mlčky nedělalo nic.
 *
 * Zvládne i české zápisy: „8 423“, „8 423“ (pevná mezera), „92,4“.
 */
export function parseNumber(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  if (typeof input !== 'string') return null
  const cleaned = input.trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}
