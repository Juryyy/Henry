<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fitView, GROUND_Y, poseAt, spineControl, subscribeClock, type Figure, type Point, type Pose } from '@/lib/figure'

/**
 * Vykreslí postavičku předvádějící cvik.
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
  }>(),
  { animated: false },
)

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
const viewBox = computed(() => {
  const frames = props.figure?.frames
  if (!frames?.length) return '0 0 100 100'
  return fitView(frames).join(' ')
})

const xy = (point: Point): string => `${point[0].toFixed(1)},${point[1].toFixed(1)}`
const line = (points: Point[]): string => points.map(xy).join(' ')

/** Trup jako křivka – řídicí bod uprostřed rozhoduje, jestli jsou záda kulatá. */
const spine = computed(() => {
  const p = pose.value
  if (!p) return ''
  return `M ${xy(p.neck)} Q ${xy(spineControl(p))} ${xy(p.hip)}`
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
    :aria-label="figure?.alt ?? 'Provedení cviku'"
    preserveAspectRatio="xMidYMid meet"
  >
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

    <!-- Vzdálená ruka a noha slabší – dodají hloubku, nepletou se do popředí. -->
    <polyline
      v-if="pose.elbowFar && pose.handFar"
      class="limb far"
      :points="line([pose.neck, pose.elbowFar, pose.handFar])"
    />
    <polyline
      v-if="pose.kneeFar && pose.ankleFar && pose.toeFar"
      class="limb far"
      :points="line([pose.hip, pose.kneeFar, pose.ankleFar, pose.toeFar])"
    />

    <!-- Krk. Bez něj hlava u prohnutých pozic viditelně odplouvá od trupu. -->
    <line class="limb neck" :x1="pose.neck[0]" :y1="pose.neck[1]" :x2="pose.head[0]" :y2="pose.head[1]" />
    <path class="limb torso" :d="spine" />
    <polyline class="limb" :points="line([pose.hip, pose.knee, pose.ankle, pose.toe])" />
    <polyline class="limb" :points="line([pose.neck, pose.elbow, pose.hand])" />

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

    <!-- Menší než poloměr, se kterým počítá výřez – radši trochu místa navíc
         než hlava odříznutá o okraj. -->
    <circle class="head" :cx="pose.head[0]" :cy="pose.head[1]" r="5.2" />
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

.limb {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.torso {
  stroke-width: 3.6;
}

.neck {
  stroke-width: 3.2;
}

/* Vzdálená končetina je za tělem – tenčí a průhlednější. */
.far {
  stroke: var(--accent);
  opacity: 0.35;
  stroke-width: 2.4;
}

.head {
  fill: var(--accent);
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
