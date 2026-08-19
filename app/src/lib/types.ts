import type { DateKey, WeekKey } from './date'

/* ------------------------------------------------------------------ */
/*  Katalog cviků                                                      */
/* ------------------------------------------------------------------ */

export type ExerciseCategory = 'core' | 'stretch' | 'mobility' | 'strength' | 'cardio'

/** Jak se cvik dávkuje – ovlivňuje UI přehrávače i zápis do logu. */
export type ExerciseMode = 'reps' | 'time' | 'time_per_side'

/**
 * Svalové skupiny, které umí ukázat mapa těla.
 *
 * Není to anatomický atlas – je to tolik skupin, kolik jich jde na obrázku
 * velikosti dlaně od sebe rozeznat. Hlubší věci (multifidy, rotátory kyčle)
 * spadají pod tu skupinu, pod kterou leží, a přesnost zůstává v textu u cviku.
 *
 * `srdce` sval není. Je tam proto, že u kardia je poctivější říct „tohle je
 * na oběh" než vybarvit náhodné svaly na nohou.
 */
export type MuscleId =
  | 'ramena'
  | 'prsa'
  | 'biceps'
  | 'triceps'
  | 'brisni'
  | 'sikme'
  | 'hluboky-stred'
  | 'ohybace-kycle'
  | 'kvadriceps'
  | 'adduktory'
  | 'mezilopatkove'
  | 'siroky-zadovy'
  | 'vzprimovace'
  | 'patere'
  | 'hyzde'
  | 'hamstringy'
  | 'lytka'
  | 'srdce'

/** Co cvik zatěžuje. `primary` je to, kvůli čemu se dělá. */
export interface Muscles {
  primary: MuscleId[]
  secondary: MuscleId[]
}

export interface Exercise {
  id: string
  name: string
  nameEn: string
  category: ExerciseCategory
  /** Na co to je – zobrazuje se jako podtitulek. */
  target: string
  /** 1 = úplný začátek, 2 = středně, 3 = pokročilé. */
  level: 1 | 2 | 3
  mode: ExerciseMode
  /** Doporučený počet sérií pro střední úroveň. */
  sets: number
  /** Opakování v sérii, nebo sekundy výdrže (u `time_per_side` na jednu stranu). */
  dose: number
  /** Pauza mezi sériemi v sekundách. */
  restSeconds: number
  instructions: string[]
  cues: string[]
  easier: string
  harder: string
  warning?: string
  /** Značky pro sestavování plánu: 'hamstrings', 'hips', 'anti-extension', … */
  tags: string[]
  /** Které svaly to zatěžuje – kreslí se z toho mapa těla u cviku. */
  muscles: Muscles
}

/* ------------------------------------------------------------------ */
/*  Plán cvičení                                                       */
/* ------------------------------------------------------------------ */

/** Jeden ze tří denních bloků. */
export type BlockSlot = 0 | 1 | 2

export interface PlanItem {
  exerciseId: string
  /** Počet sérií. */
  sets: number
  /** Opakování nebo sekundy podle `Exercise.mode`. */
  dose: number
  /** Odhad délky položky v sekundách včetně pauz. */
  seconds: number
}

export interface BlockPlan {
  slot: BlockSlot
  /** 'Ráno – rozhýbání', 'Poledne – core', 'Večer – protažení' */
  title: string
  subtitle: string
  /** Stabilní id plánu (datum + slot + verze katalogu) kvůli logu. */
  id: string
  items: PlanItem[]
  totalSeconds: number
}

/* ------------------------------------------------------------------ */
/*  Denní záznam                                                       */
/* ------------------------------------------------------------------ */

export type StepSource = 'manual' | 'shortcut' | 'import' | 'estimate'

export interface BlockLog {
  slot: BlockSlot
  planId: string
  /** ISO timestamp dokončení. Chybí = neodcvičeno. */
  completedAt?: string
  /** Reálně strávený čas v sekundách. */
  durationSec?: number
  /** Id cviků, které uživatel odškrtl. */
  doneExerciseIds: string[]
  /** Přeskočené cviky (aby šlo poznat rozdíl mezi „nedodělal“ a „přeskočil schválně“). */
  skippedExerciseIds: string[]
}

export interface DayLog {
  date: DateKey
  steps: number
  stepsSource: StepSource
  /** Kdy naposledy dorazila data o krocích (ISO). */
  stepsUpdatedAt?: string
  blocks: BlockLog[]
  note?: string
  /** Den označený jako volno – nezapočítává se do dluhu. */
  restDay?: boolean
}

/* ------------------------------------------------------------------ */
/*  Týdenní úkoly                                                      */
/* ------------------------------------------------------------------ */

export interface WeeklyTask {
  id: string
  title: string
  /** Kolikrát za týden. */
  target: number
  emoji: string
  active: boolean
  /** Nesplněné se přenáší do dalšího týdne. */
  rollover: boolean
  note?: string
  /**
   * Pořadí v seznamu. Vlastní číslo, ne pozice v poli: synchronizace vydává
   * záznamy po jednom a v libovolném pořadí, takže bez tohohle by se seznam
   * na druhém zařízení zamíchal.
   */
  order: number
}

export interface WeeklyTaskLog {
  week: WeekKey
  taskId: string
  /** Datumy, kdy byl úkol splněn. */
  dates: DateKey[]
  /** Kolik kusů se přeneslo z minulého týdne (dluh). */
  carried: number
}

/* ------------------------------------------------------------------ */
/*  Míry a pokrok                                                      */
/* ------------------------------------------------------------------ */

export interface Measurement {
  date: DateKey
  weightKg?: number
  waistCm?: number
  /**
   * Předklon: vzdálenost konečků prstů od země v cm.
   * Kladné číslo = ještě mi chybí tolik cm na zem, záporné = dosáhnu pod úroveň chodidel.
   */
  toeTouchCm?: number
  plankSec?: number
  note?: string
}

/* ------------------------------------------------------------------ */
/*  Dluhová kniha                                                      */
/* ------------------------------------------------------------------ */

export type LedgerKind = 'steps' | 'blocks'

export interface LedgerEntry {
  /** Týden, který se uzavíral. */
  week: WeekKey
  kind: LedgerKind
  /** Základní týdenní cíl v době uzávěrky (bez dluhu a kreditu). */
  base: number
  /** Dluh, který do týdne vstupoval. */
  debtIn: number
  /** Kredit, který do týdne vstupoval. */
  creditIn: number
  /** Kolik se mělo udělat (cíl + dluh z minula − kredit). */
  required: number
  /** Kolik se udělalo. */
  achieved: number
  /** Dluh, který jde do dalšího týdne (už po zastropování). */
  debt: number
  /** Dluh před zastropováním – kvůli poctivé statistice. */
  rawDebt: number
  /** Kredit (přebytek) do dalšího týdne. */
  credit: number
  /** Kolik dluhu smazal strop. */
  forgiven: number
  closedAt: string
  /** Týden bez jediného záznamu – neúčtoval se jako selhání. */
  skipped?: boolean
  /** Nový týdenní cíl, pokud se po tomhle týdnu zvedla laťka. */
  raisedTargetTo?: number
  /** Cíl před zvýšením – bez něj by se zvýšení nedalo vzít zpět. */
  raisedTargetFrom?: number
}

export interface Bankruptcy {
  date: DateKey
  kind: LedgerKind | 'all'
  clearedDebt: number
  reason?: string
}

/* ------------------------------------------------------------------ */
/*  Nastavení                                                          */
/* ------------------------------------------------------------------ */

export interface StepSettings {
  /** Aktuální týdenní cíl kroků. */
  weeklyTarget: number
  /** Cílová meta, ke které se postupně šplhá (7 000 kroků/den = 49 000/týden). */
  goalWeeklyTarget: number
  /** Automaticky zvyšovat cíl po splněném týdnu. */
  rampEnabled: boolean
  /** O kolik kroků týdně se cíl zvedne (≈ +500 kroků/den = +3 500/týden). */
  rampStep: number
  /** Rozložení cíle na dny (Po..Ne), v procentech; součet = 100. */
  distribution: number[]
  /** Strop dluhu jako násobek průměrného denního cíle. */
  debtCapDays: number
  /** Přenášet i přebytek jako kredit. */
  carrySurplus: boolean
  /** Strop kreditu jako násobek průměrného denního cíle. */
  creditCapDays: number
}

/**
 * Čím se blok zabývá. Určuje, z jakých cviků se skládá – název a ikonu si
 * uživatel volí zvlášť, takže „Ráno" může klidně obsahovat kardio.
 */
export type BlockFocus = 'rozhybani' | 'core' | 'protazeni' | 'kardio'

export interface BlockConfig {
  /**
   * Pozice v dni. Nemění se ani při přejmenování – visí na ní záznamy
   * odcvičených bloků, časy notifikací i odkazy z nich.
   */
  slot: BlockSlot
  /** Vypnutý blok se neplánuje, nepřipomíná a nepočítá do dluhu. */
  enabled: boolean
  title: string
  emoji: string
  focus: BlockFocus
  /** Délka bloku v minutách. Každý může být jinak dlouhý. */
  minutes: number
}

export interface ExerciseSettings {
  /** Tři pozice v dni. Kolik se jich cvičí, rozhoduje `enabled`. */
  blocks: BlockConfig[]
  /** Obtížnost katalogu. */
  level: 1 | 2 | 3
  /** Kolik nesplněných bloků se maximálně přenese do dalšího týdne. */
  debtCapBlocks: number
  /** Kolik dní v týdnu smí být „volno“ bez postihu. */
  graceDaysPerWeek: number
  /** Cviky, které uživatel vyřadil (bolest, nechce je). */
  excludedExerciseIds: string[]
}

export interface NotificationSettings {
  enabled: boolean
  /** Časy připomínek jednotlivých bloků 'HH:MM'. */
  blockTimes: string[]
  /** Odpolední kontrola kroků. */
  stepCheckTime: string
  /** Práh v procentech denního cíle, pod kterým odpoledne přijde šťouchnutí. */
  stepCheckThreshold: number
  /** Večerní shrnutí dne. */
  eveningReviewTime: string
  /** Nedělní vyúčtování týdne. */
  weeklyReviewTime: string
  /** Ticho – od / do (např. 22:00–07:00). */
  quietFrom: string
  quietTo: string
  /** Tón hlášek. */
  tone: 'kind' | 'coach' | 'drsny'
}

export interface Settings {
  name: string
  timezone: string
  steps: StepSettings
  exercise: ExerciseSettings
  notifications: NotificationSettings
  /** Kdy uživatel dokončil úvodní průvodce. */
  onboardedAt?: string
  /** Datum, od kterého se počítá historie (dřívější dny se ignorují). */
  startDate: DateKey
}

/* ------------------------------------------------------------------ */
/*  Kořenový stav aplikace                                             */
/* ------------------------------------------------------------------ */

/**
 * Doprovodná data pro synchronizaci. Časy změn žijí schválně stranou, aby
 * se `DayLog`, `Measurement` a spol. nezaplevelily technickými poli, která
 * s cvičením nemají nic společného.
 */
export interface SyncMeta {
  /** `kind:id` -> ISO čas poslední změny na tomhle zařízení. */
  updatedAt: Record<string, string>
  /** `kind:id` -> ISO čas smazání. Náhrobek, aby jiné zařízení záznam nevzkřísilo. */
  deleted: Record<string, string>
  /** Poslední revize serveru, kterou tohle zařízení vidělo. */
  rev?: number
  /** Kdy se naposledy nahrávalo – co je novější, jde na server znovu. */
  pushedAt?: string
  /** Kdy naposledy proběhla celá synchronizace (pro UI). */
  syncedAt?: string
}

export interface AppState {
  schemaVersion: number
  settings: Settings
  days: Record<DateKey, DayLog>
  weeklyTasks: WeeklyTask[]
  weeklyTaskLogs: Record<string, WeeklyTaskLog> // klíč `${week}|${taskId}`
  measurements: Measurement[]
  ledger: LedgerEntry[]
  bankruptcies: Bankruptcy[]
  /** Poslední týden, který už byl uzavřen do dluhové knihy. */
  lastClosedWeek?: WeekKey
  /** Odznaky / milníky, které si uživatel odemkl. */
  achievements: Record<string, string> // id -> ISO datum odemčení
  /** Časy změn a náhrobky pro synchronizaci mezi zařízeními. */
  meta: SyncMeta
}
