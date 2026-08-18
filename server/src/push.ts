import webpush, { type PushSubscription, type WebPushError } from 'web-push'
import { config } from './config.js'
import { addLog, getDb, markDirty, removeSubscription, type StoredSubscription } from './store.js'

webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey)

/** Payload, kterému rozumí service worker v `app/src/sw.ts`. */
export interface PushPayload {
  title: string
  body: string
  /** Kam se má po kliknutí skočit, relativně ke scope PWA. */
  url?: string
  /** Skupina notifikace – stejný tag přepíše předchozí místo hromadění. */
  tag?: string
  /** Vlastní data, která se pošlou zpět při kliknutí. */
  data?: Record<string, unknown>
  renotify?: boolean
  requireInteraction?: boolean
  /** Bez zvuku a vibrace. Android to respektuje, iOS zatím ignoruje. */
  silent?: boolean
}

function toSubscription(s: StoredSubscription): PushSubscription {
  return { endpoint: s.endpoint, keys: s.keys }
}

export interface SendResult {
  sent: number
  removed: number
  failed: number
}

/**
 * Rozešle notifikaci na všechna registrovaná zařízení.
 *
 * 404/410 = odběr už neexistuje (uživatel odinstaloval PWA nebo push službě
 * vypršel) → smazat, jinak by se to zkoušelo donekonečna.
 */
export async function sendToAll(payload: PushPayload): Promise<SendResult> {
  const db = getDb()
  const subs = [...db.subscriptions]
  if (subs.length === 0) return { sent: 0, removed: 0, failed: 0 }

  const body = JSON.stringify(payload)
  let sent = 0
  let removed = 0
  let failed = 0

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(toSubscription(sub), body, {
          TTL: 60 * 60, // hodinu; starší připomínka už nemá smysl
          urgency: 'normal',
        })
        sub.lastSuccessAt = new Date().toISOString()
        sub.failures = 0
        markDirty()
        sent++
      } catch (err) {
        const status = (err as WebPushError).statusCode
        if (status === 404 || status === 410) {
          removeSubscription(sub.endpoint)
          removed++
          addLog('push', `odběr smazán (${status}): ${sub.label}`)
          return
        }
        sub.failures = (sub.failures ?? 0) + 1
        markDirty()
        failed++
        addLog('push', `chyba ${status ?? '?'} u ${sub.label}: ${(err as Error).message}`)
        // Po deseti neúspěších to vzdáme – zařízení už zjevně neexistuje.
        if (sub.failures >= 10) {
          removeSubscription(sub.endpoint)
          removed++
          addLog('push', `odběr smazán po 10 selháních: ${sub.label}`)
        }
      }
    }),
  )

  return { sent, removed, failed }
}
