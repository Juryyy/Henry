/**
 * Přihlášení otiskem/obličejem – passkeys (WebAuthn).
 *
 * Jak to funguje: telefon si vyrobí pár klíčů. Soukromý zůstane v Secure
 * Enclave a nikdy ho nevydá – Face ID jen odemkne jeho použití. Server dostane
 * ten veřejný. Přihlášení je pak podpis náhodné výzvy, takže po drátě neletí
 * nic, co by šlo odchytit a použít podruhé, a z ukradené databáze se přihlásit
 * nedá. Zároveň to není heslo, takže není co zapomenout ani co vyzradit
 * podvodné stránce – klíč je svázaný s doménou.
 *
 * Proti Googlu/Apple přihlášení: tady není žádná třetí strana. Nikdo cizí se
 * nedozví, kdy se do appky díváš, a když ti někdo zruší účet u velké firmy,
 * na tvůj server to nemá vliv.
 *
 * Heslo zůstává jako záchranná cesta. Passkey je vázaná na zařízení (byť
 * synchronizovaná přes iCloud) a na doménu – kdo přijde o telefon nebo se
 * přestěhuje na jinou adresu, musí se dostat dovnitř jinak.
 */

import { randomBytes } from 'node:crypto'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { getDb } from './db.js'
import { findUser, type User } from './users.js'

/** Rozehraná výzva platí pár minut – tolik trvá i pomalé odemknutí. */
const CHALLENGE_MINUTES = 5

/**
 * Kdo se ptá a odkud. WebAuthn je schválně svázaný s doménou: klíč vyrobený
 * pro `henry.ts.net` se na `henry.doma.cz` nepřihlásí. Proto se to nebere
 * z konfigurace, ale z adresy, na kterou požadavek doopravdy přišel – jinak
 * by se to po každé změně adresy muselo ručně přenastavovat.
 */
export interface RelyingParty {
  /** Doména bez portu a bez schématu. */
  rpID: string
  /** Celý původ včetně schématu, jak ho vidí prohlížeč. */
  origin: string
}

export function relyingParty(input: { protocol: string; host: string | undefined }): RelyingParty | null {
  const host = input.host?.trim()
  if (!host) return null
  try {
    const url = new URL(`${input.protocol}://${host}`)
    if (!url.hostname) return null
    return { rpID: url.hostname, origin: url.origin }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  Uložené klíče                                                      */
/* ------------------------------------------------------------------ */

export interface PasskeyInfo {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  /** Zálohovaná (iCloud Keychain apod.) přežije ztrátu telefonu. */
  backedUp: boolean
}

interface CredentialRow {
  id: string
  user_id: string
  public_key: string
  counter: number
  transports: string
  label: string
  backed_up: number
  created_at: string
  last_used_at: string | null
}

function toInfo(row: CredentialRow): PasskeyInfo {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    backedUp: row.backed_up === 1,
  }
}

function transportList(value: string): AuthenticatorTransportFuture[] | undefined {
  const parts = value.split(',').filter(Boolean) as AuthenticatorTransportFuture[]
  return parts.length ? parts : undefined
}

function credentialsOf(userId: string): CredentialRow[] {
  return getDb()
    .prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at')
    .all(userId) as unknown as CredentialRow[]
}

export function listPasskeys(userId: string): PasskeyInfo[] {
  return credentialsOf(userId).map(toInfo)
}

export function countPasskeys(userId: string): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').get(userId) as { n: number }
  return row.n
}

export function revokePasskey(userId: string, id: string): boolean {
  const before = countPasskeys(userId)
  getDb().prepare('DELETE FROM credentials WHERE user_id = ? AND id = ?').run(userId, id)
  return countPasskeys(userId) < before
}

/* ------------------------------------------------------------------ */
/*  Výzvy                                                              */
/* ------------------------------------------------------------------ */

function storeChallenge(challenge: string, userId: string | null): string {
  // Kdo ověřování nedokončí, nechá tu řádek. Úklid se dělá tady, protože
  // sem se stejně chodí při každém pokusu a tabulka tím zůstane malá.
  purgeChallenges()
  const id = randomBytes(18).toString('base64url')
  const expires = new Date(Date.now() + CHALLENGE_MINUTES * 60_000).toISOString()
  getDb()
    .prepare('INSERT INTO challenges (id, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, challenge, expires)
  return id
}

/** Vytáhne výzvu a rovnou ji zahodí – na jedno použití, ať se nedá přehrát. */
function takeChallenge(id: string): { challenge: string; userId: string | null } | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) as
    | { id: string; user_id: string | null; challenge: string; expires_at: string }
    | undefined
  if (!row) return null
  db.prepare('DELETE FROM challenges WHERE id = ?').run(id)
  if (row.expires_at <= new Date().toISOString()) return null
  return { challenge: row.challenge, userId: row.user_id }
}

function purgeChallenges(): void {
  getDb().prepare('DELETE FROM challenges WHERE expires_at <= ?').run(new Date().toISOString())
}

/* ------------------------------------------------------------------ */
/*  Přidání klíče                                                      */
/* ------------------------------------------------------------------ */

export interface StartResult<T> {
  options: T
  /** Klient si ho odnese a vrátí – server podle něj najde rozehranou výzvu. */
  challengeId: string
}

export async function startPasskeyRegistration(
  user: User,
  rp: RelyingParty,
): Promise<StartResult<PublicKeyCredentialCreationOptionsJSON>> {
  const options = await generateRegistrationOptions({
    rpName: 'Henry',
    rpID: rp.rpID,
    userName: user.email,
    userDisplayName: user.name || user.email,
    // Stabilní id účtu je důležité: díky němu telefon při druhém přidání
    // klíč nahradí místo toho, aby ve výběru ležely dva stejné.
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: credentialsOf(user.id).map((row) => ({
      id: row.id,
      transports: transportList(row.transports),
    })),
    authenticatorSelection: {
      // `preferred`, ne `required`: bezpečnostní klíče bez místa na účty by
      // jinak odešly s chybou. iPhone si stejně vyrobí ten lepší druh.
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })
  return { options, challengeId: storeChallenge(options.challenge, user.id) }
}

export interface FinishRegistrationResult {
  ok: boolean
  error?: string
  passkey?: PasskeyInfo
}

export async function finishPasskeyRegistration(
  user: User,
  challengeId: string,
  response: RegistrationResponseJSON,
  rp: RelyingParty,
  label: string,
): Promise<FinishRegistrationResult> {
  const pending = takeChallenge(challengeId)
  if (!pending || pending.userId !== user.id) return { ok: false, error: 'Ověření vypršelo, zkus to znovu.' }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    })
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Klíč se nepodařilo ověřit.' }
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: 'Klíč se nepodařilo ověřit.' }
  }

  const { credential, credentialBackedUp } = verification.registrationInfo
  const now = new Date().toISOString()
  const row: CredentialRow = {
    id: credential.id,
    user_id: user.id,
    public_key: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: (credential.transports ?? response.response.transports ?? []).join(','),
    label: label.slice(0, 60) || 'Zařízení',
    backed_up: credentialBackedUp ? 1 : 0,
    created_at: now,
    last_used_at: null,
  }

  getDb()
    .prepare(
      `INSERT INTO credentials (id, user_id, public_key, counter, transports, label, backed_up, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         public_key = excluded.public_key,
         counter    = excluded.counter,
         transports = excluded.transports,
         backed_up  = excluded.backed_up`,
    )
    .run(row.id, row.user_id, row.public_key, row.counter, row.transports, row.label, row.backed_up, row.created_at)

  return { ok: true, passkey: toInfo(row) }
}

/* ------------------------------------------------------------------ */
/*  Přihlášení                                                         */
/* ------------------------------------------------------------------ */

/**
 * Výzva k přihlášení. Schválně **bez seznamu klíčů**: prohlížeč sám nabídne
 * ty, které pro tuhle doménu má, takže se nikam nepíše e-mail. Vedlejší efekt
 * je, že se odsud nedá zjistit, kdo tu má účet.
 */
export async function startPasskeyLogin(
  rp: RelyingParty,
): Promise<StartResult<PublicKeyCredentialRequestOptionsJSON>> {
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'preferred',
  })
  return { options, challengeId: storeChallenge(options.challenge, null) }
}

export interface FinishLoginResult {
  ok: boolean
  error?: string
  user?: User
  label?: string
}

export async function finishPasskeyLogin(
  challengeId: string,
  response: AuthenticationResponseJSON,
  rp: RelyingParty,
): Promise<FinishLoginResult> {
  const pending = takeChallenge(challengeId)
  if (!pending) return { ok: false, error: 'Ověření vypršelo, zkus to znovu.' }

  const row = getDb().prepare('SELECT * FROM credentials WHERE id = ?').get(response.id) as
    | CredentialRow
    | undefined
  if (!row) return { ok: false, error: 'Tenhle klíč tu není zaregistrovaný.' }

  const user = findUser(row.user_id)
  if (!user) return { ok: false, error: 'Tenhle klíč tu není zaregistrovaný.' }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
      credential: {
        id: row.id,
        publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')),
        counter: row.counter,
        transports: transportList(row.transports),
      },
    })
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Klíč se nepodařilo ověřit.' }
  }

  if (!verification.verified) return { ok: false, error: 'Klíč se nepodařilo ověřit.' }

  // Čítač musí růst. Když se vrátí, znamená to buď klon klíče, nebo
  // authenticator, který čítač nevede (pak je pořád nula) – to druhé je
  // u passkeys v iCloudu běžné, takže se jen ukládá, nezakazuje.
  getDb()
    .prepare('UPDATE credentials SET counter = ?, last_used_at = ?, backed_up = ? WHERE id = ?')
    .run(
      verification.authenticationInfo.newCounter,
      new Date().toISOString(),
      verification.authenticationInfo.credentialBackedUp ? 1 : 0,
      row.id,
    )

  return { ok: true, user, label: row.label }
}
