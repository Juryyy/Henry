/**
 * Texty notifikací.
 *
 * Pravidla, kterých se to drží:
 *  – tykání, krátké věty, vždy konkrétní číslo ze snímku stavu,
 *  – žádné motivační citáty a žádné salvy vykřičníků,
 *  – humor jen tam, kde zlehčuje neúspěch, nikdy na účet uživatele,
 *  – zakázaná slova: selhal, zklamal, zase, konečně, musíš.
 *
 * Výběr varianty je deterministický podle semínka `datum + slot`. Během dne
 * se tedy text nemění (ani po restartu serveru), ale zítra bude jiný.
 */

import type { ScheduleConfig, StateSnapshot } from './store.js'

export type Tone = ScheduleConfig['tone']

/* ------------------------------------------------------------------ */
/*  Pomocné                                                            */
/* ------------------------------------------------------------------ */

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

function pick<T>(items: readonly T[], seed: string): T {
  return items[hash(seed) % items.length] as T
}

const nf = new Intl.NumberFormat('cs-CZ')

export function formatNumber(n: number): string {
  return nf.format(Math.round(n))
}

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n))
  if (abs === 1) return one
  if (abs >= 2 && abs <= 4) return few
  return many
}

export interface Vars {
  /** Chybějící kroky. */
  X: number
  /** Minuty chůze (X / 100). */
  Y: number
  /** Nachozené kroky. */
  S: number
  /** Denní porce kroků. */
  P: number
  /** Hotové bloky. */
  B: number
  /** Celkem bloků denně. */
  BT: number
  /** Série ve dnech. */
  N: number
  /** Dluh. */
  D: number
  /** Zbývá do splnění týdne. */
  T: number
  /** Nesplněné týdenní úkoly. */
  tasks: string
}

function varsFrom(snapshot: StateSnapshot | null): Vars {
  const s = snapshot
  const missing = Math.max(0, (s?.stepsNeededToday ?? 0) - (s?.steps ?? 0))
  return {
    X: missing,
    Y: Math.max(1, Math.round(missing / 100)),
    S: s?.steps ?? 0,
    P: s?.stepsNeededToday ?? 0,
    B: s?.blocksDone ?? 0,
    BT: s?.blocksTarget ?? 3,
    N: s?.streak ?? 0,
    D: s?.stepDebt ?? 0,
    T: s?.stepsRemainingThisWeek ?? 0,
    tasks: (s?.openTasks ?? []).slice(0, 3).join(', '),
  }
}

/** Nahradí `{X}` a spol. konkrétními čísly. Čísla se formátují česky. */
function render(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const value = (vars as unknown as Record<string, unknown>)[key]
    if (typeof value === 'number') return formatNumber(value)
    return String(value ?? '')
  })
}

/* ------------------------------------------------------------------ */
/*  Texty                                                              */
/* ------------------------------------------------------------------ */

const MORNING = [
  'Ranní patnáctka. Kočka-velbloud, mrtvý brouk, pár rozpažení.',
  'Dobré ráno. Patnáct minut, než tě sundá židle.',
  'Rozjezd dne. Rychlejší než projít si zprávy a míň deprimující.',
  'Start. I pět minut se počítá – nula se nepočítá.',
  'Páteř po noci nic neprosí, ale poděkuje.',
] as const

const NOON = [
  'Polední core. Prkno se samo nezacvičí.',
  'Mrtvý brouk, hýžďový most, prkno. Tři cviky, hotovo.',
  'Patnáct minut na střed těla. Záda ti to vrátí v pátek.',
  'Pauza od monitoru. Střed těla ji ocení víc než druhá káva.',
] as const

const EVENING_BLOCK = [
  'Večerní protahování. Dneska o centimetr blíž k zemi.',
  'Zadní stehna. Ta tvoje. Každý protah drž 45 sekund.',
  'Poslední blok dne. Po sprše to jde nejlíp.',
  'Protáhnout a máš čistý den. Patnáct minut.',
  'Cesta na podlahu vede přes tohle. Zatím jsi ve fázi „koleno“.',
] as const

const STEPS_AFTERNOON = [
  'Chybí {X} kroků, zhruba {Y} minut svižné chůze. Vejde se to.',
  '{X} kroků do dnešní čáry. Jedno kolo kolem baráku a je to.',
  'Vystup o zastávku dřív a máš půlku z {X} kroků.',
  'Zavolej někomu a choď u toho. {Y} minut a je vymalováno.',
  'Dnešní porce {P}, máš {S}. Nic dramatického.',
  'Lednice není trénink. {X} kroků, {Y} minut.',
  '{X} kroků. To je jedna epizoda seriálu, jen ve svislé poloze.',
  'Venku je to stejné jako včera, a včera to šlo. {Y} minut.',
  'Nákup pěšky místo autem pokryje skoro celých {X}.',
] as const

const STEPS_LAST_CALL = [
  'Poslední výzva: {X} kroků. I polovina se počítá.',
  '{X} do čáry. Co nedáš, se rozpustí do zbytku týdne – konec světa to není.',
] as const

const EVENING_CLEAN = [
  'Čistý den. {S} kroků, {B}/{BT} bloky, {N}. den v řadě.',
  'Hotovo. Dnešek patří mezi ty dobré.',
  'Splněno bez řečí. Zbytek večera je tvůj.',
] as const

const EVENING_PARTIAL = [
  'Dneska {S} z {P}. Chybí {X} a rozpustí se do zbytku týdne. Žádná tragédie.',
  'Bloky {B}/{BT}. Jeden je pořád lepší než nula.',
  'Nedotažené. Týden se počítá celý, ne po dnech – nic se nehroutí.',
  'Zapsáno. Zítra je normální den, ne trest za dnešek.',
] as const

const WEEK_CLOSE_OK = [
  'Týden zavřený. Dluh nula. Od pondělí čistý štít.',
  'Splněno s přebytkem. Něco ti nechávám jako kredit na horší týden.',
  'Hotovo. Tohle je milník, ne samozřejmost.',
] as const

const WEEK_CLOSE_DEBT = [
  'Zbývá {T} kroků. Co nedáš, rozpočítám do příštího týdne – ale jen do stropu.',
  'Do splnění týdne chybí {T}. Zbytek se odpustí, tak z toho nedělej vědu.',
  '{T} kroků do konce neděle, to je {Y} minut chůze rozložených přes den.',
] as const

const MONDAY_START = [
  'Nový týden. Denní porce {P}. Kdy jdeš do posilovny?',
  'Pondělí. Na začátek něčeho je to statisticky nejlepší den v roce, hned po Novém roce.',
  'Čerstvý týden, denní porce {P}. Nic z minulého týdne tě netahá dolů víc než musí.',
] as const

const TASKS = [
  'Zbývá: {tasks}. Víkend je poslední šance.',
  'Posilovna tenhle týden ještě nebyla. Sobota dopoledne bývá nejprázdnější.',
  'Otevřené úkoly: {tasks}. Naplánuj si to na dnešek.',
] as const

const MEASURE = [
  'Nedělní měření: váha, pas, dosah k zemi, prkno. Dvě minuty.',
  'Změř dosah k zemi. Měř vždycky ve stejnou dobu, ráno je to o pár centimetrů horší.',
  'Prkno na čas. Stačí o tři sekundy víc než minule.',
] as const

/* ------------------------------------------------------------------ */
/*  Titulky                                                            */
/* ------------------------------------------------------------------ */

const BLOCK_TITLES: Record<number, Record<Tone, readonly string[]>> = {
  0: {
    kind: ['Ranní rozhýbání', 'Dobré ráno', '15 minut pro sebe'],
    coach: ['Ranní blok. 15 minut.', 'Rozhýbat páteř', 'První blok dne'],
    drsny: ['Vstávej a cvič', 'Ranní blok. Bez řečí.', '15 minut. Teď.'],
  },
  1: {
    kind: ['Polední blok', 'Pauza na core', 'Čas na střed těla'],
    coach: ['Polední blok – core', 'Prkno volá', 'Druhý blok dne'],
    drsny: ['Core. Teď.', 'Prkno se samo nezacvičí', 'Druhý blok. Dělej.'],
  },
  2: {
    kind: ['Večerní protažení', 'Zklidnit a protáhnout', 'Poslední blok dne'],
    coach: ['Večerní protažení', 'Zadní stehna. Ta tvoje.', 'Třetí blok – protahování'],
    drsny: ['Protáhnout. Ne zítra.', 'Stehna. Dělej.', 'Poslední blok.'],
  },
}

const BLOCK_BODIES: Record<number, readonly string[]> = {
  0: MORNING,
  1: NOON,
  2: EVENING_BLOCK,
}

export interface Message {
  title: string
  body: string
}

/* ------------------------------------------------------------------ */
/*  Skládání zpráv                                                     */
/* ------------------------------------------------------------------ */

export function blockMessage(
  slot: number,
  snapshot: StateSnapshot | null,
  tone: Tone,
  seed: string,
): Message {
  const vars = varsFrom(snapshot)
  const titles = BLOCK_TITLES[slot] ?? BLOCK_TITLES[1]
  return {
    title: pick(titles[tone] ?? titles.coach, `${seed}t`),
    body: render(pick(BLOCK_BODIES[slot] ?? BLOCK_BODIES[1], `${seed}b`), vars),
  }
}

export function stepCheckMessage(snapshot: StateSnapshot, tone: Tone, seed: string): Message {
  const vars = varsFrom(snapshot)
  const titles: Record<Tone, readonly string[]> = {
    kind: [`Chybí ti ${formatNumber(vars.X)} ${plural(vars.X, 'krok', 'kroky', 'kroků')}`, 'Ještě je čas'],
    coach: [`${formatNumber(vars.X)} ${plural(vars.X, 'krok', 'kroky', 'kroků')} do cíle`, 'Zbývá dochodit'],
    drsny: [`Dlužíš ${formatNumber(vars.X)} ${plural(vars.X, 'krok', 'kroky', 'kroků')}`, 'Ta procházka se sama nedojde'],
  }
  let body = render(pick(STEPS_AFTERNOON, seed), vars)
  if (vars.D > 0) body += ` (Z minulého týdne visí ${formatNumber(vars.D)}, tak to nenafukuj.)`
  return { title: pick(titles[tone] ?? titles.coach, `${seed}t`), body }
}

export function lastCallMessage(snapshot: StateSnapshot, seed: string): Message {
  const vars = varsFrom(snapshot)
  return {
    title: `Poslední výzva: ${formatNumber(vars.X)} ${plural(vars.X, 'krok', 'kroky', 'kroků')}`,
    body: render(pick(STEPS_LAST_CALL, seed), vars),
  }
}

export function eveningMessage(snapshot: StateSnapshot, tone: Tone, seed: string): Message {
  const vars = varsFrom(snapshot)
  const stepsOk = snapshot.steps >= snapshot.stepTarget
  const blocksOk = snapshot.blocksDone >= snapshot.blocksTarget

  if (stepsOk && blocksOk) {
    return {
      title: pick(['Čistý den', 'Všechno splněno', 'Tohle byl dobrý den'], seed),
      body: render(pick(EVENING_CLEAN, `${seed}b`), vars),
    }
  }

  const titles: Record<Tone, readonly string[]> = {
    kind: ['Zápis dne', 'Jak to dneska šlo', 'Než půjdeš spát'],
    coach: ['Účet za dnešek', 'Shrnutí dne', 'Zbývá dozapsat'],
    drsny: ['Dneska to nestačilo', 'Účet za dnešek', 'Zůstal dluh'],
  }
  return {
    title: pick(titles[tone] ?? titles.coach, `${seed}t`),
    body: render(pick(EVENING_PARTIAL, `${seed}b`), vars),
  }
}

export function weeklyMessage(snapshot: StateSnapshot | null, _tone: Tone, seed: string): Message {
  const vars = varsFrom(snapshot)
  if (vars.T <= 0) {
    return { title: 'Týden zavřený v plusu', body: pick(WEEK_CLOSE_OK, seed) }
  }
  return {
    title: `Zbývá ${formatNumber(vars.T)} ${plural(vars.T, 'krok', 'kroky', 'kroků')}`,
    body: render(pick(WEEK_CLOSE_DEBT, seed), { ...vars, Y: Math.max(1, Math.round(vars.T / 100)) }),
  }
}

export function mondayMessage(snapshot: StateSnapshot | null, seed: string): Message {
  const vars = varsFrom(snapshot)
  return {
    title: 'Nový týden',
    body: render(pick(MONDAY_START, seed), vars),
  }
}

export function taskReminderMessage(openTasks: string[], seed: string): Message {
  const vars = { ...varsFrom(null), tasks: openTasks.slice(0, 3).join(', ') }
  return {
    title: `Zbývají týdenní úkoly (${openTasks.length})`,
    body: render(pick(TASKS, seed), vars),
  }
}

export function measureMessage(seed: string): Message {
  return { title: 'Nedělní měření', body: pick(MEASURE, seed) }
}
