/**
 * Přihlášený účet.
 *
 * Stav je záměrně tenký: appka si nedrží žádný token ani heslo, jen to,
 * jestli server řekl „jsi přihlášený“ a kdo to je. Vlastní přihlášení nese
 * cookie, ke které se JavaScript nedostane.
 */

import { computed, ref } from 'vue'
import {
  checkHealth,
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  setUnauthorizedHandler,
  type Account,
} from '@/lib/api'
import { passkeysSupported, signInWithPasskey } from '@/lib/passkey'

export const account = ref<Account | null>(null)
export const signedIn = computed(() => account.value !== null)

/** Než doběhne první dotaz na server, nevíme, jestli jsme přihlášení. */
export const authReady = ref(false)

/** Je server vůbec dostupný? Bez něj se přihlásit nedá. */
export const serverReachable = ref(true)

/** Zakládá se první účet? Pak není potřeba pozvánka. */
export const registrationOpen = ref(false)

/** Umí tenhle prohlížeč passkeys? Rozhoduje o tom, jestli nabídnout tlačítko. */
export const passkeysAvailable = passkeysSupported()

setUnauthorizedHandler(() => {
  account.value = null
})

/**
 * Zjistí, jak na tom jsme. Volá se při startu appky – výsledek rozhoduje
 * o tom, jestli se ukáže appka, přihlášení, nebo hláška o nedostupném serveru.
 */
export async function loadAccount(): Promise<void> {
  try {
    const me = await fetchMe()
    account.value = me.user
    serverReachable.value = true
  } catch {
    account.value = null
    // 401 znamená „server běží, jen nejsi přihlášený“ – to není nedostupnost.
    try {
      const health = await checkHealth()
      serverReachable.value = health.ok
      registrationOpen.value = health.registrationOpen
    } catch {
      serverReachable.value = false
    }
  } finally {
    authReady.value = true
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const { user } = await apiLogin(email, password)
  account.value = user
}

/**
 * Přihlášení otiskem/obličejem. Heslo se nikam nepíše – prohlížeč podepíše
 * výzvu klíčem, který má uložený pro tuhle adresu.
 */
export async function signInWithFaceId(options: { autofill?: boolean } = {}): Promise<void> {
  account.value = await signInWithPasskey(options)
}

export async function signUp(input: {
  email: string
  password: string
  name?: string
  invite?: string
}): Promise<void> {
  const { user } = await apiRegister(input)
  account.value = user
  registrationOpen.value = false
}

export async function signOut(): Promise<void> {
  try {
    await apiLogout()
  } finally {
    account.value = null
  }
}
