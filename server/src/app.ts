/**
 * HTTP rozhraní serveru. Vytvoření aplikace je schválně oddělené od startu
 * (`index.ts`) – jinak by import kvůli testu otevřel port a nastartoval
 * plánovač.
 *
 * Server servíruje i samotnou appku, takže všechno běží z jedné adresy.
 * Není to jen pohodlí: přihlašovací cookie funguje čistě jen ze stejného
 * původu a odpadá tím celý CORS.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import { config } from './config.js'
import {
  clearRateLimit,
  clearSessionCookie,
  rateLimit,
  requireAuth,
  sessionToken,
  setSessionCookie,
} from './auth.js'
import { sendToUser } from './push.js'
import { tick } from './scheduler.js'
import { zonedNow } from './time.js'
import { coerceSteps, extractDailySteps, isValidDateKey, type HaePayload } from './health-export.js'
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
  inviteValid,
  listApiTokens,
  listInvites,
  listSessions,
  normalizeEmail,
  passwordProblem,
  registrationOpen,
  renameUser,
  revokeApiToken,
  revokeSessionByPrefix,
  verifyPassword,
} from './users.js'
import {
  currentRev,
  listVersions,
  pullRecords,
  pushRecords,
  restoreVersion,
  saveVersion,
  syncStats,
} from './sync-store.js'
import {
  addLog,
  countSubscriptions,
  getSchedule,
  getSnapshot,
  getSteps,
  listLog,
  listSubscriptions,
  recentSteps,
  recordSteps,
  removeSubscription,
  setSchedule,
  setSnapshot,
  upsertSubscription,
  type StateSnapshot,
} from './store.js'

export const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')

/**
 * Parsování těla se schválně NEpřipojuje globálně. Pořadí je vždy
 * `requireAuth` → `json`, aby nepřihlášený požadavek nedonutil server
 * alokovat paměť. Velký limit má jen route pro Health Auto Export.
 */
const json = express.json({ limit: '256kb' })
const bigJson = express.json({ limit: '25mb' })
/** První synchronizace nese celou historii – pár set kilobajtů. */
const stateJson = express.json({ limit: '8mb' })

/**
 * Apple Shortcuts umí poslat tělo jako „Soubor“ (což je spolehlivější cesta,
 * než jejich rozbitý skládač JSON) – jenže pak nastaví Content-Type na
 * text/plain nebo application/octet-stream. Výchozí `express.json()` takové
 * tělo tiše zahodí a endpoint by hlásil „chybí steps“. Proto tahle varianta
 * bere cokoli a parsuje to jako JSON.
 */
const anyJson = express.json({ limit: '256kb', type: () => true })

/** Přihlašování a registrace se dají zkoušet hrubou silou – tady se to zarazí. */
const authLimit = rateLimit({ max: 10, windowMs: 10 * 60 * 1000 })

function str(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/** Popisek zařízení do seznamu přihlášení. Nic chytrého, jen orientace. */
function deviceLabel(req: Request): string {
  const ua = req.header('user-agent') ?? ''
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android'
  if (/Macintosh/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'neznámé zařízení'
}

/* ------------------------------------------------------------------ */
/*  Veřejné                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    now: zonedNow(config.timezone),
    scheduler: config.schedulerEnabled,
    // Aby appka věděla, jestli nabídnout založení účtu, nebo rovnou přihlášení.
    registrationOpen: registrationOpen(),
  })
})

// Veřejný VAPID klíč není tajný – appka ho potřebuje ještě před přihlášením.
app.get('/api/config', (_req, res) => {
  res.json({ vapidPublicKey: config.vapid.publicKey, timezone: config.timezone })
})

/* ------------------------------------------------------------------ */
/*  Účty                                                               */
/* ------------------------------------------------------------------ */

/**
 * Registrace je otevřená jen do založení prvního účtu – ten si zakládá
 * majitel serveru. Další lidé se dostanou dovnitř jen s pozvánkou; otevřená
 * registrace na veřejné adrese je pozvánka pro kohokoli.
 */
app.post('/api/auth/register', authLimit, json, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const email = normalizeEmail(body.email)
  const password = str(body.password)
  const invite = str(body.invite, 100)

  if (!email) {
    res.status(400).json({ error: 'Tohle nevypadá jako e-mailová adresa.' })
    return
  }
  const problem = passwordProblem(password)
  if (problem) {
    res.status(400).json({ error: problem })
    return
  }

  const first = registrationOpen()
  if (!first && !inviteValid(invite)) {
    res.status(403).json({ error: 'Registrace je jen na pozvánku.' })
    return
  }
  if (findUserByEmail(email)) {
    res.status(409).json({ error: 'Účet s touhle adresou už existuje.' })
    return
  }

  const user = await createUser(email, password, str(body.name, 60))
  if (!first) consumeInvite(invite, user.id)

  const token = createSession(user.id, deviceLabel(req))
  setSessionCookie(res, token)
  clearRateLimit(req)
  addLog(user.id, 'auth', first ? 'založen první účet' : 'založen účet na pozvánku')
  res.json({ user, first })
})

app.post('/api/auth/login', authLimit, json, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const email = normalizeEmail(body.email)
  const password = str(body.password)

  const user = email ? findUserByEmail(email) : null
  // Stejná hláška i stejná cesta pro neexistující účet i špatné heslo –
  // jinak by šlo přes registraci zjistit, kdo tu má účet.
  const ok = user ? await verifyPassword(password, user.passwordHash) : false
  if (!user || !ok) {
    res.status(401).json({ error: 'Nesedí e-mail nebo heslo.' })
    return
  }

  const token = createSession(user.id, deviceLabel(req))
  setSessionCookie(res, token)
  clearRateLimit(req)
  res.json({ user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt } })
})

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const token = sessionToken(req)
  if (token) destroySession(token)
  clearSessionCookie(res)
  res.json({ ok: true })
})

app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user, subscriptions: countSubscriptions(req.user!.id) })
})

app.post('/api/auth/password', requireAuth, json, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const user = findUserByEmail(req.user!.email)
  if (!user || !(await verifyPassword(str(body.current), user.passwordHash))) {
    res.status(401).json({ error: 'Stávající heslo nesedí.' })
    return
  }
  const problem = passwordProblem(str(body.next))
  if (problem) {
    res.status(400).json({ error: problem })
    return
  }

  await changePassword(user.id, str(body.next))
  // Změna hesla má vyhodit ostatní zařízení – jinak by změna po prozrazení
  // hesla nic neřešila.
  const revoked = destroyAllSessions(user.id, req.sessionId)
  addLog(user.id, 'auth', `změna hesla, odhlášeno ${revoked} dalších zařízení`)
  res.json({ ok: true, revoked })
})

app.post('/api/auth/name', requireAuth, json, (req: Request, res: Response) => {
  renameUser(req.user!.id, str((req.body as Record<string, unknown>)?.name, 60))
  res.json({ ok: true })
})

app.get('/api/auth/sessions', requireAuth, (req: Request, res: Response) => {
  res.json({ sessions: listSessions(req.user!.id, req.sessionId) })
})

app.post('/api/auth/sessions/revoke', requireAuth, json, (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (body.all === true) {
    const revoked = destroyAllSessions(req.user!.id, req.sessionId)
    res.json({ ok: true, revoked })
    return
  }
  const id = str(body.id, 64)
  if (!id) {
    res.status(400).json({ error: 'Chybí id sezení.' })
    return
  }
  res.json({ ok: revokeSessionByPrefix(req.user!.id, id) })
})

/* ------------------------------------------------------------------ */
/*  Pozvánky                                                           */
/* ------------------------------------------------------------------ */

app.post('/api/auth/invite', requireAuth, json, (req: Request, res: Response) => {
  const code = createInvite(req.user!.id)
  addLog(req.user!.id, 'auth', 'vytvořena pozvánka')
  res.json({ code })
})

app.get('/api/auth/invites', requireAuth, (req: Request, res: Response) => {
  res.json({ invites: listInvites(req.user!.id) })
})

/* ------------------------------------------------------------------ */
/*  Tokeny pro Apple Shortcuts                                         */
/* ------------------------------------------------------------------ */

app.get('/api/tokens', requireAuth, (req: Request, res: Response) => {
  res.json({ tokens: listApiTokens(req.user!.id) })
})

app.post('/api/tokens', requireAuth, json, (req: Request, res: Response) => {
  const label = str((req.body as Record<string, unknown>)?.label, 60) || 'Zkratka'
  // Token se ukazuje jednou. Podruhé už ho nikdo nedostane, ani majitel.
  res.json({ token: createApiToken(req.user!.id, label), label })
})

app.post('/api/tokens/revoke', requireAuth, json, (req: Request, res: Response) => {
  const id = str((req.body as Record<string, unknown>)?.id, 64)
  if (!id) {
    res.status(400).json({ error: 'Chybí id tokenu.' })
    return
  }
  res.json({ ok: revokeApiToken(req.user!.id, id) })
})

/* ------------------------------------------------------------------ */
/*  Odběry push notifikací                                             */
/* ------------------------------------------------------------------ */

app.post('/api/subscribe', requireAuth, json, (req: Request, res: Response) => {
  const { subscription, label } = (req.body ?? {}) as {
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
    label?: unknown
  }
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    res.status(400).json({ error: 'Chybí platný objekt subscription.' })
    return
  }
  const saved = upsertSubscription(req.user!.id, {
    endpoint: String(subscription.endpoint),
    keys: { p256dh: String(subscription.keys.p256dh), auth: String(subscription.keys.auth) },
    label: typeof label === 'string' ? label.slice(0, 80) : undefined,
  })
  addLog(req.user!.id, 'subscribe', saved.label)
  res.json({ ok: true, subscriptions: countSubscriptions(req.user!.id) })
})

app.post('/api/unsubscribe', requireAuth, json, (req: Request, res: Response) => {
  const endpoint = (req.body as Record<string, unknown>)?.endpoint
  if (typeof endpoint !== 'string') {
    res.status(400).json({ error: 'Chybí endpoint.' })
    return
  }
  res.json({ ok: true, removed: removeSubscription(req.user!.id, endpoint) })
})

app.get('/api/subscriptions', requireAuth, (req: Request, res: Response) => {
  res.json({
    subscriptions: listSubscriptions(req.user!.id).map((s) => ({
      label: s.label,
      createdAt: s.createdAt,
      lastSuccessAt: s.lastSuccessAt,
      failures: s.failures,
      // Endpoint je de facto adresa zařízení – posíláme jen konec.
      endpointTail: s.endpoint.slice(-12),
    })),
  })
})

/* ------------------------------------------------------------------ */
/*  Snímek pro notifikace a rozvrh                                     */
/* ------------------------------------------------------------------ */

/**
 * Číslo ze snímku. Cokoli, co není konečné číslo, spadne na `fallback` –
 * jinak by se NaN dostalo až do textu notifikace („chybí ti NaN kroků“).
 */
function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

app.post('/api/sync', requireAuth, json, (req: Request, res: Response) => {
  const userId = req.user!.id
  const { snapshot, schedule } = (req.body ?? {}) as Record<string, unknown>

  if (snapshot && typeof snapshot === 'object') {
    const s = snapshot as Partial<StateSnapshot>
    setSnapshot(userId, {
      updatedAt: new Date().toISOString(),
      date: String(s.date ?? ''),
      steps: num(s.steps),
      stepsNeededToday: num(s.stepsNeededToday),
      stepPortionToday: num(s.stepPortionToday),
      stepTarget: num(s.stepTarget),
      blocksDone: num(s.blocksDone),
      blocksTarget: num(s.blocksTarget, 3),
      doneSlots: Array.isArray(s.doneSlots) ? s.doneSlots.map((v) => num(v, -1)) : [],
      stepDebt: num(s.stepDebt),
      stepsRemainingThisWeek: num(s.stepsRemainingThisWeek),
      streak: num(s.streak),
      openTasks: Array.isArray(s.openTasks) ? s.openTasks.map(String).slice(0, 10) : [],
      name: String(s.name ?? '').slice(0, 40),
      history: Array.isArray(s.history)
        ? s.history.slice(0, 10).map((d) => ({
            date: String(d?.date ?? ''),
            slots: Array.isArray(d?.slots) ? d.slots.map((v) => num(v, -1)) : [],
            steps: num(d?.steps),
            target: num(d?.target),
          }))
        : [],
    })
  }

  if (schedule && typeof schedule === 'object') setSchedule(userId, schedule)

  const date = getSnapshot(userId)?.date ?? ''
  res.json({ ok: true, serverSteps: date ? getSteps(userId, date) : null })
})

/* ------------------------------------------------------------------ */
/*  Kroky z Apple Shortcuts                                            */
/* ------------------------------------------------------------------ */

/**
 * Očekávaný požadavek ze zkratky:
 *
 *   POST /api/ingest/steps
 *   Authorization: Bearer <token z Nastavení>
 *   { "date": "2026-08-17", "steps": 8123 }
 *
 * Nebo víc dní najednou (doporučeno – zahojí to den, kdy zkratka neproběhla,
 * protože HealthKit je při zamčeném telefonu nečitelný):
 *
 *   { "days": [ { "date": "2026-08-16", "steps": 7100 },
 *               { "date": "2026-08-17", "steps": 8123 } ] }
 *
 * Zápis je vždy upsert podle data. Zkratka může legitimně proběhnout víckrát
 * (ruční test, druhý spouštěč) a přičítání by kroky zdvojnásobilo.
 */
app.post('/api/ingest/steps', requireAuth, anyJson, (req: Request, res: Response) => {
  const userId = req.user!.id
  const fallbackDate = zonedNow(getSchedule(userId).timezone).date
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as Record<
    string,
    unknown
  >

  const incoming: { date: string; steps: number }[] = []

  if (Array.isArray(body.days)) {
    for (const row of (body.days as Record<string, unknown>[]).slice(0, 60)) {
      const steps = coerceSteps(row?.steps ?? row?.value ?? row?.count)
      const date = isValidDateKey(row?.date) ? row.date : null
      if (steps === null || !date) continue
      incoming.push({ date, steps })
    }
  } else {
    const steps = coerceSteps(body.steps ?? body.value ?? body.count)
    if (steps === null) {
      res.status(400).json({ error: 'Pole "steps" musí být číslo.' })
      return
    }
    incoming.push({ date: isValidDateKey(body.date) ? body.date : fallbackDate, steps })
  }

  const accepted = incoming.filter((row) => row.steps >= 0 && row.steps <= 300_000)
  if (accepted.length === 0) {
    res.status(400).json({ error: 'Nic použitelného v těle požadavku.' })
    return
  }

  const source = typeof body.source === 'string' ? body.source.slice(0, 30) : 'shortcuts'
  for (const row of accepted) recordSteps(userId, row.date, row.steps, source)

  // Ať notifikace hned reflektují nová data, i když appka není otevřená.
  const snapshot = getSnapshot(userId)
  const todayRow = accepted.find((row) => row.date === snapshot?.date)
  if (snapshot && todayRow) {
    setSnapshot(userId, { ...snapshot, steps: todayRow.steps, updatedAt: new Date().toISOString() })
  }

  addLog(userId, 'steps', accepted.map((r) => `${r.date}:${r.steps}`).join(' '))
  res.json({ ok: true, saved: accepted })
})

/**
 * Příjem z aplikace Health Auto Export (placená funkce REST API).
 * Vlastní, mnohem větší limit těla – plná synchronizace posílá klidně
 * desítky megabajtů a výchozích 100 kB by to okamžitě odmítlo.
 */
app.post('/api/ingest/health-auto-export', requireAuth, bigJson, (req: Request, res: Response) => {
  const userId = req.user!.id
  const rows = extractDailySteps(req.body as HaePayload)
  if (rows.length === 0) {
    res.status(400).json({ error: 'V payloadu není metrika step_count.' })
    return
  }
  for (const row of rows) {
    if (row.steps < 0 || row.steps > 300_000) continue
    recordSteps(userId, row.date, row.steps, 'health-auto-export')
  }
  addLog(userId, 'steps', `health-auto-export: ${rows.length} dní`)
  res.json({ ok: true, days: rows.length })
})

app.get('/api/steps', requireAuth, (req: Request, res: Response) => {
  const days = Math.min(400, Math.max(1, Number(req.query.days ?? 30) || 30))
  res.json({ steps: recentSteps(req.user!.id, days) })
})

/* ------------------------------------------------------------------ */
/*  Synchronizace dat mezi zařízeními                                  */
/* ------------------------------------------------------------------ */

/**
 * Stažení. `since` je poslední revize, kterou zařízení vidělo – server pošle
 * jen to, co od té doby přibylo. `since=0` znamená „jsem nový, dej mi všechno“.
 */
app.get('/api/state', requireAuth, (req: Request, res: Response) => {
  const since = Number(req.query.since)
  const from = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0
  const { rev, records } = pullRecords(req.user!.id, from)
  res.json({ rev, records, count: records.length })
})

/**
 * Nahrání. Server slučuje po záznamech: novější `updatedAt` vyhrává.
 * Odpověď rovnou nese i to, co mezitím nahrálo jiné zařízení, aby stačilo
 * jedno kolo místo dvou.
 */
app.post('/api/state', requireAuth, stateJson, (req: Request, res: Response) => {
  const userId = req.user!.id
  const body = req.body as { records?: unknown; since?: unknown } | undefined
  const incoming = Array.isArray(body?.records) ? body.records : []
  if (incoming.length > 20_000) {
    res.status(413).json({ error: 'Příliš mnoho záznamů najednou.' })
    return
  }

  const sinceRaw = Number(body?.since)
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : 0

  const result = pushRecords(userId, incoming)
  const { rev, records } = pullRecords(userId, since)
  if (result.applied > 0) {
    addLog(userId, 'sync', `přijato ${result.applied} záznamů (rev ${rev})`)
    saveVersion(userId)
  }

  res.json({ rev, applied: result.applied, skipped: result.skipped, records })
})

/** Verze stavu k případnému návratu. */
app.get('/api/state/versions', requireAuth, (req: Request, res: Response) => {
  res.json({ versions: listVersions(req.user!.id), stats: syncStats(req.user!.id) })
})

app.post('/api/state/restore', requireAuth, json, (req: Request, res: Response) => {
  const userId = req.user!.id
  const rev = Number((req.body as { rev?: unknown })?.rev)
  if (!Number.isFinite(rev) || rev <= 0) {
    res.status(400).json({ error: 'Chybí číslo verze.' })
    return
  }
  const result = restoreVersion(userId, Math.floor(rev))
  if (!result) {
    res.status(404).json({ error: 'Taková verze tu není.' })
    return
  }
  addLog(userId, 'sync', `návrat k verzi ${rev}`)
  res.json({ ...result, rev: currentRev(userId) })
})

/* ------------------------------------------------------------------ */
/*  Diagnostika                                                        */
/* ------------------------------------------------------------------ */

app.post('/api/test', requireAuth, json, async (req: Request, res: Response) => {
  const userId = req.user!.id
  const body = (req.body ?? {}) as Record<string, unknown>
  const result = await sendToUser(userId, {
    title: str(body.title, 80) || 'Henry zkouší mikrofon',
    body: str(body.body, 200) || 'Když tohle vidíš, notifikace fungují. Můžeš zavřít.',
    url: '#/',
    tag: 'test',
    renotify: true,
  })
  addLog(userId, 'test', JSON.stringify(result))
  res.json({ ok: true, ...result })
})

app.post('/api/tick', requireAuth, async (_req, res) => {
  await tick()
  res.json({ ok: true })
})

app.get('/api/log', requireAuth, (req: Request, res: Response) => {
  res.json({ log: listLog(req.user!.id, 100) })
})

/* ------------------------------------------------------------------ */
/*  Appka                                                              */
/* ------------------------------------------------------------------ */

const appDir = config.appDir ? resolve(config.appDir) : ''
const hasApp = !!appDir && existsSync(resolve(appDir, 'index.html'))

if (hasApp) {
  // Soubory s otiskem v názvu se nikdy nemění, index a service worker ano.
  app.use(
    express.static(appDir, {
      index: false,
      setHeaders: (res, path) => {
        if (/\/(index\.html|sw\.js|manifest\.webmanifest)$/.test(path)) {
          res.setHeader('Cache-Control', 'no-cache')
        } else if (/\/assets\//.test(path)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    }),
  )

  // Cokoli mimo API je navigace v appce – vrací se index.html a routu si
  // přebere prohlížeč.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(resolve(appDir, 'index.html'))
  })
}

/* ------------------------------------------------------------------ */
/*  Chyby                                                              */
/* ------------------------------------------------------------------ */

app.use((_req, res) => {
  res.status(404).json({ error: 'Neznámý endpoint.' })
})

app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  // Rozbité JSON nebo příliš velké tělo je chyba klienta, ne serveru –
  // parser u nich nastavuje status (400, resp. 413) a ten je potřeba zachovat.
  const status = err.status ?? err.statusCode ?? 500
  if (status >= 500) console.error('[henry]', err)
  addLog(null, 'error', `${status} ${err.message}`)
  res.status(status).json({
    error:
      status === 413
        ? 'Tělo požadavku je příliš velké.'
        : status === 400
          ? 'Tělo požadavku není platné JSON.'
          : 'Něco se pokazilo na serveru.',
  })
})
