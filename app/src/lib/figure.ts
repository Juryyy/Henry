/**
 * Postavička, která cvik předvede.
 *
 * Proč ne fotky nebo gify: appka běží na tvém serveru a musí fungovat offline,
 * takže by se sada fotek musela vejít do precache service workeru a hlavně by
 * musela odněkud legálně pocházet. Kreslená postavička z pár čísel váží
 * jednotky kilobajtů pro **všech šestačtyřicet cviků**, škáluje se do libovolné
 * velikosti a v tmavém i světlém režimu vypadá stejně.
 *
 * Póza je prostě seznam kloubů v souřadnicích. Animace je přechod mezi dvěma
 * až třemi pózami tam a zpátky – přesně tak, jak vypadá jedno opakování.
 * Interpolace souřadnic (ne úhlů) je schválně: neumí to nesmyslnou polohu,
 * protože obě krajní pózy jsou nakreslené ručně a mezi nimi se jen počítá
 * průměr.
 */

/** Bod v plátně 100 × 100. `y` roste dolů, země je na 88. */
export type Point = [number, number]

export const GROUND_Y = 88

/**
 * Klouby jedné pózy. Vzdálená ruka a noha jsou nepovinné – kreslí se
 * slabší a dodávají hloubku tam, kde na tom záleží (pochod, jumping jacks).
 */
export interface Pose {
  head: Point
  neck: Point
  hip: Point
  elbow: Point
  hand: Point
  knee: Point
  ankle: Point
  toe: Point
  elbowFar?: Point
  handFar?: Point
  kneeFar?: Point
  ankleFar?: Point
  toeFar?: Point
  /**
   * Střed páteře. Trup se kreslí jako křivka s tímhle bodem jako řídicím,
   * takže jde ukázat kulatá i prohnutá záda – bez toho by kočka a velbloud
   * vypadaly stejně. Když chybí, dosadí se střed mezi krkem a kyčlí, což
   * dá přesně rovnou čáru.
   */
  mid?: Point
  /** Rekvizita: činka, popruh, tyč, zeď, stupínek. */
  prop?: Prop
}

/** Co je kolem postavičky. Bez toho by šlo těžko poznat cvik u zdi od cviku na zemi. */
export type Prop =
  | { kind: 'wall'; x: number }
  | { kind: 'box'; x: number; y: number; w: number }
  | { kind: 'bench'; y: number }
  | { kind: 'dumbbell'; at: 'hand' }
  | { kind: 'bar'; at: 'hand' }
  | { kind: 'strap'; from: 'hand'; to: 'ankle' }

export interface Figure {
  /** Dvě až tři pózy. Přechází se tam a zpátky. */
  frames: Pose[]
  /** Délka celého cyklu v milisekundách. Výchozí 2600. */
  durationMs?: number
  /** Popis pro čtečku obrazovky a pro případ, že se obrázek nevykreslí. */
  alt: string
}

/* ------------------------------------------------------------------ */
/*  Interpolace                                                        */
/* ------------------------------------------------------------------ */

/**
 * Pořadí pózí tam a zpátky. Dvě pózy dají 0→1→0, tři 0→1→2→1→0 – tedy
 * jedno opakování, ne skok zpátky na začátek.
 */
export function pingPong(count: number): number[] {
  if (count <= 1) return [0]
  const forward = Array.from({ length: count }, (_, i) => i)
  const back = forward.slice(1, -1).reverse()
  return [...forward, ...back]
}

/** Zrychlení a zpomalení na krajích – rovnoměrný pohyb vypadá strojově. */
function ease(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

const JOINTS = ['head', 'neck', 'hip', 'elbow', 'hand', 'knee', 'ankle', 'toe'] as const
const OPTIONAL_JOINTS = ['elbowFar', 'handFar', 'kneeFar', 'ankleFar', 'toeFar', 'mid'] as const

/** Řídicí bod trupu. Bez vlastního je to střed, tedy rovná záda. */
export function spineControl(pose: Pose): Point {
  return pose.mid ?? [(pose.neck[0] + pose.hip[0]) / 2, (pose.neck[1] + pose.hip[1]) / 2]
}

/**
 * Póza v daném okamžiku cyklu. `phase` je 0–1 přes celý cyklus.
 *
 * Rekvizita se nemíchá: přechod ze zdi na činku uprostřed pohybu nedává smysl,
 * takže platí ta z pózy, ze které se právě odchází.
 */
export function poseAt(frames: Pose[], phase: number): Pose {
  if (frames.length === 0) throw new Error('figura bez pózy')
  if (frames.length === 1) return frames[0]!

  const order = pingPong(frames.length)
  const scaled = (((phase % 1) + 1) % 1) * order.length
  const index = Math.min(order.length - 1, Math.floor(scaled))
  const from = frames[order[index]!]!
  const to = frames[order[(index + 1) % order.length]!]!
  const t = ease(scaled - index)

  const out = { prop: from.prop } as Pose
  for (const joint of JOINTS) {
    out[joint] = lerpPoint(from[joint], to[joint], t)
  }
  for (const joint of OPTIONAL_JOINTS) {
    // Páteř je zvláštní případ: chybějící řídicí bod znamená rovná záda,
    // ne „žádná páteř". Dopočítá se, jinak by se záda mezi pózami narovnala skokem.
    if (joint === 'mid') {
      if (from.mid || to.mid) out.mid = lerpPoint(spineControl(from), spineControl(to), t)
      continue
    }
    const a = from[joint]
    const b = to[joint]
    // Když končetinu má jen jedna z pózí, nechá se tam, kde je – jinak by
    // vyletěla z počátku souřadnic.
    if (a && b) out[joint] = lerpPoint(a, b, t)
    else if (a || b) out[joint] = a ?? b
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  Rámování                                                           */
/* ------------------------------------------------------------------ */

/** Poloměr hlavy. Musí se do výřezu vejít celá. */
const HEAD_R = 6
/** Volný prostor kolem postavičky. */
const PADDING = 5
/** Poměr stran obrázku. Na kartu se hodí ležatý. */
const ASPECT = 3 / 2

/**
 * Výřez plátna pro danou figuru.
 *
 * Bez tohohle by cvik vleže zabíral desetinu obrázku a stoj celý – ne proto,
 * že by byl důležitější, ale protože stojící člověk je vysoký a ležící placatý.
 * Výřez se proto počítá z dat: obalí všechny pózy, přidá zem a dorovná na
 * pevný poměr stran, aby všechny obrázky měly stejný tvar.
 */
export function fitView(frames: Pose[]): [number, number, number, number] {
  let minX = 100
  let maxX = 0
  let minY = 100
  let maxY = 0

  const include = (x: number, y: number, r = 0): void => {
    minX = Math.min(minX, x - r)
    maxX = Math.max(maxX, x + r)
    minY = Math.min(minY, y - r)
    maxY = Math.max(maxY, y + r)
  }

  for (const pose of frames) {
    include(pose.head[0], pose.head[1], HEAD_R)
    for (const joint of JOINTS) {
      if (joint === 'head') continue
      include(pose[joint][0], pose[joint][1])
    }
    for (const joint of OPTIONAL_JOINTS) {
      const point = pose[joint]
      if (point) include(point[0], point[1])
    }
    const prop = pose.prop
    if (prop?.kind === 'wall') include(prop.x, GROUND_Y)
    if (prop?.kind === 'box') {
      include(prop.x, prop.y)
      include(prop.x + prop.w, GROUND_Y)
    }
    if (prop?.kind === 'bench') include(18, prop.y)
  }

  // Zem patří do obrázku vždycky – bez ní není poznat, co je nahoře.
  maxY = Math.max(maxY, GROUND_Y)

  minX -= PADDING
  maxX += PADDING
  minY -= PADDING
  maxY += PADDING

  let width = maxX - minX
  let height = maxY - minY

  // Dorovnání na pevný poměr stran: dokreslí se prostor kolem, nikdy se
  // neořízne – jinak by stojícímu člověku zmizela hlava.
  if (width / height < ASPECT) {
    const target = height * ASPECT
    minX -= (target - width) / 2
    width = target
  } else {
    const target = width / ASPECT
    minY -= (target - height) / 2
    height = target
  }

  return [round(minX), round(minY), round(width), round(height)]
}

const round = (value: number): number => Math.round(value * 10) / 10

/* ------------------------------------------------------------------ */
/*  Společné hodiny                                                    */
/* ------------------------------------------------------------------ */

/**
 * Jeden `requestAnimationFrame` pro všechny postavičky na stránce. Kdyby si
 * každá točila vlastní smyčku, přehrávač bloku s pěti cviky by jich měl pět.
 */
type Tick = (nowMs: number) => void

const listeners = new Set<Tick>()
let raf = 0

function loop(now: number): void {
  for (const listener of listeners) listener(now)
  raf = listeners.size ? requestAnimationFrame(loop) : 0
}

export function subscribeClock(tick: Tick): () => void {
  listeners.add(tick)
  if (!raf) raf = requestAnimationFrame(loop)
  return () => {
    listeners.delete(tick)
    if (!listeners.size && raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
}

/** Jen pro testy – ať po doběhnutí nezůstane viset smyčka. */
export function clockListenerCount(): number {
  return listeners.size
}
