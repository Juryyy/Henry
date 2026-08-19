<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  BODY,
  blobPath,
  faceLine,
  fitView,
  GROUND_Y,
  HEAD_R,
  limbPath,
  poseAt,
  spineControl,
  subscribeClock,
  torsoEdges,
  torsoJoints,
  WAIST,
  type Figure,
  type Point,
  type Pose,
} from '@/lib/figure'
import { CATEGORY_TONE } from '@/data/exercises'
import type { ExerciseCategory } from '@/lib/types'

/**
 * Vykreslí postavičku předvádějící cvik.
 *
 * Není to čárová figurka, ale silueta: každá končetina je plný tvar, který se
 * ke konci zužuje, a kolem každého dílu je obrys v barvě podkladu. Ten obrys
 * je celý trik – bez něj splyne paže s trupem do jedné beztvaré plochy,
 * protože je to jedna barva přes druhou. Kreslí se přes `paint-order: stroke`,
 * takže nestojí ani jeden prvek navíc.
 *
 * V seznamech se kreslí **statická** poloha (ta poslední, tedy „jak to má
 * vypadat"), v detailu a v přehrávači se hýbe. Čtyřicet animací v katalogu
 * najednou by telefon jen hřálo a k ničemu by to nebylo.
 *
 * Kdo má v systému zapnuté omezení pohybu, dostane taky statický obrázek –
 * a obojí je pořád ten samý obrázek, ne náhradní ikona.
 */
const props = withDefaults(
  defineProps<{
    figure: Figure | null
    /** Rozhýbat. I tak se to vypne, když si to systém nepřeje. */
    animated?: boolean
    /**
     * Na co cvik je. Obarví postavičku, takže je při listování poznat
     * protahování od posilování ještě dřív, než si člověk přečte název.
     * Barva je informace navíc – skupina je vždycky napsaná i slovy.
     */
    category?: ExerciseCategory
  }>(),
  { animated: false, category: 'core' },
)

const tone = computed(() => CATEGORY_TONE[props.category] ?? CATEGORY_TONE.core)

const phase = ref(0)
const reduceMotion = ref(false)
let unsubscribe: (() => void) | null = null

const running = computed(() => props.animated && !reduceMotion.value && (props.figure?.frames.length ?? 0) > 1)

onMounted(() => {
  const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  reduceMotion.value = !!query?.matches
  query?.addEventListener?.('change', (event) => (reduceMotion.value = event.matches))

  if (!running.value) return
  const duration = props.figure?.durationMs ?? 2600
  unsubscribe = subscribeClock((now) => {
    phase.value = (now % duration) / duration
  })
})

onBeforeUnmount(() => unsubscribe?.())

/** Statický obrázek ukazuje cílovou polohu – tu, kam se člověk dostává. */
const pose = computed<Pose | null>(() => {
  const frames = props.figure?.frames
  if (!frames?.length) return null
  if (!running.value) return frames[frames.length - 1]!
  return poseAt(frames, phase.value)
})

/**
 * Výřez se počítá z pózí, ne z ruky. Zaručuje to, že cvik vleže i ve stoji
 * vyplní obrázek stejně – a hlavně to nejde zapomenout doladit po úpravě dat.
 */
const view = computed<[number, number, number, number]>(() => {
  const frames = props.figure?.frames
  if (!frames?.length) return [0, 0, 100, 100]
  return fitView(frames)
})

const viewBox = computed(() => view.value.join(' '))

const xy = (point: Point): string => `${point[0].toFixed(1)},${point[1].toFixed(1)}`

/* ------------------------------------------------------------------ */
/*  Díly těla                                                          */
/* ------------------------------------------------------------------ */

/** Paže i s dlaní na konci. Dlaň je podcesta, takže šev vidět není. */
function armPath(neck: Point, elbow: Point, hand: Point, far = false): string {
  const k = far ? BODY.dal : 1
  const chain = limbPath(
    [neck, elbow, hand],
    [BODY.paze[0] * k, BODY.paze[1] * k, BODY.predlokti[1] * k],
  )
  return `${chain} ${blobPath(hand, BODY.dlan * k)}`
}

/** Noha od kyčle po špičku – poslední úsek je chodidlo. */
function legPath(hip: Point, knee: Point, ankle: Point, toe: Point, far = false): string {
  const k = far ? BODY.dal : 1
  return limbPath(
    [hip, knee, ankle, toe],
    [BODY.stehno[0] * k, BODY.stehno[1] * k, BODY.lytko[1] * k, BODY.chodidlo[1] * k],
  )
}

/** Rameno a kyčel uvnitř trupu, ne na páteři – odtud vedou končetiny. */
const joints = computed(() => (pose.value ? torsoJoints(pose.value) : null))

const arm = computed(() => {
  const p = pose.value
  return p && joints.value ? armPath(joints.value.shoulder, p.elbow, p.hand) : ''
})

const leg = computed(() => {
  const p = pose.value
  return p && joints.value ? legPath(joints.value.hip, p.knee, p.ankle, p.toe) : ''
})

const armFar = computed(() => {
  const p = pose.value
  return p?.elbowFar && p.handFar && joints.value
    ? armPath(joints.value.shoulder, p.elbowFar, p.handFar, true)
    : ''
})

const legFar = computed(() => {
  const p = pose.value
  return p?.kneeFar && p.ankleFar && p.toeFar && joints.value
    ? legPath(joints.value.hip, p.kneeFar, p.ankleFar, p.toeFar, true)
    : ''
})

/**
 * Krk, hlava a nos jako jedna cesta.
 *
 * Jedna schválně: obrys se pak kreslí kolem obrysu celé hlavy, ne kolem
 * každého kousku zvlášť. Nos s vlastním obrysem vypadá jako nalepený zobák,
 * ne jako profil obličeje.
 */
const head = computed(() => {
  const p = pose.value
  if (!p) return ''
  const parts = [blobPath(p.head, HEAD_R)]
  const face = faceLine(p)
  // Nos je krátký klín od středu hlavy ven. Delší z něj dělá zobák –
  // u ležících pozic je hlava malá a všechno navíc je hned vidět.
  if (face) parts.push(limbPath([p.head, face[1]], [HEAD_R * 0.78, 1.5]))
  return parts.join(' ')
})

/**
 * Krk zvlášť, a kreslí se **pod** trupem.
 *
 * Kdyby byl v jedné cestě s hlavou, jeho obrys by přeťal trup a kolem krku
 * by byl límec. Takhle spodek krku zmizí v hrudníku, jak má.
 */
const neck = computed(() => {
  const p = pose.value
  return p ? limbPath([p.neck, p.head], [BODY.krk, BODY.krk * 0.82]) : ''
})

/**
 * Trup jako plocha kolem páteře.
 *
 * Tohle je celý ten trik, jak ukázat, kde jsou záda: samotná čára od krku
 * k pánvi je souměrná a nedá se z ní poznat, jestli se člověk hrbí, nebo
 * prohýbá. Jakmile ale objem těla sedí celý na břišní straně, hrana na té
 * druhé je zjevně páteř – a je vidět, kterým směrem se ohýbá.
 */
const torso = computed(() => {
  const p = pose.value
  if (!p) return ''
  const edges = torsoEdges(p)
  if (!edges) return ''
  const control = spineControl(p)
  const at = (depth: number) => {
    const [dx, dy] = [edges.normal[0] * depth, edges.normal[1] * depth]
    return (point: Point): Point => [point[0] + dx, point[1] + dy]
  }
  const back = at(edges.back)
  const belly = at(edges.belly)
  // Řídicí bod je odsazený míň než konce – tím se trup v pase zúží.
  const backWaist = at(edges.back * WAIST)
  const bellyWaist = at(edges.belly * WAIST)

  /**
   * Zaoblený konec trupu – ramena a pánev. Ostrý roh mezi končetinami,
   * které mají kulaté klouby, kouká jako přilepený obdélník.
   *
   * Kubika s řídicími body posunutými o 4/3 poloměru po ose páteře je běžná
   * náhrada půlkružnice; odchylka je pod desetinu procenta, tedy hluboko pod
   * tloušťkou obrysu. Kruhový oblouk by tu byl přesnější, ale musel by se
   * k němu dopočítat směr obtočení – a ten se u trupu obrací podle toho,
   * kterým směrem se postavička dívá.
   */
  const depth = Math.abs(edges.belly - edges.back)
  const spine = [p.hip[0] - p.neck[0], p.hip[1] - p.neck[1]]
  const spineLength = Math.hypot(spine[0], spine[1]) || 1
  const bulge = ((depth / 2) * 4) / 3
  const along = (point: Point, sign: number): Point => [
    point[0] + (spine[0] / spineLength) * bulge * sign,
    point[1] + (spine[1] / spineLength) * bulge * sign,
  ]

  // Tam po jedné hraně, zpátky po druhé. Stejný řídicí bod jen posunutý –
  // obě hrany tak kopírují páteř a trup se nikde nevyboulí.
  return [
    `M ${xy(back(p.neck))}`,
    `Q ${xy(backWaist(control))} ${xy(back(p.hip))}`,
    `C ${xy(along(back(p.hip), 1))} ${xy(along(belly(p.hip), 1))} ${xy(belly(p.hip))}`,
    `Q ${xy(bellyWaist(control))} ${xy(belly(p.neck))}`,
    `C ${xy(along(belly(p.neck), -1))} ${xy(along(back(p.neck), -1))} ${xy(back(p.neck))}`,
    'Z',
  ].join(' ')
})

/**
 * Rýha zad. Vede uvnitř siluety kousek od zadní hrany, takže je vidět, kudy
 * páteř běží a kterým směrem se ohýbá – u kočičího hřbetu i u předklonu je to
 * ta jediná informace, kvůli které se ten cvik dělá.
 */
const spine = computed(() => {
  const p = pose.value
  if (!p) return ''
  const edges = torsoEdges(p)
  if (!edges) return ''
  const inset = edges.back + (edges.belly - edges.back) * 0.22
  const at = (depth: number) => {
    const [dx, dy] = [edges.normal[0] * depth, edges.normal[1] * depth]
    return (point: Point): Point => [point[0] + dx, point[1] + dy]
  }
  const edge = at(inset)
  // Rýha kopíruje zúžení v pase, jinak by v půlce vylezla z těla ven.
  const waist = at(inset * WAIST)
  return `M ${xy(edge(p.neck))} Q ${xy(waist(spineControl(p)))} ${xy(edge(p.hip))}`
})

/** Rekvizita se kreslí pod postavu, ať ji nepřekrývá. */
const prop = computed(() => pose.value?.prop ?? null)

const strapEnds = computed<[Point, Point] | null>(() => {
  const p = pose.value
  return p && p.prop?.kind === 'strap' ? [p.hand, p.ankle] : null
})
</script>

<template>
  <svg
    v-if="pose"
    class="figure"
    :viewBox="viewBox"
    role="img"
    :style="{ '--fig': tone }"
    :aria-label="figure?.alt ?? 'Provedení cviku'"
    preserveAspectRatio="xMidYMid meet"
  >
    <!-- Vlastní podklad. Obrys siluety je v jeho barvě, takže musí být jisté,
         co je za postavičkou – jinak by kolem ní byla svatozář v barvě, která
         se k pozadí karty nehodí. -->
    <rect class="backdrop" :x="view[0]" :y="view[1]" :width="view[2]" :height="view[3]" />

    <!-- Země. Bez ní není poznat, jestli cvik probíhá vleže, nebo ve stoji. -->
    <line class="ground" :x1="-40" :y1="GROUND_Y" :x2="140" :y2="GROUND_Y" />

    <template v-if="prop">
      <line v-if="prop.kind === 'wall'" class="ground" :x1="prop.x" :y1="12" :x2="prop.x" :y2="GROUND_Y" />
      <rect
        v-else-if="prop.kind === 'box'"
        class="prop"
        :x="prop.x"
        :y="prop.y"
        :width="prop.w"
        :height="GROUND_Y - prop.y"
        rx="1.5"
      />
      <rect class="prop" v-else-if="prop.kind === 'bench'" :x="18" :y="prop.y" :width="64" height="4" rx="2" />
    </template>

    <!-- Vzdálená ruka a noha jsou šedé, ne jen průhlednější: takhle je vidět,
         která polovina těla je blíž k divákovi, a u střídavých cviků (pochod,
         mrtvý brouk) se dá sledovat, co dělá která strana. -->
    <path v-if="legFar" class="part far" :d="legFar" />
    <path v-if="armFar" class="part far" :d="armFar" />

    <path class="part" :d="neck" />
    <path v-if="torso" class="part" :d="torso" />
    <path v-if="spine" class="spine" :d="spine" />

    <path class="part" :d="leg" />
    <path class="part" :d="arm" />
    <path class="part" :d="head" />

    <line
      v-if="strapEnds"
      class="strap"
      :x1="strapEnds[0][0]"
      :y1="strapEnds[0][1]"
      :x2="strapEnds[1][0]"
      :y2="strapEnds[1][1]"
    />

    <template v-if="prop?.kind === 'dumbbell'">
      <rect class="weight" :x="pose.hand[0] - 1" :y="pose.hand[1] - 5" width="2" height="10" rx="1" />
    </template>
    <line
      v-else-if="prop?.kind === 'bar'"
      class="weight"
      :x1="pose.hand[0] - 9"
      :y1="pose.hand[1] - 3"
      :x2="pose.hand[0] + 9"
      :y2="pose.hand[1] + 3"
    />
  </svg>
</template>

<style scoped>
.figure {
  display: block;
  width: 100%;
  height: auto;
  /* Pevný tvar pro všechny cviky – výřez uvnitř se dopočítá, ať karta v seznamu
     neposkakuje podle toho, jestli se cvik dělá vleže nebo ve stoji. */
  aspect-ratio: 3 / 2;
}

.backdrop {
  fill: var(--fig-bg, var(--bg-soft));
}

/*
 * Jeden díl těla. `paint-order: stroke` znamená „nejdřív obrys, pak výplň",
 * takže z obrysu zůstane venku jen jeho vnější polovina – vznikne mezera
 * proti tomu, co leží pod dílem. Přesně to dělá ze slepence ploch tělo:
 * paže přes trup je pak vidět jako paže, ne jako díra.
 */
.part {
  fill: var(--fig, var(--accent));
  stroke: var(--fig-bg, var(--bg-soft));
  stroke-width: 2;
  stroke-linejoin: round;
  paint-order: stroke;
}

/* Vzdálená polovina těla: neutrální šedá, ne bledší varianta téže barvy.
   Rozdíl barvy nese informaci („tahle je ta druhá“), pouhá průhlednost ne. */
.far {
  fill: var(--text-faint);
  opacity: 0.85;
}

.spine {
  fill: none;
  stroke: var(--fig-bg, var(--bg-soft));
  stroke-width: 1.5;
  stroke-linecap: round;
  opacity: 0.5;
}

.ground {
  stroke: var(--border-strong);
  stroke-width: 1.6;
  stroke-linecap: round;
}

.prop {
  fill: var(--surface-3);
  stroke: var(--border-strong);
  stroke-width: 1.2;
}

.strap {
  stroke: var(--text-faint);
  stroke-width: 1.6;
  stroke-dasharray: 3 2.5;
  stroke-linecap: round;
}

.weight {
  fill: var(--text-dim);
  stroke: var(--text-dim);
  stroke-width: 2.4;
  stroke-linecap: round;
}
</style>
