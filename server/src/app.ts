/**
 * HTTP rozhraní serveru. Vytvoření aplikace je schválně oddělené od startu
 * (`index.ts`) – jinak by import kvůli testu otevřel port a nastartoval
 * plánovač.
 */

import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { config } from './config.js'
import { requireAuth } from './auth.js'
import { sendToAll } from './push.js'
import { tick } from './scheduler.js'
import { zonedNow } from './time.js'
import { coerceSteps, extractDailySteps, isValidDateKey, type HaePayload } from './health-export.js'
import {
  addLog,
  DEFAULT_SCHEDULE,
  getDb,
  markDirty,
  persist,
  recentSteps,
  recordSteps,
  removeSubscription,
  upsertSubscription,
  type StateSnapshot,
} from './store.js'

export const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(
  cors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Henry-Token'],
  }),
)

/**
 * Parsování těla se schválně NEpřipojuje globálně. Pořadí je vždy
 * `requireAuth` → `json`, aby nepřihlášený požadavek nedonutil server
 * alokovat paměť. Velký limit má jen route pro Health Auto Export.
 */
const json = express.json({ limit: '256kb' })
const bigJson = express.json({ limit: '25mb' })

/**
 * Apple Shortcuts umí poslat tělo jako „Soubor“ (což je spolehlivější cesta,
 * než jejich rozbitý skládač JSON) – jenže pak nastaví Content-Type na
 * text/plain nebo application/octet-stream. Výchozí `express.json()` takové
 * tělo tiše zahodí a endpoint by hlásil „chybí steps“. Proto tahle varianta
 * bere cokoli a parsuje to jako JSON.
 */
const anyJson = express.json({ limit: '256kb', type: () => true })

/* ------------------------------------------------------------------ */
/*  Veřejné                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/health', (_req, res) => {
  const db = getDb()
  res.json({
    ok: true,
    now: zonedNow(db.schedule.timezone),
    subscriptions: db.subscriptions.length,
    scheduler: config.schedulerEnabled && db.schedule.enabled,
  })
})

// Veřejný VAPID klíč není tajný – appka ho potřebuje ještě před přihlášením.
app.get('/api/config', (_req, res) => {
  res.json({ vapidPublicKey: config.vapid.publicKey, timezone: getDb().schedule.timezone })
})

/* ------------------------------------------------------------------ */
/*  Odběry push notifikací                                             */
/* ------------------------------------------------------------------ */

app.post('/api/subscribe', requireAuth, json, (req: Request, res: Response) => {
  const { subscription, label } = req.body ?? {}
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    res.status(400).json({ error: 'Chybí platný objekt subscription.' })
    return
  }
  const saved = upsertSubscription({
    endpoint: String(subscription.endpoint),
    keys: { p256dh: String(subscription.keys.p256dh), auth: String(subscription.keys.auth) },
    label: typeof label === 'string' ? label.slice(0, 80) : undefined,
  })
  addLog('subscribe', saved.label)
  persist()
  res.json({ ok: true, subscriptions: getDb().subscriptions.length })
})

app.post('/api/unsubscribe', requireAuth, json, (req: Request, res: Response) => {
  const endpoint = req.body?.endpoint
  if (typeof endpoint !== 'string') {
    res.status(400).json({ error: 'Chybí endpoint.' })
    return
  }
  const removed = removeSubscription(endpoint)
  persist()
  res.json({ ok: true, removed })
})

app.get('/api/subscriptions', requireAuth, (_req, res) => {
  res.json({
    subscriptions: getDb().subscriptions.map((s) => ({
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
/*  Synchronizace stavu a nastavení                                    */
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
  const db = getDb()
  const { snapshot, schedule } = req.body ?? {}

  if (snapshot && typeof snapshot === 'object') {
    const s = snapshot as Partial<StateSnapshot>
    db.snapshot = {
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
    }
    markDirty()
  }

  if (schedule && typeof schedule === 'object') {
    db.schedule = { ...DEFAULT_SCHEDULE, ...db.schedule, ...schedule }
    db.schedule.blocksPerDay = Math.max(1, Math.min(3, Math.round(num(db.schedule.blocksPerDay, 3))))
    markDirty()
  }

  persist()
  const date = getDb().snapshot?.date ?? ''
  res.json({ ok: true, serverSteps: getDb().steps[date] ?? null })
})

/* ------------------------------------------------------------------ */
/*  Kroky z Apple Shortcuts                                            */
/* ------------------------------------------------------------------ */

/**
 * Očekávaný požadavek ze zkratky:
 *
 *   POST /api/ingest/steps
 *   Authorization: Bearer <token>
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
  const db = getDb()
  const fallbackDate = zonedNow(db.schedule.timezone).date
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>

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
  for (const row of accepted) recordSteps(row.date, row.steps, source)

  // Ať notifikace hned reflektují nová data, i když appka není otevřená.
  const todayRow = accepted.find((row) => row.date === db.snapshot?.date)
  if (db.snapshot && todayRow) {
    db.snapshot.steps = todayRow.steps
    db.snapshot.updatedAt = new Date().toISOString()
    markDirty()
  }

  addLog('steps', accepted.map((r) => `${r.date}:${r.steps}`).join(' '))
  persist()
  res.json({ ok: true, saved: accepted })
})

/**
 * Příjem z aplikace Health Auto Export (placená funkce REST API).
 * Vlastní, mnohem větší limit těla – plná synchronizace posílá klidně
 * desítky megabajtů a výchozích 100 kB by to okamžitě odmítlo.
 */
app.post('/api/ingest/health-auto-export', requireAuth, bigJson, (req: Request, res: Response) => {
  const rows = extractDailySteps(req.body as HaePayload)
  if (rows.length === 0) {
    res.status(400).json({ error: 'V payloadu není metrika step_count.' })
    return
  }
  for (const row of rows) {
    if (row.steps < 0 || row.steps > 300_000) continue
    recordSteps(row.date, row.steps, 'health-auto-export')
  }
  addLog('steps', `health-auto-export: ${rows.length} dní`)
  persist()
  res.json({ ok: true, days: rows.length })
})

app.get('/api/steps', requireAuth, (req: Request, res: Response) => {
  const days = Math.min(400, Math.max(1, Number(req.query.days ?? 30)))
  res.json({ steps: recentSteps(days) })
})

/* ------------------------------------------------------------------ */
/*  Diagnostika                                                        */
/* ------------------------------------------------------------------ */

app.post('/api/test', requireAuth, json, async (req: Request, res: Response) => {
  const result = await sendToAll({
    title: typeof req.body?.title === 'string' ? req.body.title : 'Henry zkouší mikrofon',
    body: typeof req.body?.body === 'string' ? req.body.body : 'Když tohle vidíš, notifikace fungují. Můžeš zavřít.',
    url: '#/',
    tag: 'test',
    renotify: true,
  })
  addLog('test', JSON.stringify(result))
  persist()
  res.json({ ok: true, ...result })
})

app.post('/api/tick', requireAuth, async (_req, res) => {
  await tick()
  res.json({ ok: true })
})

app.get('/api/log', requireAuth, (_req, res) => {
  res.json({ log: getDb().log.slice(0, 100) })
})

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
  addLog('error', `${status} ${err.message}`)
  res.status(status).json({
    error: status === 413 ? 'Tělo požadavku je příliš velké.' : status === 400 ? 'Tělo požadavku není platné JSON.' : 'Něco se pokazilo na serveru.',
  })
})
