/**
 * Účty, sezení a pozvánky.
 *
 * Heslo se hašuje scryptem – je vestavěný v Nodu, takže na Raspberry se nic
 * nekompiluje. Parametry jsou zvolené tak, aby ověření trvalo kolem desetiny
 * vteřiny i na slabším ARMu: dost na to, aby hádání hesel bylo drahé, a málo
 * na to, aby se přihlášení vleklo.
 *
 * Sezení, pozvánky i tokeny pro Zkratku se ukládají zahašované. Kdo získá
 * soubor s databází, nezíská tím použitelný klíč – jen otisk.
 */

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { getDb, transact } from './db.js'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

const SCRYPT = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const KEY_LENGTH = 32

/** Jak dlouho platí přihlášení bez použití. Appka se otevírá denně. */
const SESSION_DAYS = 90
/** Pozvánka, kterou nikdo nepoužije, po týdnu propadne. */
const INVITE_DAYS = 7

export interface User {
  id: string
  email: string
  name: string
  createdAt: string
}

interface UserRow {
  id: string
  email: string
  name: string
  password_hash: string
  created_at: string
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at }
}

/* ------------------------------------------------------------------ */
/*  Hesla                                                              */
/* ------------------------------------------------------------------ */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  try {
    const expected = Buffer.from(hash, 'base64')
    const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    })
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/**
 * Požadavky na heslo. Schválně jen délka: vynucená velká písmena a číslice
 * vedou k „Heslo1!" a k lepíku na monitoru, delší heslo pomáhá víc.
 */
export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Heslo musí mít aspoň 10 znaků.'
  }
  if (password.length > 200) return 'Heslo je nesmyslně dlouhé.'
  return null
}

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const value = email.trim().toLowerCase()
  // Ne validace podle RFC – jen kontrola, že to vypadá jako adresa.
  if (value.length < 3 || value.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
  return value
}

/* ------------------------------------------------------------------ */
/*  Uživatelé                                                          */
/* ------------------------------------------------------------------ */

export function userCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  return row.n
}

export function findUserByEmail(email: string): (User & { passwordHash: string }) | null {
  const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null
}

export function findUser(id: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  return row ? toUser(row) : null
}

export function listUsers(): User[] {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as UserRow[]
  return rows.map(toUser)
}

export async function createUser(email: string, password: string, name = ''): Promise<User> {
  const user: User = { id: randomUUID(), email, name: name.slice(0, 60), createdAt: new Date().toISOString() }
  const passwordHash = await hashPassword(password)
  getDb()
    .prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, user.email, user.name, passwordHash, user.createdAt)
  return user
}

export async function changePassword(userId: string, password: string): Promise<void> {
  const hash = await hashPassword(password)
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId)
}

export function renameUser(userId: string, name: string): void {
  getDb().prepare('UPDATE users SET name = ? WHERE id = ?').run(name.slice(0, 60), userId)
}

/* ------------------------------------------------------------------ */
/*  Sezení                                                             */
/* ------------------------------------------------------------------ */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export interface SessionInfo {
  id: string
  createdAt: string
  lastSeenAt: string
  label: string
  current?: boolean
}

/** Vrátí tajemství do cookie. V databázi zůstane jen jeho otisk. */
export function createSession(userId: string, label = ''): string {
  const token = newToken()
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000)
  getDb()
    .prepare(
      'INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, label) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(hashToken(token), userId, now.toISOString(), now.toISOString(), expires.toISOString(), label.slice(0, 80))
  return token
}

/**
 * Ověří sezení a posune jeho platnost. Vrací uživatele, ne jen id – volající
 * ho stejně vždycky potřebuje a jeden dotaz navíc nikomu nechybí.
 */
export function resolveSession(token: string | undefined): { user: User; sessionId: string } | null {
  if (!token) return null
  const hash = hashToken(token)
  const row = getDb().prepare('SELECT * FROM sessions WHERE id_hash = ?').get(hash) as
    | { user_id: string; expires_at: string }
    | undefined
  if (!row) return null

  const now = new Date()
  if (row.expires_at <= now.toISOString()) {
    getDb().prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash)
    return null
  }

  const user = findUser(row.user_id)
  if (!user) return null

  // Klouzavá platnost: kdo appku používá, se neodhlásí.
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000)
  getDb()
    .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?')
    .run(now.toISOString(), expires.toISOString(), hash)

  return { user, sessionId: hash }
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id_hash = ?').run(hashToken(token))
}

/** Odhlášení ze všech zařízení – po změně hesla nebo při podezření. */
export function destroyAllSessions(userId: string, keepHash?: string): number {
  const db = getDb()
  const before = (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(userId) as { n: number }).n
  if (keepHash) db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(userId, keepHash)
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  const after = (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(userId) as { n: number }).n
  return before - after
}

export function listSessions(userId: string, currentHash?: string): SessionInfo[] {
  const rows = getDb()
    .prepare('SELECT id_hash, created_at, last_seen_at, label FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC')
    .all(userId) as unknown as { id_hash: string; created_at: string; last_seen_at: string; label: string }[]
  return rows.map((r) => ({
    // Ven jde jen kousek otisku – na rozlišení v seznamu stačí a nedá se z něj
    // nic odvodit.
    id: r.id_hash.slice(0, 12),
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    label: r.label,
    current: currentHash === r.id_hash,
  }))
}

export function revokeSessionByPrefix(userId: string, prefix: string): boolean {
  const rows = getDb().prepare('SELECT id_hash FROM sessions WHERE user_id = ?').all(userId) as unknown as {
    id_hash: string
  }[]
  const match = rows.find((r) => r.id_hash.startsWith(prefix))
  if (!match) return false
  getDb().prepare('DELETE FROM sessions WHERE id_hash = ?').run(match.id_hash)
  return true
}

/** Úklid propadlých sezení a pozvánek. Volá se při startu. */
export function purgeExpired(): void {
  const now = new Date().toISOString()
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
  db.prepare('DELETE FROM invites WHERE used_at IS NULL AND expires_at <= ?').run(now)
}

/* ------------------------------------------------------------------ */
/*  Pozvánky                                                           */
/* ------------------------------------------------------------------ */

export interface InviteInfo {
  code?: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
  usedBy: string | null
}

/**
 * Registrace je otevřená jen do založení prvního účtu. Pak už jen na kód –
 * na veřejné adrese je otevřená registrace pozvánka pro kohokoli.
 */
export function registrationOpen(): boolean {
  return userCount() === 0
}

export function createInvite(createdBy: string): string {
  const code = randomBytes(9).toString('base64url')
  const now = new Date()
  getDb()
    .prepare('INSERT INTO invites (code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(code), createdBy, now.toISOString(), new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString())
  return code
}

export function inviteValid(code: string): boolean {
  const row = getDb().prepare('SELECT expires_at, used_at FROM invites WHERE code_hash = ?').get(hashToken(code)) as
    | { expires_at: string; used_at: string | null }
    | undefined
  return !!row && !row.used_at && row.expires_at > new Date().toISOString()
}

export function consumeInvite(code: string, userId: string): boolean {
  return transact(() => {
    if (!inviteValid(code)) return false
    getDb()
      .prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code_hash = ?')
      .run(userId, new Date().toISOString(), hashToken(code))
    return true
  })
}

export function listInvites(createdBy: string): InviteInfo[] {
  const rows = getDb()
    .prepare('SELECT created_at, expires_at, used_at, used_by FROM invites WHERE created_by = ? ORDER BY created_at DESC')
    .all(createdBy) as unknown as { created_at: string; expires_at: string; used_at: string | null; used_by: string | null }[]
  return rows.map((r) => ({
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    usedBy: r.used_by,
  }))
}

/* ------------------------------------------------------------------ */
/*  Tokeny pro Apple Shortcuts                                         */
/* ------------------------------------------------------------------ */

export interface ApiTokenInfo {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
}

export function createApiToken(userId: string, label = 'Zkratka'): string {
  const token = newToken()
  getDb()
    .prepare('INSERT INTO api_tokens (token_hash, user_id, label, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, label.slice(0, 60), new Date().toISOString())
  return token
}

export function resolveApiToken(token: string | undefined): User | null {
  if (!token) return null
  const hash = hashToken(token)
  const row = getDb().prepare('SELECT user_id FROM api_tokens WHERE token_hash = ?').get(hash) as
    | { user_id: string }
    | undefined
  if (!row) return null
  getDb().prepare('UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?').run(new Date().toISOString(), hash)
  return findUser(row.user_id)
}

export function listApiTokens(userId: string): ApiTokenInfo[] {
  const rows = getDb()
    .prepare('SELECT token_hash, label, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as unknown as { token_hash: string; label: string; created_at: string; last_used_at: string | null }[]
  return rows.map((r) => ({
    id: r.token_hash.slice(0, 12),
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }))
}

export function revokeApiToken(userId: string, prefix: string): boolean {
  const rows = getDb().prepare('SELECT token_hash FROM api_tokens WHERE user_id = ?').all(userId) as unknown as {
    token_hash: string
  }[]
  const match = rows.find((r) => r.token_hash.startsWith(prefix))
  if (!match) return false
  getDb().prepare('DELETE FROM api_tokens WHERE token_hash = ?').run(match.token_hash)
  return true
}
