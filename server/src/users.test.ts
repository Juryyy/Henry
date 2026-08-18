import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, openDb } from './db.js'
import {
  changePassword,
  consumeInvite,
  createApiToken,
  createInvite,
  createSession,
  createUser,
  destroyAllSessions,
  destroySession,
  findUserByEmail,
  hashPassword,
  inviteValid,
  listApiTokens,
  listSessions,
  normalizeEmail,
  passwordProblem,
  purgeExpired,
  registrationOpen,
  resolveApiToken,
  resolveSession,
  revokeApiToken,
  revokeSessionByPrefix,
  userCount,
  verifyPassword,
} from './users.js'
import { getDb } from './db.js'

const HESLO = 'dost-dlouhe-heslo'

beforeEach(() => {
  closeDb()
  openDb(':memory:')
})

describe('hesla', () => {
  it('stejné heslo dá pokaždé jiný otisk', async () => {
    const a = await hashPassword(HESLO)
    const b = await hashPassword(HESLO)
    expect(a).not.toBe(b)
    expect(a).not.toContain(HESLO)
  })

  it('ověření projde jen se správným heslem', async () => {
    const hash = await hashPassword(HESLO)
    expect(await verifyPassword(HESLO, hash)).toBe(true)
    expect(await verifyPassword('jine-dlouhe-heslo', hash)).toBe(false)
    expect(await verifyPassword('', hash)).toBe(false)
  })

  it('poškozený otisk vrátí false, ne výjimku', async () => {
    expect(await verifyPassword(HESLO, 'nesmysl')).toBe(false)
    expect(await verifyPassword(HESLO, 'scrypt$16384$8$1$$')).toBe(false)
  })

  it('krátké heslo se odmítne', () => {
    expect(passwordProblem('krátké')).toBeTruthy()
    expect(passwordProblem('a'.repeat(10))).toBeNull()
    expect(passwordProblem('a'.repeat(300))).toBeTruthy()
  })

  it('e-mail se srovná na malá písmena a bez mezer', () => {
    expect(normalizeEmail('  Martin@Example.CZ ')).toBe('martin@example.cz')
    expect(normalizeEmail('bez zavinace')).toBeNull()
    expect(normalizeEmail('a@b')).toBeNull()
    expect(normalizeEmail(42)).toBeNull()
  })
})

describe('účty', () => {
  it('první účet zavře registraci', async () => {
    expect(registrationOpen()).toBe(true)
    await createUser('ja@example.com', HESLO)
    expect(registrationOpen()).toBe(false)
    expect(userCount()).toBe(1)
  })

  it('heslo se nikde neukládá v čitelné podobě', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as {
      password_hash: string
    }
    expect(row.password_hash).not.toContain(HESLO)
  })

  it('po změně hesla platí jen to nové', async () => {
    const user = await createUser('ja@example.com', HESLO)
    await changePassword(user.id, 'uplne-jine-heslo')
    const stored = findUserByEmail('ja@example.com')!
    expect(await verifyPassword(HESLO, stored.passwordHash)).toBe(false)
    expect(await verifyPassword('uplne-jine-heslo', stored.passwordHash)).toBe(true)
  })
})

describe('sezení', () => {
  it('platné sezení vrátí uživatele', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const token = createSession(user.id, 'iPhone')
    expect(resolveSession(token)?.user.id).toBe(user.id)
  })

  it('token se v databázi neukládá, jen jeho otisk', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const token = createSession(user.id)
    const rows = getDb().prepare('SELECT id_hash FROM sessions').all() as unknown as { id_hash: string }[]
    expect(rows[0]!.id_hash).not.toBe(token)
  })

  it('vymyšlený token neprojde', () => {
    expect(resolveSession('nic-takoveho')).toBeNull()
    expect(resolveSession(undefined)).toBeNull()
  })

  it('odhlášení sezení zruší', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const token = createSession(user.id)
    destroySession(token)
    expect(resolveSession(token)).toBeNull()
  })

  it('odhlášení ostatních zařízení nechá to současné být', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const telefon = createSession(user.id, 'iPhone')
    const notebook = createSession(user.id, 'Mac')
    const current = resolveSession(telefon)!.sessionId

    expect(destroyAllSessions(user.id, current)).toBe(1)
    expect(resolveSession(telefon)).not.toBeNull()
    expect(resolveSession(notebook)).toBeNull()
  })

  it('propadlé sezení neprojde a zmizí', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const token = createSession(user.id)
    getDb().prepare('UPDATE sessions SET expires_at = ?').run('2020-01-01T00:00:00.000Z')

    expect(resolveSession(token)).toBeNull()
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })

  it('seznam přihlášení pozná to současné a nevydá celý otisk', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const token = createSession(user.id, 'iPhone')
    const current = resolveSession(token)!.sessionId

    const sessions = listSessions(user.id, current)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.current).toBe(true)
    expect(sessions[0]!.label).toBe('iPhone')
    expect(sessions[0]!.id.length).toBeLessThan(current.length)
  })

  it('konkrétní zařízení jde odhlásit ze seznamu', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const token = createSession(user.id, 'Mac')
    const id = listSessions(user.id)[0]!.id

    expect(revokeSessionByPrefix(user.id, id)).toBe(true)
    expect(resolveSession(token)).toBeNull()
  })

  it('cizí sezení odhlásit nejde', async () => {
    const ja = await createUser('ja@example.com', HESLO)
    const nekdo = await createUser('nekdo@example.com', HESLO)
    const cizi = createSession(nekdo.id, 'Mac')
    const id = listSessions(nekdo.id)[0]!.id

    expect(revokeSessionByPrefix(ja.id, id)).toBe(false)
    expect(resolveSession(cizi)).not.toBeNull()
  })
})

describe('pozvánky', () => {
  it('kód platí do prvního použití', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const code = createInvite(user.id)
    expect(inviteValid(code)).toBe(true)

    const host = await createUser('host@example.com', HESLO)
    expect(consumeInvite(code, host.id)).toBe(true)
    expect(inviteValid(code)).toBe(false)
    expect(consumeInvite(code, host.id)).toBe(false)
  })

  it('vymyšlený kód neplatí', async () => {
    await createUser('ja@example.com', HESLO)
    expect(inviteValid('nic-takoveho')).toBe(false)
  })

  it('propadlá pozvánka se při úklidu smaže', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const code = createInvite(user.id)
    getDb().prepare('UPDATE invites SET expires_at = ?').run('2020-01-01T00:00:00.000Z')

    expect(inviteValid(code)).toBe(false)
    purgeExpired()
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM invites').get()).toEqual({ n: 0 })
  })
})

describe('tokeny pro Zkratku', () => {
  it('token vrátí svého uživatele', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const token = createApiToken(user.id, 'Zkratka')
    expect(resolveApiToken(token)?.id).toBe(user.id)
  })

  it('token se ukládá jen jako otisk a v seznamu se neobjeví celý', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const token = createApiToken(user.id)
    const rows = getDb().prepare('SELECT token_hash FROM api_tokens').all() as unknown as { token_hash: string }[]
    expect(rows[0]!.token_hash).not.toBe(token)
    expect(JSON.stringify(listApiTokens(user.id))).not.toContain(token)
  })

  it('zrušený token přestane platit', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const token = createApiToken(user.id)
    expect(revokeApiToken(user.id, listApiTokens(user.id)[0]!.id)).toBe(true)
    expect(resolveApiToken(token)).toBeNull()
  })

  it('cizí token zrušit nejde', async () => {
    const ja = await createUser('ja@example.com', HESLO)
    const nekdo = await createUser('nekdo@example.com', HESLO)
    const cizi = createApiToken(nekdo.id)
    expect(revokeApiToken(ja.id, listApiTokens(nekdo.id)[0]!.id)).toBe(false)
    expect(resolveApiToken(cizi)).not.toBeNull()
  })

  it('použití tokenu se poznamená', async () => {
    const user = await createUser('ja@example.com', HESLO)
    const token = createApiToken(user.id)
    expect(listApiTokens(user.id)[0]!.lastUsedAt).toBeNull()
    resolveApiToken(token)
    expect(listApiTokens(user.id)[0]!.lastUsedAt).toBeTruthy()
  })
})
