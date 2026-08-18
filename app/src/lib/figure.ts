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
   * Kterým **směrem** míří obličej – ne bod, ale vektor od středu hlavy.
   * Bez něj se nedá poznat leh na zádech od lehu na břiše: krk míří v obou
   * případech stejně.
   *
   * Schválně směr, ne cíl: základní polohy se dědí přes `...SUPINE` a hlava
   * se přitom posouvá. Cíl by se s ní rozešel a nos by ukazoval do prázdna,
   * kdežto směr platí dál. `[0, 0]` znamená pohled na diváka – nos se nekreslí.
   *
   * Délka má být zhruba jednotková: kratší vektor znamená „natočený spíš
   * k divákovi" a podle toho se rozloží objem trupu.
   */
  look?: Point
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
/**
 * Nepovinné **body na plátně**. `look` mezi ně nepatří: je to směr, ne bod –
 * a kdyby se do rámování dostal, výřez by se natáhl až k počátku souřadnic
 * a postavička by se scvrkla do rohu. (Přesně to se stalo.)
 */
const OPTIONAL_POINTS = ['elbowFar', 'handFar', 'kneeFar', 'ankleFar', 'toeFar', 'mid'] as const

/** Co se kromě kloubů dopočítává při přechodu mezi pózami. */
const INTERPOLATED = [...OPTIONAL_POINTS, 'look'] as const

/** Poloměr hlavy. Kreslí se s ním, a počítá se s ním i výřez. */
export const HEAD_R = 5.2
/** Jak daleko nos vyčnívá **za okraj** hlavy. */
const NOSE = 4.6
/** Jak hluboký je trup. Zhruba jako hlava – piktogram, ne anatomie. */
export const TORSO_DEPTH = 5

/**
 * Kam se postavička dívá. Chybějící směr se dopočítá prodloužením krku –
 * to sedí tam, kde krk vodorovný není (podpor, vzpor klečmo, předklon).
 * `[0, 0]` znamená čelem k divákovi.
 */
function lookVector(pose: Pose): Point {
  return pose.look ?? [pose.head[0] - pose.neck[0], pose.head[1] - pose.neck[1]]
}

/** Jednotkový vektor, nebo `null` když je moc krátký na to, aby něco znamenal. */
function unit(v: Point): Point | null {
  const length = Math.hypot(v[0], v[1])
  return length < 0.01 ? null : [v[0] / length, v[1] / length]
}

/**
 * Nos jako úsečka od okraje hlavy ven, nebo `null` u pohledu na diváka –
 * tam by z nosu byla jen skvrna uprostřed obličeje.
 *
 * Kreslí se od okraje, ne ze středu: čárka přes celou hlavu vypadá jako
 * škrtnutí, kdežto krátký hrot z obrysu je poznat i v seznamu na 60 pixelech.
 */
export function faceLine(pose: Pose): [Point, Point] | null {
  const dir = unit(lookVector(pose))
  if (!dir) return null
  const [x, y] = pose.head
  return [
    [x + dir[0] * (HEAD_R - 1), y + dir[1] * (HEAD_R - 1)],
    [x + dir[0] * (HEAD_R + NOSE), y + dir[1] * (HEAD_R + NOSE)],
  ]
}

/**
 * Kam od páteře sahá trup – hranice na obě strany, měřené podél kolmice
 * k páteři.
 *
 * Ze dvou kolmic se bere ta, která míří stejně jako pohled: obličej a břicho
 * jsou na stejné straně těla v každé poloze, ve stoji i v lehu. Objem těla se
 * pak celý přesune dopředu a páteř zůstane na jeho zadní hraně – a přesně
 * z toho je poznat, kde jsou záda.
 *
 * Jak moc se přesune, závisí na tom, jak je postavička natočená. Z profilu
 * naplno, čelem k divákovi vůbec (tam se rozloží souměrně – zepředu žádná
 * strana zad vidět není a tvrdit opak by bylo lež). Mezi tím plynule, aby se
 * trup při otočce nepřeklopil skokem: u sedu 90/90 se kolena překlápějí přes
 * střed, takže tudy postavička opravdu projde.
 *
 * `null` jen u pózy bez délky páteře, kde není co odsazovat.
 */
export function torsoEdges(pose: Pose): { lo: number; hi: number; normal: Point } | null {
  const spine = unit([pose.hip[0] - pose.neck[0], pose.hip[1] - pose.neck[1]])
  if (!spine) return null
  const normal: Point = [-spine[1], spine[0]]
  // Nezkrácený vektor schválně. Jeho délka nese to podstatné: čím kratší,
  // tím víc je postavička natočená k divákovi. Po zkrácení na jednotku by
  // z toho zbylo jen znaménko a trup by se při otočce překlopil skokem –
  // u sedu 90/90, kde se kolena překlápějí přes střed, by to bylo vidět.
  const look = lookVector(pose)
  const turn = normal[0] * look[0] + normal[1] * look[1]
  // Zesíleno: obličej se často dívá jinam než břicho (v lehu na břiše míří
  // hlava dopředu, ale břicho pořád dolů). Bez toho by z takové polohy vyšel
  // poloviční přesun, tedy nic. Přes střed to pořád projde plynule.
  const shift = Math.max(-1, Math.min(1, turn * 2.5))
  const center = (TORSO_DEPTH / 2) * shift
  return { lo: center - TORSO_DEPTH / 2, hi: center + TORSO_DEPTH / 2, normal }
}

/**
 * Konec nosu, nebo `null` u pohledu na diváka. Používá se hlavně na rámování –
 * kdyby se nos počítal jen při kreslení, u zakloněné hlavy by přečuhoval ven.
 */
export function faceTarget(pose: Pose): Point | null {
  return faceLine(pose)?.[1] ?? null
}

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
  for (const joint of INTERPOLATED) {
    // Páteř a pohled jsou zvláštní případy: když chybí, neznamená to „nic",
    // ale konkrétní výchozí hodnotu. Dopočítá se, jinak by se záda mezi
    // pózami narovnala skokem a hlava by se otočila trhnutím.
    if (joint === 'mid') {
      if (from.mid || to.mid) out.mid = lerpPoint(spineControl(from), spineControl(to), t)
      continue
    }
    if (joint === 'look') {
      // Směry se míchají přímo – jsou to vektory, ne body na plátně.
      const a = from.look ?? [from.head[0] - from.neck[0], from.head[1] - from.neck[1]]
      const b = to.look ?? [to.head[0] - to.neck[0], to.head[1] - to.neck[1]]
      out.look = lerpPoint(a, b, t)
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

/** Kolik místa si hlava ve výřezu ukousne. O chlup víc než poloměr, ať se
 *  neotírá o okraj. */
const HEAD_BOX = HEAD_R + 0.8
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
    include(pose.head[0], pose.head[1], HEAD_BOX)
    for (const joint of JOINTS) {
      if (joint === 'head') continue
      include(pose[joint][0], pose[joint][1])
    }
    for (const joint of OPTIONAL_POINTS) {
      const point = pose[joint]
      if (point) include(point[0], point[1])
    }
    const face = faceTarget(pose)
    if (face) include(face[0], face[1])
    // Trup je odsazený od páteře, takže leze z obalu ven – typicky u lehu
    // na zádech, kde míří vzhůru.
    const edges = torsoEdges(pose)
    if (edges) {
      const control = spineControl(pose)
      for (const depth of [edges.lo, edges.hi]) {
        const [bx, by] = [edges.normal[0] * depth, edges.normal[1] * depth]
        include(pose.neck[0] + bx, pose.neck[1] + by)
        include(pose.hip[0] + bx, pose.hip[1] + by)
        include(control[0] + bx, control[1] + by)
      }
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
