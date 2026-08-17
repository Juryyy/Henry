/**
 * Plánovač připomínek.
 *
 * Tiká jednou za minutu a kouká, jestli právě „nastal“ nějaký slot. Kdyby byl
 * server chvíli dole nebo tik utekl, chytne to okno tolerance
 * (GRACE_MINUTES) – a klíč v `sent` zajistí, že se stejná připomínka
 * neodešle dvakrát za den.
 *
 * Dvě věci, které tady stojí za pozornost:
 *
 *  1. Rozpočet notifikací. Slotů je devět, ale za den se pošlou nejvýš čtyři.
 *     Když je jich víc, rozhodne priorita a zbytek se ten den zahodí (ne odloží).
 *  2. Ztlumení. Když uživatel tři dny po sobě konkrétní připomínku ignoruje,
 *     slot se na dva dny odmlčí. Bez toho se z připomínky stane šum a uživatel
 *     vypne notifikace úplně – což je horší než pár vynechaných.
 */

import { sendToAll } from './push.js'
import {
  addLog,
  getDb,
  markDirty,
  markSent,
  persist,
  wasDelivered,
  wasSent,
  type Database,
  type ScheduleConfig,
  type StateSnapshot,
} from './store.js'
import {
  blockMessage,
  eveningMessage,
  lastCallMessage,
  measureMessage,
  mondayMessage,
  stepCheckMessage,
  taskReminderMessage,
  weeklyMessage,
  type Message,
} from './messages.js'
import { addDays, inQuietHours, parseClock, zonedNow } from './time.js'

/** Kolik minut po plánovaném čase ještě dává smysl notifikaci poslat. */
const GRACE_MINUTES = 12

/** Snímek starší než tohle považujeme za neaktuální. */
const SNAPSHOT_MAX_AGE_MS = 36 * 60 * 60 * 1000

/** Kolik notifikací se zvukem smí za den odejít. */
const DAILY_BUDGET = 4

/** Kolik dní po sobě musí být slot ignorovaný, než se ztlumí. */
const IGNORE_LIMIT = 3

/** Na kolik dní se ztlumí. */
const MUTE_DAYS = 2

interface Slot {
  id: string
  minutes: number
  /** Nižší číslo = důležitější. Při přetečení rozpočtu vypadne to s vyšším. */
  priority: number
  /** Tiché notifikace se do denního rozpočtu nepočítají. */
  silent?: boolean
  build: () => (Message & { url: string; tag: string }) | null
}

function freshSnapshot(snapshot: StateSnapshot | null, today: string): StateSnapshot | null {
  if (!snapshot) return null
  if (snapshot.date !== today) return null
  if (Date.now() - Date.parse(snapshot.updatedAt) > SNAPSHOT_MAX_AGE_MS) return null
  return snapshot
}

/* ------------------------------------------------------------------ */
/*  Ztlumení opakovaně ignorovaných slotů                              */
/* ------------------------------------------------------------------ */

/**
 * Slot je „ignorovaný“, když jsme ten den připomínku poslali a příslušná
 * aktivita přesto zůstala nesplněná. Historie chodí ve snímku z appky.
 */
function isMuted(db: Database, slotId: string, today: string, snapshot: StateSnapshot | null): boolean {
  const until = db.muted[slotId]
  if (until && today < until) return true
  if (until && today >= until) {
    delete db.muted[slotId]
    markDirty()
  }
  if (!snapshot?.history?.length) return false

  const blockIndex = /^block-(\d)$/.exec(slotId)
  const days = snapshot.history.filter((d) => d.date !== today).slice(0, IGNORE_LIMIT)
  if (days.length < IGNORE_LIMIT) return false

  const ignored = days.every((day) => {
    // Musí to být opravdu doručená připomínka. Kdyby stačil jakýkoli záznam,
    // ztlumení by se samo obnovovalo donekonečna: dny, kdy jsme mlčeli,
    // by se počítaly jako další ignorované.
    if (!wasDelivered(`${day.date}|${slotId}`)) return false
    if (blockIndex) return !day.slots.includes(Number(blockIndex[1]))
    if (slotId === 'steps' || slotId === 'steps-last') return day.steps < day.target * 0.6
    return false
  })

  if (!ignored) return false

  db.muted[slotId] = addDays(today, MUTE_DAYS)
  markDirty()
  addLog('mute', `${slotId} ztlumen na ${MUTE_DAYS} dny – ${IGNORE_LIMIT}× bez reakce`)
  return true
}

/** Kolikrát už tenhle týden odešla „poslední výzva“. */
function lastCallsThisWeek(today: string): number {
  let count = 0
  for (let i = 0; i < 7; i++) {
    if (wasDelivered(`${addDays(today, -i)}|steps-last`)) count++
  }
  return count
}

/* ------------------------------------------------------------------ */
/*  Sestavení slotů                                                    */
/* ------------------------------------------------------------------ */

function buildSlots(
  schedule: ScheduleConfig,
  snapshot: StateSnapshot | null,
  weekday: number,
  today: string,
): Slot[] {
  const slots: Slot[] = []
  const seed = `${today}-`

  schedule.blockTimes.forEach((time, index) => {
    const minutes = parseClock(time)
    if (minutes === null) return
    slots.push({
      id: `block-${index}`,
      minutes,
      // Ráno a večer jsou nosné; polední blok vypadne první, když je plno.
      priority: index === 1 ? 5 : 3,
      build: () => {
        if (snapshot?.doneSlots?.includes(index)) return null
        // V pondělí ráno místo běžné hlášky přijde otevření nového týdne.
        const msg =
          index === 0 && weekday === 0
            ? mondayMessage(snapshot, `${seed}monday`)
            : blockMessage(index, snapshot, schedule.tone, `${seed}b${index}`)
        return { ...msg, url: `#/cviceni/${index}`, tag: `block-${index}` }
      },
    })
  })

  const stepMinutes = parseClock(schedule.stepCheckTime)
  if (stepMinutes !== null) {
    slots.push({
      id: 'steps',
      minutes: stepMinutes,
      priority: 1,
      build: () => {
        if (!snapshot) return null
        // `stepsNeededToday` je zbytek na dnešek, denní porce je tedy
        // nachozeno + zbytek. Práh se počítá z porce, ne ze zbytku.
        const portion = snapshot.steps + snapshot.stepsNeededToday
        if (portion <= 0) return null
        if (snapshot.steps >= (portion * schedule.stepCheckThreshold) / 100) return null
        return { ...stepCheckMessage(snapshot, schedule.tone, `${seed}steps`), url: '#/kroky', tag: 'steps' }
      },
    })
  }

  // Poslední výzva. Schválně omezená na tři za týden – kdyby chodila každý
  // večer, je z ní za týden šum, který se odklikává bez čtení.
  slots.push({
    id: 'steps-last',
    minutes: 20 * 60 + 30,
    priority: 6,
    build: () => {
      if (!snapshot) return null
      const portion = snapshot.steps + snapshot.stepsNeededToday
      if (portion <= 0 || snapshot.steps >= portion * 0.85) return null
      if (lastCallsThisWeek(today) >= 3) return null
      return { ...lastCallMessage(snapshot, `${seed}last`), url: '#/kroky', tag: 'steps' }
    },
  })

  const eveningMinutes = parseClock(schedule.eveningReviewTime)
  if (eveningMinutes !== null) {
    slots.push({
      id: 'evening',
      minutes: eveningMinutes,
      priority: 7,
      silent: true,
      build: () => {
        if (!snapshot) return null
        return { ...eveningMessage(snapshot, schedule.tone, `${seed}eve`), url: '#/', tag: 'evening' }
      },
    })
  }

  // Sobota: nesplněné týdenní úkoly (posilovna apod.).
  if (weekday === 5 && snapshot && snapshot.openTasks.length > 0) {
    slots.push({
      id: 'tasks',
      minutes: 10 * 60,
      priority: 4,
      build: () => ({
        ...taskReminderMessage(snapshot.openTasks, `${seed}tasks`),
        url: '#/tyden',
        tag: 'tasks',
      }),
    })
  }

  // Neděle: připomínka měření a večerní vyúčtování týdne.
  if (weekday === 6) {
    slots.push({
      id: 'measure',
      minutes: 9 * 60,
      priority: 4,
      build: () => ({ ...measureMessage(`${seed}measure`), url: '#/pokrok', tag: 'measure' }),
    })

    const minutes = parseClock(schedule.weeklyReviewTime)
    if (minutes !== null) {
      slots.push({
        id: 'weekly',
        minutes,
        priority: 2,
        build: () => ({
          ...weeklyMessage(snapshot, schedule.tone, `${seed}week`),
          url: '#/tyden',
          tag: 'weekly',
        }),
      })
    }
  }

  return slots
}

/** Kolik notifikací se zvukem už dnes doopravdy odešlo. */
function deliveredTodayCount(slots: Slot[], today: string): number {
  return slots.filter((slot) => !slot.silent && wasDelivered(`${today}|${slot.id}`)).length
}

/* ------------------------------------------------------------------ */
/*  Tik                                                                */
/* ------------------------------------------------------------------ */

/** Běží právě tik? Pomalé odeslání push nesmí pustit dovnitř druhý. */
let ticking = false

export async function tick(now: Date = new Date()): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await runTick(now)
  } finally {
    ticking = false
  }
}

async function runTick(now: Date): Promise<void> {
  const db = getDb()
  const schedule = db.schedule
  if (!schedule.enabled || db.subscriptions.length === 0) return

  const zoned = zonedNow(schedule.timezone, now)
  if (inQuietHours(zoned.minutes, parseClock(schedule.quietFrom), parseClock(schedule.quietTo))) return

  const snapshot = freshSnapshot(db.snapshot, zoned.date)
  const slots = buildSlots(schedule, snapshot, zoned.weekday, zoned.date)

  // Připravit si, co je právě splatné, a seřadit podle důležitosti.
  const due = slots
    .filter((slot) => {
      if (wasSent(`${zoned.date}|${slot.id}`)) return false
      return zoned.minutes >= slot.minutes && zoned.minutes < slot.minutes + GRACE_MINUTES
    })
    .sort((a, b) => a.priority - b.priority)

  let budgetLeft = DAILY_BUDGET - deliveredTodayCount(slots, zoned.date)

  for (const slot of due) {
    const key = `${zoned.date}|${slot.id}`

    if (isMuted(db, slot.id, zoned.date, snapshot)) {
      markSent(key, false)
      continue
    }

    const message = slot.build()
    if (!message) {
      // Podmínka nesplněna (blok hotový, kroky nachozené) – označíme jako
      // vyřízené, ať se to za minutu nezkouší znovu.
      markSent(key, false)
      continue
    }

    if (!slot.silent && budgetLeft <= 0) {
      markSent(key, false)
      addLog('schedule', `${slot.id}: zahozeno, denní rozpočet vyčerpán`)
      continue
    }

    // Označit PŘED odesláním. Kdyby push trval dlouho a mezitím se stihl
    // spustit další tik, poslal by tutéž notifikaci znovu.
    markSent(key, true)

    const result = await sendToAll({
      title: message.title,
      body: message.body,
      url: message.url,
      tag: message.tag,
      renotify: true,
      silent: slot.silent,
      data: { slot: slot.id, date: zoned.date },
    })
    if (!slot.silent) budgetLeft--
    addLog('schedule', `${slot.id}: odesláno ${result.sent}, smazáno ${result.removed}, chyb ${result.failed}`)
  }

  persist()
}

let timer: NodeJS.Timeout | undefined

export function startScheduler(): void {
  if (timer) return
  const run = () => {
    tick().catch((err) => {
      console.error('[henry] plánovač spadl:', err)
      addLog('error', `plánovač: ${(err as Error).message}`)
    })
  }
  // Zarovnat na celou minutu, ať časy sedí.
  const msToNextMinute = 60_000 - (Date.now() % 60_000)
  setTimeout(() => {
    run()
    timer = setInterval(run, 60_000)
  }, msToNextMinute)
  console.log('[henry] plánovač běží')
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
