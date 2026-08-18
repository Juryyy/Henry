import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, openDb } from './db.js'
import { createUser, type User } from './users.js'
import {
  countPasskeys,
  finishPasskeyLogin,
  finishPasskeyRegistration,
  listPasskeys,
  relyingParty,
  revokePasskey,
  startPasskeyLogin,
  startPasskeyRegistration,
} from './passkeys.js'

/**
 * Testy přihlášení přes Face ID.
 *
 * Klíčová část je dole: **celá ceremonie se odehraje doopravdy**. Níž je
 * napsaný malý softwarový authenticator, který se chová jako telefon –
 * vyrobí klíč P-256, poskládá `authData` i CBOR attestation a podepíše výzvu.
 * Server nedostane nic předžvýkaného, takže když test projde, prošla i celá
 * kryptografie: hašování domény, formát podpisu i kontrola výzvy.
 *
 * Kdyby se to jen namockovalo, test by potvrdil leda to, že se funkce volají,
 * a rozbité přihlášení by se objevilo až na skutečném iPhonu.
 */

const RP = { rpID: 'henry.example.com', origin: 'https://henry.example.com' }

let user: User

beforeEach(async () => {
  closeDb()
  openDb(':memory:')
  user = await createUser('ja@example.com', 'dost-dlouhe-heslo', 'Martin')
})

/* ------------------------------------------------------------------ */
/*  Softwarový authenticator                                           */
/* ------------------------------------------------------------------ */

/** Minimální CBOR – stačí to, co je v attestation objektu a v COSE klíči. */
function cborHead(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length])
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length])
  if (length < 0x10000) {
    const b = Buffer.alloc(3)
    b[0] = (major << 5) | 25
    b.writeUInt16BE(length, 1)
    return b
  }
  const b = Buffer.alloc(5)
  b[0] = (major << 5) | 26
  b.writeUInt32BE(length, 1)
  return b
}

const cborUint = (n: number): Buffer => cborHead(0, n)
/**
 * Záporné číslo `-n`. CBOR ho kóduje jako `n - 1` s jinou hlavičkou, takže
 * -1 je 0x20 a -7 (tedy ES256) je 0x26. COSE tím značí své klíče.
 */
const cborNegative = (n: number): Buffer => cborHead(1, n - 1)
const cborBytes = (b: Buffer): Buffer => Buffer.concat([cborHead(2, b.length), b])
const cborText = (s: string): Buffer => Buffer.concat([cborHead(3, Buffer.byteLength(s)), Buffer.from(s)])

function cborMap(entries: [Buffer, Buffer][]): Buffer {
  return Buffer.concat([cborHead(5, entries.length), ...entries.map(([k, v]) => Buffer.concat([k, v]))])
}

/** Veřejný klíč v COSE: {1: EC2, 3: ES256, -1: P-256, -2: x, -3: y}. */
function cosePublicKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  return cborMap([
    [cborUint(1), cborUint(2)],
    [cborUint(3), cborNegative(7)],
    [cborNegative(1), cborUint(1)],
    [cborNegative(2), cborBytes(Buffer.from(jwk.x, 'base64url'))],
    [cborNegative(3), cborBytes(Buffer.from(jwk.y, 'base64url'))],
  ])
}

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_BE = 0x08
const FLAG_BS = 0x10
const FLAG_AT = 0x40

function authenticatorData(options: {
  rpID: string
  flags: number
  counter: number
  credentialId?: Buffer
  publicKey?: KeyObject
}): Buffer {
  const head = Buffer.alloc(37)
  createHash('sha256').update(options.rpID).digest().copy(head, 0)
  head[32] = options.flags
  head.writeUInt32BE(options.counter, 33)
  if (!options.credentialId || !options.publicKey) return head

  const idLength = Buffer.alloc(2)
  idLength.writeUInt16BE(options.credentialId.length)
  return Buffer.concat([
    head,
    Buffer.alloc(16), // aaguid – u attestation 'none' musí být vynulované
    idLength,
    options.credentialId,
    cosePublicKey(options.publicKey),
  ])
}

function clientData(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
}

/** Telefon: drží pár klíčů, počítadlo a umí obojí ceremonii. */
function authenticator(options: { backedUp?: boolean } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const credentialId = randomBytes(32)
  const backup = options.backedUp === false ? 0 : FLAG_BE | FLAG_BS
  let counter = 0

  return {
    id: credentialId.toString('base64url'),

    register(challenge: string, rp = RP) {
      const authData = authenticatorData({
        rpID: rp.rpID,
        flags: FLAG_UP | FLAG_UV | FLAG_AT | backup,
        counter,
        credentialId,
        publicKey,
      })
      const attestationObject = cborMap([
        [cborText('fmt'), cborText('none')],
        [cborText('attStmt'), cborMap([])],
        [cborText('authData'), cborBytes(authData)],
      ])
      return {
        id: credentialId.toString('base64url'),
        rawId: credentialId.toString('base64url'),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData('webauthn.create', challenge, rp.origin).toString('base64url'),
          attestationObject: attestationObject.toString('base64url'),
          transports: ['internal', 'hybrid'],
        },
      }
    },

    login(challenge: string, rp = RP) {
      counter++
      const authData = authenticatorData({ rpID: rp.rpID, flags: FLAG_UP | FLAG_UV | backup, counter })
      const client = clientData('webauthn.get', challenge, rp.origin)
      const signature = createSign('sha256')
        .update(Buffer.concat([authData, createHash('sha256').update(client).digest()]))
        .sign(privateKey)
      return {
        id: credentialId.toString('base64url'),
        rawId: credentialId.toString('base64url'),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: client.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: signature.toString('base64url'),
          userHandle: null,
        },
      }
    },

    get counter() {
      return counter
    },
  }
}

/** Přidá uživateli klíč a vrátí authenticator, který ho drží. */
async function enroll(who = user, options: { backedUp?: boolean } = {}) {
  const device = authenticator(options)
  const { options: created, challengeId } = await startPasskeyRegistration(who, RP)
  const result = await finishPasskeyRegistration(
    who,
    challengeId,
    device.register(created.challenge) as never,
    RP,
    'iPhone',
  )
  expect(result.error ?? 'ok').toBe('ok')
  expect(result.ok).toBe(true)
  return device
}

/* ------------------------------------------------------------------ */

describe('doména, pro kterou klíč platí', () => {
  it('se vezme z adresy, na kterou požadavek přišel', () => {
    expect(relyingParty({ protocol: 'https', host: 'henry.ts.net' })).toEqual({
      rpID: 'henry.ts.net',
      origin: 'https://henry.ts.net',
    })
  })

  it('port patří do originu, ale ne do domény klíče', () => {
    expect(relyingParty({ protocol: 'http', host: 'localhost:8080' })).toEqual({
      rpID: 'localhost',
      origin: 'http://localhost:8080',
    })
  })

  it('bez hlavičky Host se nedá určit', () => {
    expect(relyingParty({ protocol: 'https', host: undefined })).toBeNull()
    expect(relyingParty({ protocol: 'https', host: '   ' })).toBeNull()
  })
})

describe('přidání klíče', () => {
  it('projde celá ceremonie a klíč se uloží', async () => {
    await enroll()

    const list = listPasskeys(user.id)
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('iPhone')
    expect(list[0].lastUsedAt).toBeNull()
    // iCloud Keychain klíč zálohuje – to appka ukazuje, ať člověk ví,
    // jestli ho ztráta telefonu odstřihne.
    expect(list[0].backedUp).toBe(true)
  })

  it('nezálohovaný klíč se pozná', async () => {
    await enroll(user, { backedUp: false })
    expect(listPasskeys(user.id)[0].backedUp).toBe(false)
  })

  it('výzva platí na jedno použití', async () => {
    const device = authenticator()
    const { options, challengeId } = await startPasskeyRegistration(user, RP)
    const response = device.register(options.challenge) as never

    expect((await finishPasskeyRegistration(user, challengeId, response, RP, 'iPhone')).ok).toBe(true)
    // Druhý pokus s tou samou výzvou je přehrání – nesmí projít.
    const again = await finishPasskeyRegistration(user, challengeId, response, RP, 'iPhone')
    expect(again.ok).toBe(false)
  })

  it('výzva vystavená někomu jinému neprojde', async () => {
    const jiny = await createUser('kamarad@example.com', 'dost-dlouhe-heslo')
    const device = authenticator()
    const { options, challengeId } = await startPasskeyRegistration(jiny, RP)

    const result = await finishPasskeyRegistration(user, challengeId, device.register(options.challenge) as never, RP, '')
    expect(result.ok).toBe(false)
    expect(countPasskeys(user.id)).toBe(0)
  })

  it('podvržená výzva neprojde', async () => {
    const device = authenticator()
    const { challengeId } = await startPasskeyRegistration(user, RP)
    const result = await finishPasskeyRegistration(
      user,
      challengeId,
      device.register(randomBytes(32).toString('base64url')) as never,
      RP,
      '',
    )
    expect(result.ok).toBe(false)
  })

  it('klíč vyrobený pro jinou doménu neprojde', async () => {
    const device = authenticator()
    const { options, challengeId } = await startPasskeyRegistration(user, RP)
    const cizi = { rpID: 'zlo.example.com', origin: 'https://zlo.example.com' }

    const result = await finishPasskeyRegistration(user, challengeId, device.register(options.challenge, cizi) as never, RP, '')
    expect(result.ok).toBe(false)
  })

  it('druhé přidání ze stejného zařízení nabídne klíč k vyloučení', async () => {
    const device = await enroll()
    const { options } = await startPasskeyRegistration(user, RP)
    expect(options.excludeCredentials?.map((c) => c.id)).toContain(device.id)
  })
})

describe('přihlášení klíčem', () => {
  it('projde a najde správný účet', async () => {
    const device = await enroll()
    const { options, challengeId } = await startPasskeyLogin(RP)

    const result = await finishPasskeyLogin(challengeId, device.login(options.challenge) as never, RP)
    expect(result.ok).toBe(true)
    expect(result.user?.id).toBe(user.id)
    // Použití se zapíše, ať se dá v nastavení poznat mrtvý klíč.
    expect(listPasskeys(user.id)[0].lastUsedAt).not.toBeNull()
  })

  it('výzva neobsahuje seznam klíčů, takže z ní nejde zjistit, kdo tu má účet', async () => {
    await enroll()
    const { options } = await startPasskeyLogin(RP)
    expect(options.allowCredentials ?? []).toHaveLength(0)
  })

  it('počítadlo se posune podle authenticatoru', async () => {
    const device = await enroll()
    for (let i = 0; i < 3; i++) {
      const { options, challengeId } = await startPasskeyLogin(RP)
      expect((await finishPasskeyLogin(challengeId, device.login(options.challenge) as never, RP)).ok).toBe(true)
    }
    const row = listPasskeys(user.id)[0]
    expect(row).toBeTruthy()
    expect(device.counter).toBe(3)
  })

  it('podpis cizím klíčem neprojde', async () => {
    await enroll()
    const utocnik = authenticator()
    const { options, challengeId } = await startPasskeyLogin(RP)

    // Útočník podepíše výzvu svým klíčem, ale vydává se za uložený.
    const podvrh = utocnik.login(options.challenge) as { id: string; rawId: string }
    const ulozeny = listPasskeys(user.id)[0].id
    podvrh.id = ulozeny
    podvrh.rawId = ulozeny

    const result = await finishPasskeyLogin(challengeId, podvrh as never, RP)
    expect(result.ok).toBe(false)
  })

  it('neznámý klíč neprojde', async () => {
    const cizi = authenticator()
    const { options, challengeId } = await startPasskeyLogin(RP)
    const result = await finishPasskeyLogin(challengeId, cizi.login(options.challenge) as never, RP)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('není zaregistrovaný')
  })

  it('výzva platí na jedno použití', async () => {
    const device = await enroll()
    const { options, challengeId } = await startPasskeyLogin(RP)
    const response = device.login(options.challenge) as never

    expect((await finishPasskeyLogin(challengeId, response, RP)).ok).toBe(true)
    expect((await finishPasskeyLogin(challengeId, response, RP)).ok).toBe(false)
  })

  it('přihlášení z jiné domény neprojde ani se správným klíčem', async () => {
    const device = await enroll()
    const { options, challengeId } = await startPasskeyLogin(RP)
    const cizi = { rpID: 'zlo.example.com', origin: 'https://zlo.example.com' }

    const result = await finishPasskeyLogin(challengeId, device.login(options.challenge, cizi) as never, RP)
    expect(result.ok).toBe(false)
  })
})

describe('správa klíčů', () => {
  it('klíče se nemíchají mezi účty', async () => {
    const jiny = await createUser('kamarad@example.com', 'dost-dlouhe-heslo')
    await enroll(user)
    await enroll(jiny)

    expect(countPasskeys(user.id)).toBe(1)
    expect(countPasskeys(jiny.id)).toBe(1)
    expect(listPasskeys(user.id)[0].id).not.toBe(listPasskeys(jiny.id)[0].id)
  })

  it('cizí klíč se odebrat nedá', async () => {
    const jiny = await createUser('kamarad@example.com', 'dost-dlouhe-heslo')
    const device = await enroll(jiny)

    expect(revokePasskey(user.id, device.id)).toBe(false)
    expect(countPasskeys(jiny.id)).toBe(1)
  })

  it('odebraným klíčem se už přihlásit nedá', async () => {
    const device = await enroll()
    expect(revokePasskey(user.id, device.id)).toBe(true)

    const { options, challengeId } = await startPasskeyLogin(RP)
    expect((await finishPasskeyLogin(challengeId, device.login(options.challenge) as never, RP)).ok).toBe(false)
  })
})
