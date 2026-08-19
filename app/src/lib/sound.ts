/**
 * Zvukové signály při cvičení.
 *
 * Proč se tóny počítají a neposílají jako soubory: appka má fungovat offline
 * a vejít se do precache service workeru. Pípnutí z oscilátoru váží nula
 * bajtů, zní na všem stejně a nemusí se pro něj řešit licence. Nahrávky by
 * byly hezčí, ale za pár set kilobajtů a stažení navíc to nestojí.
 *
 * Melodie nesou význam, ne jen „něco se stalo“:
 *   – odpočet stoupá po tichých ťuknutích, takže je slyšet, že se blíží konec,
 *   – konec série klesá (můžeš povolit),
 *   – konec pauzy stoupá (jedeme dál),
 *   – konec bloku je trojzvuk, aby se nepletl s ničím uprostřed.
 * Kdo poslouchá na pozadí u vaření, pozná podle směru melodie, co se děje,
 * aniž by se šel podívat na displej.
 */

type Ctor = typeof AudioContext

let ctx: AudioContext | null = null

/** Prohlížeč ještě nedávno chtěl prefix, a stará Safari ho chce dodnes. */
function audioCtor(): Ctor | null {
  // Bez prohlížeče (testy, vykreslení na serveru) není co spouštět.
  if (typeof window === 'undefined') return null
  const w = window as Window & { webkitAudioContext?: Ctor }
  return window.AudioContext ?? w.webkitAudioContext ?? null
}

/**
 * Nastartuje zvuk. **Musí se zavolat z obsluhy klepnutí** – prohlížeče
 * nedovolí přehrát zvuk, který si uživatel nevyžádal, a kontext by zůstal
 * uspaný. Volá se z hlavního tlačítka přehrávače, tedy z prvního doteku,
 * kterým cvičení začíná.
 */
export function unlockSound(): void {
  try {
    const Ctx = audioCtor()
    if (!Ctx) return
    ctx ??= new Ctx()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    // Bez zvuku se cvičit dá. Vibrace i obrazovka fungují dál.
  }
}

/** Jeden tón. `at` je posun od teď v sekundách, aby šly skládat melodie. */
function tone(hz: number, at: number, seconds: number, volume: number): void {
  if (!ctx) return
  const start = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  // Trojúhelník místo sinu: je o něco slyšitelnější přes puštěnou hudbu,
  // a přitom nedrnčí jako obdélník.
  osc.type = 'triangle'
  osc.frequency.value = hz
  // Náběh a doznění schválně, ne skok: ostrá hrana v signálu lupne.
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds)
  osc.connect(gain).connect(ctx.destination)
  osc.start(start)
  osc.stop(start + seconds + 0.02)
}

/** Co se má ozvat. */
export type Cue =
  /** Poslední vteřiny odpočtu – tiché ťuknutí. */
  | 'odpocet'
  /** Konec série nebo výdrže. */
  | 'konec'
  /** Konec pauzy, jde se cvičit. */
  | 'start'
  /** Blok je hotový. */
  | 'hotovo'

const MELODIES: Record<Cue, [hz: number, at: number, len: number, vol: number][]> = {
  odpocet: [[740, 0, 0.07, 0.1]],
  konec: [
    [740, 0, 0.13, 0.16],
    [494, 0.12, 0.22, 0.16],
  ],
  start: [
    [587, 0, 0.11, 0.16],
    [880, 0.1, 0.2, 0.16],
  ],
  hotovo: [
    [523, 0, 0.14, 0.16],
    [659, 0.13, 0.14, 0.16],
    [784, 0.26, 0.34, 0.18],
  ],
}

/**
 * Přehraje signál. Když zvuk nejde nebo ho uživatel vypnul, tiše se nic
 * nestane – cvičení nesmí spadnout kvůli pípnutí.
 */
export function playCue(cue: Cue, enabled = true): void {
  if (!enabled) return
  try {
    unlockSound()
    if (!ctx || ctx.state !== 'running') return
    for (const [hz, at, len, vol] of MELODIES[cue]) tone(hz, at, len, vol)
  } catch {
    // Nevadí.
  }
}

/** Jen pro testy – ať se nedědí kontext mezi případy. */
export function resetSound(): void {
  const old = ctx
  // Nejdřív zapomenout, pak zavírat: kdyby zavírání selhalo, nesmí tu zůstat
  // viset kontext, který už nikdo nepoužije.
  ctx = null
  try {
    void old?.close()
  } catch {
    // Nevadí.
  }
}
