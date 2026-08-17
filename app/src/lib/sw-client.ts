/**
 * Registrace service workeru a všechno kolem push notifikací.
 *
 * ── Co je potřeba vědět o iOS ────────────────────────────────────────
 * 1. Web Push na iPhonu funguje až od iOS 16.4 a JEN když je appka
 *    přidaná na plochu (Sdílet → Přidat na plochu). V Safari na kartě
 *    to nejde – `PushManager` tam ani neexistuje.
 * 2. O povolení se musí říct z reakce na dotek uživatele (tlačítko),
 *    ne automaticky po načtení.
 * 3. Naplánovat notifikaci dopředu bez serveru nelze. Notification
 *    Triggers API se nikdy nedodělalo a Periodic Background Sync na iOS
 *    není. Proto ten malý server – bez něj chodí připomínky jen ve chvíli,
 *    kdy appku otevřeš.
 */

import { ref } from 'vue'
import { router } from '@/router'

const CONFIG_CACHE = 'henry-config'
const CONFIG_URL = '/__henry_push_config'

export const swRegistration = ref<ServiceWorkerRegistration | null>(null)
export const updateAvailable = ref(false)

/* ------------------------------------------------------------------ */
/*  Registrace                                                         */
/* ------------------------------------------------------------------ */

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return

  try {
    const swUrl = `${import.meta.env.BASE_URL}${import.meta.env.DEV ? 'dev-sw.js?dev-sw' : 'sw.js'}`
    const registration = await navigator.serviceWorker.register(swUrl, {
      type: import.meta.env.DEV ? 'module' : 'classic',
      scope: import.meta.env.BASE_URL,
    })
    swRegistration.value = registration

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      if (!installing) return
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          updateAvailable.value = true
        }
      })
    })

    // Kliknutí na notifikaci posílá zprávu do už běžící appky.
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'NAVIGATE' && typeof event.data.url === 'string') {
        const path = event.data.url.replace(/^#/, '')
        void router.push(path || '/')
      }
    })
  } catch (err) {
    console.error('[henry] service worker se nezaregistroval', err)
  }
}

export function applyUpdate(): void {
  swRegistration.value?.waiting?.postMessage({ type: 'SKIP_WAITING' })
  updateAvailable.value = false
  setTimeout(() => location.reload(), 300)
}

/* ------------------------------------------------------------------ */
/*  Detekce prostředí                                                  */
/* ------------------------------------------------------------------ */

/** Běží appka jako nainstalovaná PWA (a ne jako karta v prohlížeči)? */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari na iOS má vlastní nestandardní příznak.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS se od verze 13 hlásí jako Mac s dotykem.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

/** Lidsky srozumitelné vysvětlení, proč to zrovna nejde. */
export function pushBlockedReason(): string | null {
  if (!('serviceWorker' in navigator)) return 'Prohlížeč nepodporuje service workery.'
  if (isIos() && !isStandalone()) {
    return 'Na iPhonu musíš appku nejdřív přidat na plochu: Sdílet → Přidat na plochu. Notifikace v Safari na kartě nefungují.'
  }
  if (!isPushSupported()) return 'Tenhle prohlížeč push notifikace neumí.'
  if (Notification.permission === 'denied') {
    return 'Notifikace máš zakázané. Povol je v nastavení telefonu u této appky.'
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  Odběr push notifikací                                              */
/* ------------------------------------------------------------------ */

/** VAPID klíč chodí jako base64url string, `subscribe()` chce Uint8Array. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i)
  return output
}

/** Uloží konfiguraci tam, kam dosáhne i service worker (localStorage nemá). */
async function writeSwConfig(baseUrl: string, token: string, key: string): Promise<void> {
  try {
    const cache = await caches.open(CONFIG_CACHE)
    await cache.put(
      CONFIG_URL,
      new Response(JSON.stringify({ baseUrl, token, key }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  } catch (err) {
    console.warn('[henry] konfiguraci pro SW se nepodařilo uložit', err)
  }
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  return 'zařízení'
}

export interface EnablePushResult {
  ok: boolean
  error?: string
}

/**
 * Musí se volat přímo z kliknutí na tlačítko – jinak iOS dialog o povolení
 * vůbec nezobrazí.
 */
export async function enablePush(baseUrl: string, token: string): Promise<EnablePushResult> {
  const blocked = pushBlockedReason()
  if (blocked) return { ok: false, error: blocked }
  if (!baseUrl) return { ok: false, error: 'Nejdřív vyplň adresu serveru.' }

  const api = baseUrl.replace(/\/$/, '')

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return { ok: false, error: 'Bez povolení notifikací to nepůjde.' }
    }

    const configRes = await fetch(`${api}/api/config`)
    if (!configRes.ok) return { ok: false, error: `Server odpověděl ${configRes.status}.` }
    const { vapidPublicKey } = (await configRes.json()) as { vapidPublicKey: string }
    if (!vapidPublicKey) return { ok: false, error: 'Server neposlal VAPID klíč.' }

    const registration = swRegistration.value ?? (await navigator.serviceWorker.ready)
    swRegistration.value = registration

    // Kdyby už odběr existoval se starým klíčem, je potřeba ho zrušit.
    const existing = await registration.pushManager.getSubscription()
    if (existing) await existing.unsubscribe()

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    })

    const res = await fetch(`${api}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subscription, label: deviceLabel() }),
    })
    if (!res.ok) {
      return { ok: false, error: res.status === 401 ? 'Neplatný token.' : `Server odpověděl ${res.status}.` }
    }

    await writeSwConfig(api, token, vapidPublicKey)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function disablePush(baseUrl: string, token: string): Promise<void> {
  const registration = swRegistration.value ?? (await navigator.serviceWorker.ready)
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  const api = baseUrl.replace(/\/$/, '')
  try {
    await fetch(`${api}/api/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    })
  } catch {
    // Server může být zrovna nedostupný – odběr zrušíme lokálně tak jako tak.
  }
  await subscription.unsubscribe()
}

/**
 * Odběr se občas sám zneplatní (aktualizace systému, obnova ze zálohy).
 * Událost `pushsubscriptionchange`, která by na to měla upozornit, na iOS
 * vůbec nefunguje, takže jediná spolehlivá obrana je při každém spuštění
 * poslat aktuální odběr znovu na server. Server ho ukládá podle endpointu,
 * takže se nic nezduplikuje.
 */
export async function resubscribeOnLaunch(baseUrl: string, token: string): Promise<void> {
  if (!baseUrl || !token || !isPushSupported()) return
  try {
    const registration = swRegistration.value ?? (await navigator.serviceWorker.ready)
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return
    await fetch(`${baseUrl.replace(/\/$/, '')}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subscription, label: deviceLabel() }),
    })
  } catch {
    // Server může být offline – zkusí se to při dalším spuštění.
  }
}

/**
 * Číslo na ikoně appky (kolik bloků dnes zbývá).
 * iOS 16.4+ to umí jen u appky přidané na plochu.
 */
export async function setBadge(count: number): Promise<void> {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  try {
    if (count > 0) await nav.setAppBadge?.(count)
    else await nav.clearAppBadge?.()
  } catch {
    // Mimo nainstalovanou PWA to vyhodí chybu – ignorujeme.
  }
}

export async function hasPushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false
  try {
    const registration = swRegistration.value ?? (await navigator.serviceWorker.ready)
    return !!(await registration.pushManager.getSubscription())
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/*  Lokální notifikace (nouzový režim bez serveru)                     */
/* ------------------------------------------------------------------ */

/**
 * Zobrazí notifikaci hned teď, bez serveru. Používá se na potvrzení
 * („notifikace fungují“) a na dohnání zmeškaných připomínek ve chvíli,
 * kdy appku otevřeš. Naplánovat ji dopředu takhle nejde – to umí jen server.
 */
export async function showLocalNotification(title: string, body: string, url = '#/'): Promise<boolean> {
  if (notificationPermission() !== 'granted') return false
  try {
    const registration = swRegistration.value ?? (await navigator.serviceWorker.ready)
    await registration.showNotification(title, {
      body,
      icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
      badge: `${import.meta.env.BASE_URL}icons/badge-96.png`,
      tag: 'henry-local',
      data: { url },
    } as NotificationOptions)
    return true
  } catch (err) {
    console.error('[henry] lokální notifikace selhala', err)
    return false
  }
}

export async function requestPermissionOnly(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  return Notification.requestPermission()
}
