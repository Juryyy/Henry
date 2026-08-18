/**
 * Komunikace se serverem.
 *
 * Appku servíruje ten samý server, takže se volá relativně a přihlášení nese
 * cookie – žádná adresa k opisování, žádný token v nastavení. Kdo není
 * přihlášený, dostane 401 a appka ho pošle na přihlašovací obrazovku.
 */

import type { NotificationSettings } from './types'

export interface ServerStepEntry {
  date: string
  steps: number
  source: string
  updatedAt: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Zavolá se, když server odpoví 401 – appka na to reaguje odhlášením. */
let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: init.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init.headers,
      signal: controller.signal,
    })

    if (!res.ok) {
      // Server posílá chyby jako `{ error: '…' }` – když to nejde přečíst,
      // aspoň číslo, ať uživatel nekouká na „něco se pokazilo“.
      const detail = await res
        .json()
        .then((body: { error?: string }) => body?.error)
        .catch(() => undefined)

      // Neúspěšné přihlášení není vypršelé sezení. Kdyby se odhlašovalo i tady,
      // překlep v hesle by shodil přihlašovací obrazovku a hláška ze serveru
      // („nesedí e-mail nebo heslo“) by se ztratila.
      const signInAttempt = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register')
      if (res.status === 401 && !signInAttempt) onUnauthorized?.()

      throw new ApiError(detail ?? `Server odpověděl ${res.status}.`, res.status)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    if ((err as Error).name === 'AbortError') throw new ApiError('Server neodpovídá.', 0)
    throw new ApiError((err as Error).message || 'Server je nedostupný.', 0)
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/*  Účet                                                               */
/* ------------------------------------------------------------------ */

export interface Account {
  id: string
  email: string
  name: string
  createdAt: string
}

export interface HealthResponse {
  ok: boolean
  now: { date: string; minutes: number; weekday: number }
  scheduler: boolean
  /** Když je server čerstvě nasazený, první účet se zakládá bez pozvánky. */
  registrationOpen: boolean
}

export function checkHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health')
}

export function register(input: {
  email: string
  password: string
  name?: string
  invite?: string
}): Promise<{ user: Account; first: boolean }> {
  return request('/api/auth/register', { method: 'POST', body: JSON.stringify(input) })
}

export function login(email: string, password: string): Promise<{ user: Account }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function logout(): Promise<{ ok: boolean }> {
  return request('/api/auth/logout', { method: 'POST', body: '{}' })
}

export function fetchMe(): Promise<{ user: Account; subscriptions: number }> {
  return request('/api/auth/me')
}

export function changePassword(current: string, next: string): Promise<{ revoked: number }> {
  return request('/api/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) })
}

export function setAccountName(name: string): Promise<{ ok: boolean }> {
  return request('/api/auth/name', { method: 'POST', body: JSON.stringify({ name }) })
}

export interface DeviceSession {
  id: string
  createdAt: string
  lastSeenAt: string
  label: string
  current?: boolean
}

export function fetchSessions(): Promise<{ sessions: DeviceSession[] }> {
  return request('/api/auth/sessions')
}

export function revokeSession(id: string): Promise<{ ok: boolean }> {
  return request('/api/auth/sessions/revoke', { method: 'POST', body: JSON.stringify({ id }) })
}

export function revokeOtherSessions(): Promise<{ revoked: number }> {
  return request('/api/auth/sessions/revoke', { method: 'POST', body: JSON.stringify({ all: true }) })
}

export interface InviteInfo {
  createdAt: string
  expiresAt: string
  usedAt: string | null
}

export function createInvite(): Promise<{ code: string }> {
  return request('/api/auth/invite', { method: 'POST', body: '{}' })
}

export function fetchInvites(): Promise<{ invites: InviteInfo[] }> {
  return request('/api/auth/invites')
}

/* ------------------------------------------------------------------ */
/*  Tokeny pro Zkratku                                                 */
/* ------------------------------------------------------------------ */

export interface ApiTokenInfo {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
}

export function fetchTokens(): Promise<{ tokens: ApiTokenInfo[] }> {
  return request('/api/tokens')
}

export function createToken(label: string): Promise<{ token: string; label: string }> {
  return request('/api/tokens', { method: 'POST', body: JSON.stringify({ label }) })
}

export function revokeToken(id: string): Promise<{ ok: boolean }> {
  return request('/api/tokens/revoke', { method: 'POST', body: JSON.stringify({ id }) })
}

/* ------------------------------------------------------------------ */
/*  Snímek pro notifikace a kroky                                      */
/* ------------------------------------------------------------------ */

/**
 * Nahraje na server aktuální snímek stavu a nastavení připomínek.
 * Server z toho skládá text notifikací („chybí ti 3 200 kroků“).
 */
export function syncWithServer(
  notifications: NotificationSettings,
  snapshot: unknown,
  timezone: string,
  blocksPerDay: number,
): Promise<{ serverSteps: ServerStepEntry | null }> {
  return request('/api/sync', {
    method: 'POST',
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

export async function pullSteps(days = 14): Promise<ServerStepEntry[]> {
  const data = await request<{ steps: ServerStepEntry[] }>(`/api/steps?days=${days}`)
  return data.steps ?? []
}

export function sendTestPush(): Promise<{ sent: number; removed: number; failed: number }> {
  return request('/api/test', { method: 'POST', body: '{}' })
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
export function pushState(since: number, records: SyncRecord[]): Promise<StateSyncResult> {
  return request('/api/state', { method: 'POST', body: JSON.stringify({ since, records }) })
}

export interface StateVersion {
  rev: number
  at: string
  records: number
}

export function fetchVersions(): Promise<{
  versions: StateVersion[]
  stats: { rev: number; records: number; kinds: Record<string, number> }
}> {
  return request('/api/state/versions')
}

export function restoreVersion(rev: number): Promise<{ restored: number }> {
  return request('/api/state/restore', { method: 'POST', body: JSON.stringify({ rev }) })
}
