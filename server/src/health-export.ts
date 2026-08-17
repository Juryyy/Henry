/**
 * Příjem dat z aplikace Health Auto Export (JSON REST).
 *
 * Formát, který posílá, má dvě pasti:
 *
 *  1. Datum NENÍ ISO 8601, ale `yyyy-MM-dd HH:mm:ss Z`, např.
 *     "2026-02-06 07:00:00 +0100". `new Date()` si s tím poradí podle nálady
 *     konkrétního enginu, takže se to parsuje ručně.
 *  2. Metriky nemají jednotný tvar – kroky mají `qty`, tep má `Min`/`Avg`/`Max`.
 *     Bereme tedy výhradně metriku `step_count`.
 */

export interface HaeMetricPoint {
  date?: string
  qty?: number
}

export interface HaeMetric {
  name?: string
  units?: string
  data?: HaeMetricPoint[]
}

export interface HaePayload {
  data?: {
    metrics?: HaeMetric[]
  }
}

/** "2026-02-06 07:00:00 +0100" -> "2026-02-06" (den tak, jak ho myslel telefon). */
export function parseHaeDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T]/.exec(value.trim())
  if (!match) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

/**
 * Vytáhne z payloadu denní součty kroků.
 * Když je pro jeden den víc záznamů, sečtou se – Health Auto Export umí
 * posílat i hodinové rozpady.
 */
export function extractDailySteps(payload: HaePayload): { date: string; steps: number }[] {
  const metrics = payload?.data?.metrics ?? []
  const metric = metrics.find((m) => m.name === 'step_count')
  if (!metric?.data) return []

  const totals = new Map<string, number>()
  for (const point of metric.data) {
    if (typeof point.date !== 'string' || typeof point.qty !== 'number') continue
    if (!Number.isFinite(point.qty) || point.qty < 0) continue
    const date = parseHaeDate(point.date)
    if (!date) continue
    totals.set(date, (totals.get(date) ?? 0) + point.qty)
  }

  return [...totals.entries()]
    .map(([date, steps]) => ({ date, steps: Math.round(steps) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Převede libovolný vstup na počet kroků.
 * Shortcuts posílají hodnotu občas jako text s oddělovačem tisíců („8 423“,
 * „8,423“), takže se z řetězce berou jen číslice.
 */
export function coerceSteps(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  const value = Number(digits)
  return Number.isFinite(value) ? value : null
}

export function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
