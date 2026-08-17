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

export async function sendTestPush(server: ServerSettings): Promise<{ sent: number; removed: number; failed: number }> {
  const url = api(server, '/api/test')
  if (!url) throw new Error('Server není nastavený.')
  return request(url, { method: 'POST', headers: headers(server), body: '{}' })
}

export async function fetchServerLog(server: ServerSettings): Promise<{ at: string; kind: string; detail: string }[]> {
  const url = api(server, '/api/log')
  if (!url) throw new Error('Server není nastavený.')
  const data = await request<{ log: { at: string; kind: string; detail: string }[] }>(url, {
    method: 'GET',
    headers: headers(server),
  })
  return data.log ?? []
}
