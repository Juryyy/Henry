/**
 * Komunikace s push serverem. Server je nepovinný – když není nastavený,
 * všechny funkce se tiše vzdají a appka jede dál jen lokálně.
 */

import type { NotificationSettings, ServerSettings } from './types'

export interface ServerStepEntry {
  date: string
  steps: number
  source: string
  updatedAt: string
}

function api(server: ServerSettings, path: string): string | null {
  if (!server.baseUrl) return null
  return `${server.baseUrl.replace(/\/$/, '')}${path}`
}

function headers(server: ServerSettings): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${server.token}` }
}

async function request<T>(url: string, init: RequestInit, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(res.status === 401 ? 'Neplatný token.' : `Server odpověděl ${res.status}. ${detail.slice(0, 120)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */

export interface HealthResponse {
  ok: boolean
  now: { date: string; minutes: number; weekday: number }
  subscriptions: number
  scheduler: boolean
}

export async function checkHealth(server: ServerSettings): Promise<HealthResponse> {
  const url = api(server, '/api/health')
  if (!url) throw new Error('Server není nastavený.')
  return request<HealthResponse>(url, { method: 'GET' })
}

/**
 * Nahraje na server aktuální snímek stavu a nastavení připomínek.
 * Server z toho skládá text notifikací („chybí ti 3 200 kroků“).
 */
export async function syncWithServer(
  server: ServerSettings,
  notifications: NotificationSettings,
  snapshot: Record<string, unknown>,
  timezone: string,
  blocksPerDay: number,
): Promise<{ serverSteps: ServerStepEntry | null }> {
  const url = api(server, '/api/sync')
  if (!url) throw new Error('Server není nastavený.')
  return request<{ serverSteps: ServerStepEntry | null }>(url, {
    method: 'POST',
    headers: headers(server),
    body: JSON.stringify({
      snapshot,
      schedule: {
        enabled: notifications.enabled,
        timezone,
        blocksPerDay,
        blockTimes: notifications.blockTimes,
        stepCheckTime: notifications.stepCheckTime,
        stepCheckThreshold: notifications.stepCheckThreshold,
        eveningReviewTime: notifications.eveningReviewTime,
        weeklyReviewTime: notifications.weeklyReviewTime,
        quietFrom: notifications.quietFrom,
        quietTo: notifications.quietTo,
        tone: notifications.tone,
      },
    }),
  })
}

/** Stáhne kroky nahrané zkratkou z Apple Health. */
export async function pullSteps(server: ServerSettings, days = 14): Promise<ServerStepEntry[]> {
  const url = api(server, `/api/steps?days=${days}`)
  if (!url) throw new Error('Server není nastavený.')
  const data = await request<{ steps: ServerStepEntry[] }>(url, { method: 'GET', headers: headers(server) })
  return data.steps ?? []
}

/* ------------------------------------------------------------------ */
/*  Synchronizace dat mezi zařízeními                                  */
/* ------------------------------------------------------------------ */

export interface SyncRecord {
  kind: string
  id: string
  updatedAt: string
  deleted?: boolean
  payload?: unknown
  rev?: number
}

export interface StateSyncResult {
  rev: number
  applied: number
  skipped: number
  records: SyncRecord[]
}

/**
 * Nahraje změněné záznamy a rovnou si odnese to, co mezitím nahrálo jiné
 * zařízení. Jedno kolo místo dvou – na mobilních datech se to pozná.
 */
export async function pushState(
  server: ServerSettings,
  since: number,
  records: SyncRecord[],
): Promise<StateSyncResult> {
  const url = api(server, '/api/state')
  if (!url) throw new Error('Server není nastavený.')
  return request<StateSyncResult>(url, {
    method: 'POST',
    headers: headers(server),
    body: JSON.stringify({ since, records }),
  })
}

export interface StateVersion {
  rev: number
  at: string
  records: number
}

export async function fetchVersions(
  server: ServerSettings,
): Promise<{ versions: StateVersion[]; stats: { rev: number; records: number; kinds: Record<string, number> } }> {
  const url = api(server, '/api/state/versions')
  if (!url) throw new Error('Server není nastavený.')
  return request(url, { method: 'GET', headers: headers(server) })
}

export async function restoreVersion(server: ServerSettings, rev: number): Promise<{ restored: number }> {
  const url = api(server, '/api/state/restore')
  if (!url) throw new Error('Server není nastavený.')
  return request(url, { method: 'POST', headers: headers(server), body: JSON.stringify({ rev }) })
}

export async function sendTestPush(server: ServerSettings): Promise<{ sent: number; removed: number; failed: number }> {
  const url = api(server, '/api/test')
  if (!url) throw new Error('Server není nastavený.')
  return request(url, { method: 'POST', headers: headers(server), body: '{}' })
}
