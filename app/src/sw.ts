/// <reference lib="webworker" />
/**
 * Service worker.
 *
 * Workbox sem při buildu vloží seznam souborů k předcachování
 * (`self.__WB_MANIFEST`), zbytek je ruční: příjem push notifikací
 * a reakce na kliknutí.
 */

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

/* ------------------------------------------------------------------ */
/*  Cache                                                              */
/* ------------------------------------------------------------------ */

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA: jakákoli navigace vrátí index.html z cache → appka jede offline.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
  }),
)

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/* ------------------------------------------------------------------ */
/*  Push                                                               */
/* ------------------------------------------------------------------ */

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
  renotify?: boolean
  requireInteraction?: boolean
  silent?: boolean
  data?: Record<string, unknown>
}

function parsePayload(event: PushEvent): PushPayload {
  if (!event.data) return {}
  try {
    return event.data.json() as PushPayload
  } catch {
    return { body: event.data.text() }
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event)
  const title = payload.title ?? 'Henry'

  const options: NotificationOptions = {
    body: payload.body ?? '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: payload.tag ?? 'henry',
    renotify: payload.renotify ?? true,
    requireInteraction: payload.requireInteraction ?? false,
    silent: payload.silent ?? false,
    data: { url: payload.url ?? '#/', ...(payload.data ?? {}) },
  } as NotificationOptions

  event.waitUntil(self.registration.showNotification(title, options))
})

/* ------------------------------------------------------------------ */
/*  Kliknutí na notifikaci                                             */
/* ------------------------------------------------------------------ */

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = (event.notification.data ?? {}) as { url?: string }
  const target = data.url ?? '#/'

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      // Když už appka běží, jen ji vytáhneme do popředí a přepneme routu –
      // otevírat druhé okno je na mobilu otravné. Filtr podle scope je tam
      // proto, že na stejné doméně může běžet i něco jiného (typicky víc
      // projektů na GitHub Pages).
      const scope = self.registration.scope
      for (const client of clientList) {
        if (!client.url.startsWith(scope)) continue
        if ('focus' in client) {
          await client.focus()
          client.postMessage({ type: 'NAVIGATE', url: target })
          return
        }
      }

      await self.clients.openWindow(target.startsWith('#') ? `${scope}${target}` : target)
    })(),
  )
})

/* ------------------------------------------------------------------ */
/*  Obnovení odběru                                                    */
/* ------------------------------------------------------------------ */

/**
 * Push služba občas odběr zneplatní a pošle `pushsubscriptionchange`.
 * Stránka to sama nezachytí, takže si nový odběr vytvoříme tady. Server je
 * na stejné adrese jako appka, takže se přihlášení veze v cookie a service
 * worker nepotřebuje znát žádný token.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/api/config')
        const { vapidPublicKey } = (await res.json()) as { vapidPublicKey?: string }
        if (!vapidPublicKey) return

        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidPublicKey,
        })
        await fetch('/api/subscribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription, label: 'obnoveno automaticky' }),
        })
      } catch (err) {
        console.error('[henry sw] obnovení odběru selhalo', err)
      }
    })(),
  )
})
