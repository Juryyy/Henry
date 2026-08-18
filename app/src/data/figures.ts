/**
 * Jak který cvik vypadá.
 *
 * Souřadnice jsou v plátně 100 × 100, země na 88, postavička se dívá doprava
 * (u cviků vleže a v podporu leží hlavou doleva – jinak by se do plátna
 * nevešla). Každý cvik má dvě až tři pózy a mezi nimi se plynule přechází:
 * první je výchozí, poslední je ta, kam se má člověk dostat. Ta poslední se
 * taky kreslí jako statický obrázek v seznamech.
 *
 * Není to anatomický atlas, je to piktogram. Cílem je, aby ses při čtení
 * instrukcí nemusel dohadovat, jestli se leží na zádech nebo na břiše a kam
 * míří kolena. Podrobnosti jsou v textu u cviku.
 *
 * Základní polohy níž se sdílejí – většina cviků je „tahle poloha, ale…".
 */

import type { Figure, Pose } from '@/lib/figure'

/* ------------------------------------------------------------------ */
/*  Základní polohy                                                    */
/* ------------------------------------------------------------------ */

/** Stoj, čelem doprava, ruce podél těla. */
const STAND: Pose = {
  // Čelem doprava, pohled vodorovně před sebe.
  look: [1, 0],
  head: [46, 13],
  neck: [46, 22],
  hip: [46, 51],
  elbow: [46, 36],
  hand: [46, 49],
  knee: [46, 69],
  ankle: [46, 86],
  toe: [53, 88],
}

/** Vleže na zádech, hlavou doleva, kolena pokrčená. */
const SUPINE: Pose = {
  // Na zádech: obličej míří ke stropu, ať se nepletl s lehem na břiše.
  look: [0, -1],
  head: [20, 79],
  neck: [28, 81],
  hip: [50, 82],
  elbow: [36, 86],
  hand: [46, 86],
  knee: [64, 70],
  ankle: [70, 85],
  toe: [77, 87],
}

/** Vleže na zádech s nataženýma nohama. */
const SUPINE_LONG: Pose = {
  ...SUPINE,
  knee: [66, 82],
  ankle: [80, 82],
  toe: [83, 75],
}

/** Vleže na břiše. */
const PRONE: Pose = {
  // Na břiše: hlava otočená dopředu a k zemi. Kolmo dolů to být nemůže –
  // nos by čouhal pod podlahu.
  look: [-1, 0.35],
  head: [20, 82],
  neck: [28, 84],
  hip: [52, 85],
  elbow: [34, 87],
  hand: [44, 87],
  knee: [66, 85],
  ankle: [78, 85],
  toe: [82, 88],
}

/** Vzpor klečmo („na čtyřech"), čelem doprava. */
const QUADRUPED: Pose = {
  look: [0.4, 1],
  head: [22, 60],
  neck: [30, 62],
  hip: [52, 62],
  elbow: [30, 74],
  hand: [30, 86],
  knee: [52, 74],
  ankle: [52, 86],
  toe: [58, 88],
  kneeFar: [52, 74],
  ankleFar: [52, 86],
  toeFar: [58, 88],
}

/** Prkno na předloktí, hlavou doleva. */
const PLANK: Pose = {
  // V prkně se člověk dívá do země kousek před sebe.
  look: [-0.6, 1],
  head: [20, 66],
  neck: [28, 69],
  hip: [54, 78],
  elbow: [28, 86],
  hand: [18, 86],
  knee: [68, 82],
  ankle: [80, 85],
  toe: [84, 88],
}

/** Sed s nataženýma nohama, trup vzpřímený. */
const SEATED: Pose = {
  look: [1, 0],
  head: [30, 51],
  neck: [30, 60],
  hip: [30, 84],
  elbow: [34, 70],
  hand: [40, 78],
  knee: [50, 84],
  ankle: [68, 84],
  toe: [72, 77],
}

/** Klek na jedné, druhá noha vepředu (výpad v kleku). */
const HALF_KNEEL: Pose = {
  look: [1, 0],
  head: [46, 30],
  neck: [46, 38],
  hip: [46, 62],
  elbow: [48, 48],
  hand: [52, 58],
  knee: [60, 70],
  ankle: [64, 86],
  toe: [70, 88],
  kneeFar: [36, 86],
  ankleFar: [26, 86],
  toeFar: [22, 88],
}

/** Předklon z kyčlí – pánev dozadu, záda rovná. */
const HINGE: Pose = {
  look: [0.8, 0.6],
  head: [68, 34],
  neck: [60, 39],
  hip: [40, 53],
  elbow: [62, 51],
  hand: [64, 62],
  knee: [40, 70],
  ankle: [42, 86],
  toe: [49, 88],
}

/** Hluboký předklon s kulatými zády. */
const FOLD: Pose = {
  look: [0.3, 1],
  head: [70, 62],
  neck: [62, 56],
  mid: [56, 42],
  hip: [42, 52],
  elbow: [68, 68],
  hand: [70, 80],
  knee: [44, 70],
  ankle: [44, 86],
  toe: [51, 88],
}

/** Dřep. */
const SQUAT: Pose = {
  look: [1, 0.2],
  head: [56, 33],
  neck: [52, 41],
  hip: [40, 66],
  elbow: [52, 52],
  hand: [54, 60],
  knee: [58, 68],
  ankle: [46, 86],
  toe: [53, 88],
}

/** Stoj čelem k divákovi – pro cviky, které z boku nejsou poznat. */
const FRONT: Pose = {
  // Čelem k divákovi – nos by byl jen skvrna, tak se nekreslí.
  look: [0, 0],
  head: [50, 13],
  neck: [50, 22],
  hip: [50, 51],
  elbow: [58, 34],
  hand: [61, 48],
  knee: [54, 69],
  ankle: [54, 86],
  toe: [54, 88],
  elbowFar: [42, 34],
  handFar: [39, 48],
  kneeFar: [46, 69],
  ankleFar: [46, 86],
  toeFar: [46, 88],
}

/* ------------------------------------------------------------------ */
/*  Cviky                                                              */
/* ------------------------------------------------------------------ */

export const FIGURES: Record<string, Figure> = {
  /* --- Core -------------------------------------------------------- */

  'branicni-dychani': {
    alt: 'Leh na zádech, kolena pokrčená, jedna dlaň na hrudníku a druhá na břiše. Při nádechu se zvedá jen břicho.',
    durationMs: 4200,
    frames: [
      { ...SUPINE, elbow: [34, 78], hand: [42, 82], mid: [39, 82] },
      { ...SUPINE, elbow: [34, 76], hand: [42, 79], mid: [39, 79] },
    ],
  },

  'mcgillova-zkracovacka': {
    alt: 'Leh na zádech, jedna noha pokrčená a druhá natažená, dlaně pod bederní páteří. Zvedá se jen hlava a ramena.',
    frames: [
      {
        ...SUPINE,
        elbow: [34, 84],
        hand: [44, 84],
        kneeFar: [66, 83],
        ankleFar: [80, 83],
        toeFar: [83, 76],
      },
      {
        ...SUPINE,
        look: [0.7, -0.7],
        head: [22, 71],
        neck: [30, 76],
        elbow: [34, 82],
        hand: [44, 84],
        kneeFar: [66, 83],
        ankleFar: [80, 83],
        toeFar: [83, 76],
      },
    ],
  },

  'mrtvy-brouk': {
    alt: 'Leh na zádech, kolena nad kyčlemi a ruce nad rameny. Střídavě se natahuje jedna paže za hlavu a protilehlá noha k zemi.',
    frames: [
      {
        ...SUPINE,
        elbow: [30, 72],
        hand: [32, 62],
        knee: [54, 68],
        ankle: [66, 66],
        toe: [72, 64],
        kneeFar: [54, 68],
        ankleFar: [66, 66],
        toeFar: [72, 64],
      },
      {
        ...SUPINE,
        elbow: [20, 74],
        hand: [10, 72],
        knee: [54, 68],
        ankle: [66, 66],
        toe: [72, 64],
        kneeFar: [66, 80],
        ankleFar: [80, 81],
        toeFar: [84, 76],
      },
    ],
  },

  'ptaci-pes': {
    alt: 'Vzpor klečmo. Natahuje se jedna paže dopředu a protilehlá noha dozadu do jedné přímky s trupem.',
    frames: [
      QUADRUPED,
      {
        ...QUADRUPED,
        elbow: [22, 58],
        hand: [12, 55],
        kneeFar: [66, 68],
        ankleFar: [80, 64],
        toeFar: [85, 62],
      },
    ],
  },

  'kocka-velbloud': {
    alt: 'Vzpor klečmo. Záda se střídavě vyhrbí do kulata a prohnou dolů.',
    durationMs: 3800,
    frames: [
      { ...QUADRUPED, mid: [41, 52], head: [23, 70], neck: [30, 64] },
      { ...QUADRUPED, mid: [41, 72], head: [21, 54], neck: [30, 60] },
    ],
  },

  'prkno-na-kolenou': {
    alt: 'Podpor na předloktích s koleny na zemi. Tělo od kolen po hlavu drží přímku.',
    frames: [
      { ...PLANK, hip: [54, 84], knee: [66, 86], ankle: [78, 84], toe: [82, 88], head: [22, 72], neck: [30, 74] },
      { ...PLANK, hip: [54, 80], knee: [66, 86], ankle: [78, 84], toe: [82, 88], head: [22, 69], neck: [30, 72] },
    ],
  },

  'prkno-na-predlokti': {
    alt: 'Podpor na předloktích a špičkách. Tělo drží přímku od pat po hlavu.',
    frames: [{ ...PLANK, hip: [54, 82] }, PLANK],
  },

  'prkno-s-dotykem-ramen': {
    alt: 'Vzpor na dlaních. Střídavě se jedna ruka odlepí a dotkne protilehlého ramene, pánev se nesmí vytočit.',
    frames: [
      { ...PLANK, elbow: [28, 78], hand: [28, 86], head: [20, 64], neck: [28, 67] },
      { ...PLANK, elbow: [34, 76], hand: [36, 70], head: [20, 64], neck: [28, 67] },
    ],
  },

  'bocne-prkno-na-kolenou': {
    alt: 'Bok na zemi, opora o loket a kolena. Pánev se zvedne tak, aby kolena, boky a ramena tvořily přímku.',
    frames: [
      {
        look: [0, 0],
        head: [22, 66],
        neck: [30, 70],
        hip: [56, 82],
        elbow: [30, 86],
        hand: [20, 86],
        knee: [68, 86],
        ankle: [80, 84],
        toe: [84, 88],
        elbowFar: [34, 60],
        handFar: [36, 50],
      },
      {
        look: [0, 0],
        head: [22, 60],
        neck: [30, 64],
        hip: [56, 76],
        elbow: [30, 86],
        hand: [20, 86],
        knee: [68, 86],
        ankle: [80, 84],
        toe: [84, 88],
        elbowFar: [34, 54],
        handFar: [36, 44],
      },
    ],
  },

  'bocne-prkno': {
    alt: 'Boční prkno s nataženýma nohama – opora o loket a hranu chodidla, horní ruka míří vzhůru.',
    frames: [
      {
        look: [0, 0],
        head: [22, 64],
        neck: [30, 68],
        hip: [56, 80],
        elbow: [30, 86],
        hand: [20, 86],
        knee: [70, 84],
        ankle: [82, 86],
        toe: [86, 88],
        elbowFar: [34, 58],
        handFar: [36, 48],
      },
      {
        look: [0, 0],
        head: [22, 58],
        neck: [30, 62],
        hip: [56, 74],
        elbow: [30, 86],
        hand: [20, 86],
        knee: [70, 80],
        ankle: [82, 85],
        toe: [86, 88],
        elbowFar: [34, 52],
        handFar: [36, 42],
      },
    ],
  },

  'bocne-prkno-s-rotaci': {
    alt: 'Z bočního prkna se horní paže provlékne pod tělem a zase vrátí vzhůru.',
    frames: [
      {
        look: [0, 0],
        head: [22, 58],
        neck: [30, 62],
        hip: [56, 74],
        elbow: [30, 86],
        hand: [20, 86],
        knee: [70, 80],
        ankle: [82, 85],
        toe: [86, 88],
        elbowFar: [34, 52],
        handFar: [36, 42],
      },
      {
        look: [0, 0],
        head: [22, 60],
        neck: [30, 64],
        hip: [56, 74],
        elbow: [30, 86],
        hand: [20, 86],
        knee: [70, 80],
        ankle: [82, 85],
        toe: [86, 88],
        elbowFar: [40, 70],
        handFar: [52, 78],
      },
    ],
  },

  'lodicka-na-brise': {
    alt: 'Leh na břiše. Nad zem se zvednou paže, hrudník i nohy najednou.',
    frames: [
      { ...PRONE, elbow: [30, 86], hand: [18, 86] },
      {
        ...PRONE,
        // Zvednutá hlava: pohled dopředu a dolů, ne kolmo do země jako v lehu.
        look: [-0.8, 0.5],
        head: [17, 68],
        neck: [26, 75],
        mid: [39, 84],
        elbow: [26, 70],
        hand: [16, 64],
        knee: [66, 82],
        ankle: [78, 72],
        toe: [82, 67],
      },
    ],
  },

  'zkracovacky': {
    alt: 'Leh na zádech s pokrčenými koleny, ruce u hlavy. Od země se odlepí jen lopatky.',
    frames: [
      { ...SUPINE, elbow: [30, 80], hand: [24, 74] },
      { ...SUPINE, look: [0.6, -0.8], head: [28, 68], neck: [34, 73], elbow: [32, 72], hand: [27, 66] },
    ],
  },

  'sedy-lehy': {
    alt: 'Leh na zádech s pokrčenými koleny. Trup se zvedne až do sedu a pomalu vrací zpět.',
    frames: [
      { ...SUPINE, elbow: [30, 80], hand: [24, 74] },
      {
        ...SUPINE,
        // V sedu se člověk dívá dopředu na kolena, ne do stropu jako v lehu.
        look: [1, 0.3],
        head: [48, 49],
        neck: [48, 58],
        hip: [50, 82],
        elbow: [42, 60],
        hand: [40, 52],
      },
    ],
  },

  'hollow-hold': {
    alt: 'Leh na zádech, bedra přitisknutá k zemi, paže za hlavou a nohy nízko nad zemí.',
    frames: [
      { ...SUPINE_LONG, elbow: [22, 80], hand: [12, 80] },
      {
        ...SUPINE_LONG,
        // Pohled na špičky – v hollow holdu se brada přitahuje k hrudi.
        look: [1, -0.3],
        head: [24, 68],
        neck: [32, 73],
        mid: [42, 83],
        elbow: [22, 66],
        hand: [12, 62],
        knee: [66, 74],
        ankle: [78, 64],
        toe: [82, 59],
      },
    ],
  },

  /* --- Síla a hýždě ------------------------------------------------ */

  'hyzdovy-most': {
    alt: 'Leh na zádech s pokrčenými koleny. Pánev se zvedá, dokud tělo od kolen po ramena netvoří přímku.',
    frames: [SUPINE, { ...SUPINE, hip: [50, 70], knee: [64, 68] }],
  },

  'hyzdovy-most-jednonoz': {
    alt: 'Hýžďový most s jednou nohou nataženou dopředu – pánev se nesmí naklonit.',
    frames: [
      { ...SUPINE, kneeFar: [66, 80], ankleFar: [80, 80], toeFar: [84, 74] },
      { ...SUPINE, hip: [50, 70], knee: [64, 68], kneeFar: [66, 66], ankleFar: [80, 62], toeFar: [84, 58] },
    ],
  },

  'goblet-squat': {
    alt: 'Dřep s jednoručkou drženou svisle u hrudníku. Kolena jdou ven, záda zůstávají rovná.',
    frames: [
      { ...STAND, elbow: [40, 36], hand: [52, 38], prop: { kind: 'dumbbell', at: 'hand' } },
      { ...SQUAT, elbow: [46, 46], hand: [56, 46], prop: { kind: 'dumbbell', at: 'hand' } },
    ],
  },

  'dumbbell-romanian-deadlift': {
    alt: 'Rumunský mrtvý tah: pánev jde dozadu, činky sjíždějí po stehnech, záda zůstávají rovná.',
    frames: [
      { ...STAND, elbow: [46, 36], hand: [48, 50], prop: { kind: 'dumbbell', at: 'hand' } },
      { ...HINGE, elbow: [58, 54], hand: [56, 68], prop: { kind: 'dumbbell', at: 'hand' } },
    ],
  },

  'dumbbell-bench-press': {
    alt: 'Leh na lavici, chodidla na zemi. Jednoručky se tlačí od hrudníku vzhůru.',
    frames: [
      {
        // Leh na lavici: obličej ke stropu, jinak by to vypadalo jako klik.
        look: [0, -1],
        head: [26, 62],
        neck: [34, 65],
        hip: [58, 68],
        elbow: [30, 72],
        hand: [40, 68],
        knee: [66, 78],
        ankle: [72, 86],
        toe: [78, 88],
        prop: { kind: 'bench', y: 70 },
      },
      {
        look: [0, -1],
        head: [26, 62],
        neck: [34, 65],
        hip: [58, 68],
        elbow: [36, 58],
        hand: [38, 46],
        knee: [66, 78],
        ankle: [72, 86],
        toe: [78, 88],
        prop: { kind: 'bench', y: 70 },
      },
    ],
  },

  'seated-cable-row': {
    alt: 'Sed u kladky, mírně pokrčená kolena. Lopatky se stáhnou k sobě a madlo se táhne k břichu.',
    frames: [
      { ...SEATED, neck: [34, 60], head: [36, 51], elbow: [48, 62], hand: [64, 62], prop: { kind: 'bar', at: 'hand' } },
      { ...SEATED, elbow: [38, 66], hand: [44, 72], prop: { kind: 'bar', at: 'hand' } },
    ],
  },

  /* --- Mobilita ---------------------------------------------------- */

  'hip-hinge-dowel': {
    alt: 'Předklon z kyčlí s tyčí podél zad – tyč se musí po celou dobu dotýkat hlavy, hrudní páteře a kříže.',
    frames: [
      { ...STAND, elbow: [44, 34], hand: [44, 44] },
      { ...HINGE, elbow: [56, 46], hand: [50, 52] },
    ],
  },

  'sciatic-nerve-glide': {
    alt: 'Leh na zádech, stehno drženo kolmo. Koleno se natahuje a špička přitahuje – bez tlačení do bolesti.',
    durationMs: 3200,
    frames: [
      { ...SUPINE, knee: [58, 62], ankle: [52, 48], toe: [58, 42], elbow: [34, 74], hand: [48, 64] },
      { ...SUPINE, knee: [58, 60], ankle: [68, 44], toe: [70, 36], elbow: [34, 74], hand: [48, 64] },
    ],
  },

  'ninety-ninety-hip': {
    alt: 'Sed s oběma koleny pokrčenými do pravého úhlu na jednu stranu. Kolena se překlápějí ze strany na stranu.',
    durationMs: 3600,
    frames: [
      {
        ...SEATED,
        head: [34, 51],
        neck: [32, 60],
        knee: [54, 72],
        ankle: [70, 82],
        toe: [76, 84],
        kneeFar: [20, 76],
        ankleFar: [14, 86],
        toeFar: [8, 88],
        elbow: [38, 68],
        hand: [50, 76],
      },
      {
        ...SEATED,
        // Kolena se překlopila na druhou stranu a trup se otočil s nimi.
        look: [-1, 0],
        head: [26, 51],
        neck: [28, 60],
        knee: [10, 76],
        ankle: [16, 86],
        toe: [10, 88],
        kneeFar: [54, 72],
        ankleFar: [70, 82],
        toeFar: [76, 84],
        elbow: [22, 68],
        hand: [12, 76],
      },
    ],
  },

  'thread-the-needle': {
    alt: 'Ze vzporu klečmo se jedna paže provlékne pod tělem a rameno se položí na zem.',
    frames: [
      QUADRUPED,
      {
        ...QUADRUPED,
        // Rameno i spánek na zemi, pohled podél provlečené paže.
        look: [0.9, 0.4],
        head: [26, 80],
        neck: [32, 74],
        elbow: [42, 84],
        hand: [56, 86],
      },
    ],
  },

  'cossack-adductor-rock': {
    alt: 'Široký postoj. Váha se přenáší na jednu pokrčenou nohu, druhá zůstává natažená.',
    durationMs: 3600,
    frames: [
      {
        // Široký postoj se z profilu neukáže – tenhle cvik se kreslí zepředu.
        look: [0, 0],
        head: [50, 26],
        neck: [50, 34],
        hip: [50, 58],
        elbow: [54, 44],
        hand: [58, 52],
        knee: [64, 70],
        ankle: [72, 86],
        toe: [78, 88],
        kneeFar: [36, 70],
        ankleFar: [28, 86],
        toeFar: [22, 88],
      },
      {
        look: [0, 0],
        head: [64, 40],
        neck: [64, 48],
        hip: [66, 70],
        elbow: [62, 58],
        hand: [58, 66],
        knee: [76, 76],
        ankle: [78, 86],
        toe: [84, 88],
        kneeFar: [46, 82],
        ankleFar: [26, 86],
        toeFar: [20, 88],
      },
    ],
  },

  'jefferson-curl-bodyweight': {
    alt: 'Ze stoje se páteř odvíjí obratel po obratli dolů a stejně pomalu zpět. Bez zátěže.',
    durationMs: 4400,
    frames: [
      STAND,
      { ...FOLD, mid: [52, 44], head: [68, 60], neck: [60, 54] },
      { ...FOLD, mid: [50, 52], head: [70, 74], neck: [60, 62], hand: [72, 86] },
    ],
  },

  /* --- Protažení --------------------------------------------------- */

  'kneeling-hip-flexor-stretch': {
    alt: 'Klek na jedné noze, druhá vepředu. Pánev se podsadí a posune dopředu – tah je vepředu na stehně zadní nohy.',
    frames: [HALF_KNEEL, { ...HALF_KNEEL, hip: [51, 61], knee: [63, 70], ankle: [64, 86], toe: [70, 88] }],
  },

  'couch-stretch': {
    alt: 'Klek u zdi, nárt zadní nohy opřený o zeď. Trup se narovnává, tah je vepředu na stehně.',
    frames: [
      {
        ...HALF_KNEEL,
        head: [56, 40],
        neck: [56, 48],
        hip: [54, 66],
        elbow: [60, 56],
        hand: [66, 64],
        knee: [70, 72],
        ankle: [74, 86],
        toe: [80, 88],
        kneeFar: [40, 86],
        ankleFar: [28, 78],
        toeFar: [24, 72],
        prop: { kind: 'wall', x: 20 },
      },
      {
        ...HALF_KNEEL,
        head: [56, 32],
        neck: [56, 40],
        hip: [54, 64],
        elbow: [60, 50],
        hand: [66, 58],
        knee: [70, 72],
        ankle: [74, 86],
        toe: [80, 88],
        kneeFar: [40, 86],
        ankleFar: [26, 74],
        toeFar: [22, 68],
        prop: { kind: 'wall', x: 20 },
      },
    ],
  },

  'supine-hamstring-strap': {
    alt: 'Leh na zádech, popruh přes chodidlo. Natažená noha se přitahuje k trupu, druhá zůstává na zemi.',
    durationMs: 4000,
    frames: [
      {
        ...SUPINE_LONG,
        knee: [64, 78],
        ankle: [78, 76],
        toe: [82, 70],
        elbow: [36, 80],
        hand: [46, 78],
        kneeFar: [66, 84],
        ankleFar: [80, 84],
        toeFar: [83, 78],
        prop: { kind: 'strap', from: 'hand', to: 'ankle' },
      },
      {
        ...SUPINE_LONG,
        knee: [58, 62],
        ankle: [64, 44],
        toe: [68, 38],
        elbow: [34, 74],
        hand: [44, 64],
        kneeFar: [66, 84],
        ankleFar: [80, 84],
        toeFar: [83, 78],
        prop: { kind: 'strap', from: 'hand', to: 'ankle' },
      },
    ],
  },

  'pnf-hamstring-contract-relax': {
    alt: 'Protažení hamstringů vleže: noha se pár vteřin tlačí proti popruhu a po povolení se posune o kus dál.',
    durationMs: 4800,
    frames: [
      {
        ...SUPINE_LONG,
        knee: [58, 62],
        ankle: [64, 46],
        toe: [68, 40],
        elbow: [34, 74],
        hand: [44, 64],
        kneeFar: [66, 84],
        ankleFar: [80, 84],
        toeFar: [83, 78],
        prop: { kind: 'strap', from: 'hand', to: 'ankle' },
      },
      {
        ...SUPINE_LONG,
        knee: [58, 66],
        ankle: [66, 52],
        toe: [70, 46],
        elbow: [34, 76],
        hand: [44, 68],
        kneeFar: [66, 84],
        ankleFar: [80, 84],
        toeFar: [83, 78],
        prop: { kind: 'strap', from: 'hand', to: 'ankle' },
      },
      {
        ...SUPINE_LONG,
        knee: [56, 58],
        ankle: [60, 38],
        toe: [64, 32],
        elbow: [32, 72],
        hand: [42, 58],
        kneeFar: [66, 84],
        ankleFar: [80, 84],
        toeFar: [83, 78],
        prop: { kind: 'strap', from: 'hand', to: 'ankle' },
      },
    ],
  },

  'supine-figure-four': {
    alt: 'Leh na zádech, kotník přeložený přes koleno druhé nohy. Spodní stehno se přitahuje k sobě.',
    frames: [
      {
        ...SUPINE,
        knee: [62, 66],
        ankle: [66, 82],
        toe: [72, 82],
        kneeFar: [72, 70],
        ankleFar: [58, 72],
        toeFar: [52, 74],
        elbow: [38, 78],
        hand: [52, 74],
      },
      {
        ...SUPINE,
        knee: [56, 56],
        ankle: [60, 72],
        toe: [66, 72],
        kneeFar: [68, 60],
        ankleFar: [52, 62],
        toeFar: [46, 64],
        elbow: [36, 70],
        hand: [50, 62],
      },
    ],
  },

  'seated-butterfly-adductor': {
    alt: 'Sed, chodidla u sebe a kolena volně padají k zemi. Záda zůstávají rovná.',
    frames: [
      {
        ...SEATED,
        knee: [54, 74],
        ankle: [46, 84],
        toe: [52, 86],
        kneeFar: [54, 82],
        ankleFar: [46, 87],
        toeFar: [52, 88],
        elbow: [40, 70],
        hand: [50, 80],
      },
      {
        ...SEATED,
        head: [36, 55],
        neck: [34, 63],
        knee: [54, 80],
        ankle: [46, 86],
        toe: [52, 87],
        kneeFar: [54, 85],
        ankleFar: [46, 88],
        toeFar: [52, 88],
        elbow: [42, 72],
        hand: [50, 82],
      },
    ],
  },

  'standing-forward-fold': {
    alt: 'Předklon ve stoji s mírně pokrčenými koleny. Tah je vzadu na stehnech, ne v kříži.',
    durationMs: 3800,
    frames: [STAND, FOLD],
  },

  'seated-forward-fold': {
    alt: 'Předklon v sedu s nataženýma nohama. Vede hrudník, ne hlava.',
    durationMs: 3800,
    frames: [
      SEATED,
      {
        ...SEATED,
        look: [0.6, 0.8],
        head: [46, 66],
        neck: [40, 70],
        mid: [34, 76],
        elbow: [46, 76],
        hand: [60, 82],
      },
    ],
  },

  'elevated-hamstring-hinge': {
    alt: 'Pata na vyvýšenině, koleno skoro natažené. Předklon jde z kyčlí, záda zůstávají rovná.',
    frames: [
      {
        look: [1, 0],
        head: [40, 26],
        neck: [40, 34],
        hip: [40, 56],
        elbow: [44, 44],
        hand: [46, 54],
        knee: [56, 66],
        ankle: [66, 70],
        toe: [72, 68],
        kneeFar: [40, 72],
        ankleFar: [40, 86],
        toeFar: [46, 88],
        prop: { kind: 'box', x: 64, y: 72, w: 22 },
      },
      {
        // Předklon: pohled dopředu a dolů, ne vodorovně jako ve stoji.
        look: [0.8, 0.5],
        head: [62, 40],
        neck: [55, 44],
        hip: [38, 56],
        elbow: [58, 54],
        hand: [62, 62],
        knee: [56, 66],
        ankle: [66, 70],
        toe: [72, 68],
        kneeFar: [40, 72],
        ankleFar: [40, 86],
        toeFar: [46, 88],
        prop: { kind: 'box', x: 64, y: 72, w: 22 },
      },
    ],
  },

  'wall-calf-stretch': {
    alt: 'Ruce o zeď, zadní noha natažená s patou na zemi. Tah je v lýtku zadní nohy.',
    frames: [
      {
        look: [1, 0],
        head: [44, 28],
        neck: [46, 36],
        hip: [38, 58],
        elbow: [58, 40],
        hand: [74, 44],
        knee: [32, 74],
        ankle: [26, 86],
        toe: [33, 88],
        kneeFar: [50, 68],
        ankleFar: [58, 86],
        toeFar: [65, 88],
        prop: { kind: 'wall', x: 78 },
      },
      {
        look: [1, 0],
        head: [48, 30],
        neck: [50, 38],
        hip: [40, 58],
        elbow: [60, 44],
        hand: [74, 50],
        knee: [32, 74],
        ankle: [26, 86],
        toe: [33, 88],
        kneeFar: [54, 70],
        ankleFar: [62, 86],
        toeFar: [69, 88],
        prop: { kind: 'wall', x: 78 },
      },
    ],
  },

  'childs-pose': {
    alt: 'Sed na patách, hrudník na stehnech, paže natažené vpřed po zemi.',
    durationMs: 4200,
    frames: [
      { ...QUADRUPED, hip: [58, 68], head: [24, 64], neck: [32, 66] },
      {
        // Čelo na zemi, obličej dolů.
        look: [-0.3, 1],
        head: [26, 76],
        neck: [34, 79],
        mid: [46, 74],
        hip: [58, 82],
        elbow: [26, 84],
        hand: [14, 86],
        knee: [62, 86],
        ankle: [72, 86],
        toe: [76, 88],
      },
    ],
  },

  /* --- Kardio ------------------------------------------------------ */

  'marching-in-place': {
    alt: 'Pochod na místě – koleno se zvedá do výšky kyčle, protilehlá paže jde dopředu.',
    durationMs: 1600,
    frames: [
      {
        ...STAND,
        knee: [56, 60],
        ankle: [56, 74],
        toe: [62, 76],
        elbow: [50, 34],
        hand: [56, 28],
        kneeFar: [44, 69],
        ankleFar: [44, 86],
        toeFar: [50, 88],
        elbowFar: [42, 38],
        handFar: [38, 50],
      },
      {
        ...STAND,
        knee: [46, 69],
        ankle: [46, 86],
        toe: [52, 88],
        elbow: [42, 38],
        hand: [38, 50],
        kneeFar: [56, 60],
        ankleFar: [56, 74],
        toeFar: [62, 76],
        elbowFar: [50, 34],
        handFar: [56, 28],
      },
    ],
  },

  'brisk-walk': {
    alt: 'Svižná chůze – dlouhý krok, paže se hýbou z ramen.',
    durationMs: 1500,
    frames: [
      {
        ...STAND,
        knee: [54, 66],
        ankle: [60, 84],
        toe: [66, 87],
        elbow: [42, 36],
        hand: [38, 48],
        kneeFar: [40, 70],
        ankleFar: [34, 86],
        toeFar: [40, 88],
        elbowFar: [50, 36],
        handFar: [54, 46],
      },
      {
        ...STAND,
        knee: [40, 70],
        ankle: [34, 86],
        toe: [40, 88],
        elbow: [50, 36],
        hand: [54, 46],
        kneeFar: [54, 66],
        ankleFar: [60, 84],
        toeFar: [66, 87],
        elbowFar: [42, 36],
        handFar: [38, 48],
      },
    ],
  },

  'jumping-jacks': {
    alt: 'Poskoky s roznožením – paže jdou nad hlavu, nohy do stran, a zpět.',
    durationMs: 1300,
    frames: [
      FRONT,
      {
        ...FRONT,
        elbow: [64, 26],
        hand: [70, 12],
        elbowFar: [36, 26],
        handFar: [30, 12],
        knee: [62, 68],
        ankle: [70, 86],
        toe: [73, 88],
        kneeFar: [38, 68],
        ankleFar: [30, 86],
        toeFar: [27, 88],
      },
    ],
  },

  'step-jacks-low-impact': {
    alt: 'Jumping jacks bez výskoku – jedna noha vykročí do strany, paže jdou do výšky ramen.',
    durationMs: 1500,
    frames: [
      FRONT,
      {
        ...FRONT,
        elbow: [64, 30],
        hand: [74, 24],
        elbowFar: [36, 30],
        handFar: [26, 24],
        knee: [60, 69],
        ankle: [66, 86],
        toe: [69, 88],
        kneeFar: [46, 69],
        ankleFar: [46, 86],
        toeFar: [46, 88],
      },
    ],
  },

  'shadow-boxing': {
    alt: 'Stínový box – z gardy vyráží přímý úder, druhá ruka kryje bradu.',
    durationMs: 1200,
    frames: [
      {
        ...STAND,
        head: [46, 15],
        neck: [46, 24],
        knee: [48, 68],
        ankle: [52, 86],
        toe: [58, 88],
        elbow: [42, 38],
        hand: [50, 28],
        elbowFar: [40, 40],
        handFar: [44, 30],
        kneeFar: [42, 70],
        ankleFar: [36, 86],
        toeFar: [42, 88],
      },
      {
        ...STAND,
        head: [46, 15],
        neck: [46, 24],
        knee: [48, 68],
        ankle: [52, 86],
        toe: [58, 88],
        elbow: [58, 30],
        hand: [74, 26],
        elbowFar: [40, 40],
        handFar: [44, 30],
        kneeFar: [42, 70],
        ankleFar: [36, 86],
        toeFar: [42, 88],
      },
    ],
  },

  'stair-climbing': {
    alt: 'Chůze do schodů – celé chodidlo na stupni, odraz z paty.',
    durationMs: 1800,
    frames: [
      {
        ...STAND,
        head: [40, 17],
        neck: [40, 26],
        hip: [40, 54],
        knee: [52, 60],
        ankle: [62, 66],
        toe: [68, 66],
        elbow: [38, 38],
        hand: [34, 50],
        kneeFar: [40, 72],
        ankleFar: [40, 86],
        toeFar: [46, 88],
        prop: { kind: 'box', x: 60, y: 68, w: 30 },
      },
      {
        ...STAND,
        head: [56, 9],
        neck: [56, 18],
        hip: [56, 46],
        knee: [56, 58],
        ankle: [58, 68],
        toe: [64, 68],
        elbow: [54, 30],
        hand: [50, 42],
        kneeFar: [64, 56],
        ankleFar: [74, 52],
        toeFar: [80, 52],
        prop: { kind: 'box', x: 60, y: 68, w: 30 },
      },
    ],
  },

  'step-ups': {
    alt: 'Výstup na stupínek – celá noha nahoře, tělo se zvedá bez odrazu druhé nohy.',
    durationMs: 2200,
    frames: [
      {
        ...STAND,
        head: [36, 17],
        neck: [36, 26],
        hip: [36, 54],
        knee: [50, 62],
        ankle: [62, 70],
        toe: [68, 70],
        elbow: [36, 38],
        hand: [36, 50],
        kneeFar: [36, 72],
        ankleFar: [36, 86],
        toeFar: [42, 88],
        prop: { kind: 'box', x: 58, y: 72, w: 32 },
      },
      {
        ...STAND,
        head: [62, 3],
        neck: [62, 12],
        hip: [62, 40],
        knee: [62, 56],
        ankle: [62, 70],
        toe: [68, 70],
        elbow: [62, 24],
        hand: [62, 36],
        kneeFar: [50, 52],
        ankleFar: [44, 66],
        toeFar: [50, 68],
        prop: { kind: 'box', x: 58, y: 72, w: 32 },
      },
    ],
  },

  'burpee-elevated-regression': {
    alt: 'Burpee s rukama na vyvýšenině – ze stoje do vzporu o desku a zpět, bez skoku.',
    durationMs: 2600,
    frames: [
      { ...STAND, head: [34, 13], neck: [34, 22], hip: [34, 51], knee: [34, 69], ankle: [34, 86], toe: [41, 88], elbow: [34, 36], hand: [34, 49], prop: { kind: 'box', x: 62, y: 60, w: 28 } },
      {
        // Vzpor: pohled do země pod sebe.
        look: [0.3, 1],
        head: [72, 46],
        neck: [64, 50],
        hip: [40, 62],
        elbow: [70, 54],
        hand: [70, 60],
        knee: [26, 72],
        ankle: [14, 82],
        toe: [12, 86],
        prop: { kind: 'box', x: 62, y: 60, w: 28 },
      },
    ],
  },
}

/* ------------------------------------------------------------------ */

export function getFigure(exerciseId: string): Figure | null {
  return FIGURES[exerciseId] ?? null
}
