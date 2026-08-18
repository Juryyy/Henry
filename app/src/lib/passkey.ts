/**
 * Přihlášení přes Face ID / Touch ID (passkeys).
 *
 * Prohlížeč udělá tu zajímavou práci sám: podepíše výzvu ze serveru klíčem,
 * který leží v Secure Enclave a nikdy z telefonu neodejde. Tenhle soubor jen
 * překládá mezi serverem a `navigator.credentials` a hlavně řeší jednu věc,
 * kterou knihovna neřeší – **zrušení není chyba**. Když člověk odklikne
 * dialog s Face ID, prohlížeč hodí `NotAllowedError`; kdyby se to ukázalo
 * jako červená hláška, vypadalo by to, že se něco pokazilo.
 *
 * Na iPhonu funguje i v appce spuštěné z plochy (iOS 16+), což je přesně to,
 * jak se Henry používá.
 */

import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import {
  finishPasskeyLogin,
  finishPasskeyRegistration,
  startPasskeyLogin,
  startPasskeyRegistration,
  type Account,
  type PasskeyInfo,
} from './api'

/** Umí to prohlížeč vůbec? Na starém Androidu nebo v Chrome na iOS ne. */
export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn()
  } catch {
    return false
  }
}

/**
 * Má zařízení vlastní biometriku? Bez ní passkeys pořád fungují (třeba přes
 * USB klíč nebo telefon přes QR), ale nabízet „Přihlásit se Face ID" na
 * stroji, který nic takového nemá, by bylo matoucí.
 */
export async function platformPasskeyAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false
  try {
    return await platformAuthenticatorIsAvailable()
  } catch {
    return false
  }
}

/** Umí prohlížeč nabídnout klíč rovnou v poli pro e-mail? */
export async function autofillAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false
  try {
    return await browserSupportsWebAuthnAutofill()
  } catch {
    return false
  }
}

/** Zrušené okno s Face ID. Není to chyba, jen se nic nestalo. */
export class PasskeyCancelled extends Error {
  constructor() {
    super('Ověření zrušeno.')
  }
}

function translate(err: unknown): Error {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'AbortError') return new PasskeyCancelled()
  if (name === 'InvalidStateError') return new Error('Tohle zařízení už tu klíč má.')
  if (name === 'SecurityError') {
    return new Error('Klíč jde vyrobit jen na zabezpečené adrese (https). Přes http to prohlížeč nedovolí.')
  }
  return err instanceof Error ? err : new Error('Ověření se nepovedlo.')
}

/**
 * Přidá tomuhle zařízení klíč. Volá se z nastavení, tedy už přihlášený.
 */
export async function addPasskey(label?: string): Promise<PasskeyInfo> {
  const { options, challengeId } = await startPasskeyRegistration()
  let response
  try {
    response = await startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON })
  } catch (err) {
    throw translate(err)
  }
  const { passkey } = await finishPasskeyRegistration(challengeId, response, label)
  return passkey
}

/**
 * Přihlášení klíčem. Žádný e-mail se nikam nepíše – prohlížeč sám ví, které
 * klíče pro tuhle adresu má, a nabídne je.
 *
 * `autofill` zapne nabídku přímo v poli pro e-mail (conditional UI). Ta se
 * spouští na pozadí hned při otevření obrazovky a čeká, dokud do pole někdo
 * neklikne; proto se její zrušení nikde nehlásí.
 */
export async function signInWithPasskey(options: { autofill?: boolean } = {}): Promise<Account> {
  const { options: requestOptions, challengeId } = await startPasskeyLogin()
  let response
  try {
    response = await startAuthentication({
      optionsJSON: requestOptions as PublicKeyCredentialRequestOptionsJSON,
      useBrowserAutofill: options.autofill === true,
    })
  } catch (err) {
    throw translate(err)
  }
  const { user } = await finishPasskeyLogin(challengeId, response)
  return user
}
