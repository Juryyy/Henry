<script setup lang="ts">
import { computed } from 'vue'
import { CATEGORY_TONE, MUSCLE_LABELS } from '@/data/exercises'
import { blobPath, limbPath, type Point } from '@/lib/figure'
import type { ExerciseCategory, MuscleId, Muscles } from '@/lib/types'

/**
 * Mapa těla: které svaly cvik zatěžuje.
 *
 * Proč zvlášť od postavičky, která cvik předvádí: jsou to dvě různé otázky.
 * Postavička odpovídá „jak se to dělá" – a na to potřebuje pohyb, tedy dvě
 * pózy a přechod mezi nimi. Tahle mapa odpovídá „co mě z toho bude bolet" –
 * a na to potřebuje stát v klidu a být vidět zepředu i zezadu. Kdyby se to
 * slilo do jednoho obrázku, ani jedna z těch otázek by neměla pořádnou
 * odpověď: vybarvený sval na hýbající se postavičce v profilu je z poloviny
 * schovaný a stejně nepoznáš, jestli je vlevo, nebo vpravo.
 *
 * Kreslí se z kruhů a jednoduchých tvarů. Anatomický atlas to není a nechce
 * být – jde o to, aby člověk poznal, jestli si zítra sáhne na břicho, nebo
 * na zadní stranu stehen.
 *
 * Barva je informace navíc: skupiny jsou pod obrázkem vždycky vypsané slovy.
 */
const props = withDefaults(
  defineProps<{
    muscles: Muscles
    /** Obarví zvýrazněné svaly stejně jako postavičku u téhož cviku. */
    category?: ExerciseCategory
    /** Vypsat skupiny slovy pod obrázek. */
    withLegend?: boolean
  }>(),
  { category: 'core', withLegend: true },
)

const tone = computed(() => CATEGORY_TONE[props.category] ?? CATEGORY_TONE.core)

const primary = computed(() => new Set(props.muscles.primary))
const secondary = computed(() => new Set(props.muscles.secondary))

/** Třída pro jeden tvar: hlavní sval, vedlejší, nebo nic. */
function cls(id: MuscleId): string {
  if (primary.value.has(id)) return 'm on'
  if (secondary.value.has(id)) return 'm half'
  return 'm'
}

/** Kreslí se tenhle tvar vůbec? Zatím jen srdce, které jinde nemá co dělat. */
function shows(id: MuscleId): boolean {
  return primary.value.has(id) || secondary.value.has(id)
}

const names = (ids: MuscleId[]): string => ids.map((id) => MUSCLE_LABELS[id]).join(', ')

/**
 * Popis pro čtečku obrazovky. Obrázek sám o sobě neřekne nic, tak řekne
 * všechno tenhle text – a je to ta samá informace, jakou vidí oko.
 */
const label = computed(() => {
  const parts = [`Zatěžuje hlavně: ${names(props.muscles.primary)}`]
  if (props.muscles.secondary.length) parts.push(`vedle toho ${names(props.muscles.secondary)}`)
  return `${parts.join(', ')}.`
})

/**
 * Střed obou postav na plátně. Souřadnice tvarů níž jsou vůči středu těla,
 * takže se levá a pravá polovina dají zrcadlit jedním znaménkem.
 */
const FRONT_X = 40
const BACK_X = 112

/**
 * Silueta těla ve stoji čelem k divákovi.
 *
 * Kreslí se stejným strojkem jako postavička u cviku (`limbPath`), aby to
 * byl zjevně tentýž člověk – jen jednou v pohybu a jednou při výkladu. Než
 * to byl slepenec elips, vypadaly ty dva obrázky vedle sebe jako dvě různé
 * appky.
 *
 * Souřadnice jsou vůči středu těla, takže se pravá a levá polovina liší
 * jen znaménkem.
 */
function side(sx: number): { arm: string; leg: string } {
  const at = (x: number, y: number): Point => [sx * x, y]
  return {
    arm: `${limbPath([at(17.5, 34), at(23, 62), at(26, 88)], [12, 9.5, 7])} ${blobPath(at(26.5, 92), 5)}`,
    leg: limbPath([at(8.5, 92), at(8.5, 130), at(8.5, 162), at(14, 168)], [18, 13, 9, 8]),
  }
}

const SIDES = [side(-1), side(1)]
</script>

<template>
  <figure class="wrap">
    <svg class="map" viewBox="0 0 152 182" role="img" :aria-label="label" :style="{ '--tone': tone }">
      <!-- Dvakrát totéž tělo, jen s jinou sadou svalů. `g` s posunem je
           levnější než druhá sada souřadnic – a hlavně se nemůžou rozejít. -->
      <g v-for="side in (['front', 'back'] as const)" :key="side" :transform="`translate(${side === 'front' ? FRONT_X : BACK_X} 0)`">
        <!-- Silueta. Kreslí se první, svaly leží na ní. -->
        <g class="body">
          <path v-for="(part, i) in SIDES" :key="`a${i}`" :d="part.arm" />
          <path v-for="(part, i) in SIDES" :key="`l${i}`" :d="part.leg" />
          <path
            d="M -19 34 Q -19 29.5 -13.5 29.5 L 13.5 29.5 Q 19 29.5 19 34 L 14 68 L 16.5 84 Q 16.5 94 10 94 L -10 94 Q -16.5 94 -16.5 84 L -14 68 Z"
          />
          <path :d="limbPath([[0, 24], [0, 14]], [8, 7])" />
          <path :d="blobPath([0, 13], 9)" />
        </g>

        <!-- Zepředu ------------------------------------------------- -->
        <template v-if="side === 'front'">
          <g v-for="sx in [-1, 1]" :key="sx">
            <ellipse :class="cls('ramena')" :cx="sx * 17.5" cy="36" rx="6" ry="7" />
            <ellipse :class="cls('prsa')" :cx="sx * 8" cy="43" rx="7.8" ry="6.2" />
            <ellipse :class="cls('biceps')" :cx="sx * 20.5" cy="50" rx="4.4" ry="9.5" />
            <ellipse :class="cls('sikme')" :cx="sx * 11" cy="63" rx="3.4" ry="10" />
            <ellipse :class="cls('ohybace-kycle')" :cx="sx * 7.5" cy="90" rx="6" ry="7" />
            <ellipse :class="cls('kvadriceps')" :cx="sx * 10" cy="112" rx="6" ry="17" />
            <ellipse :class="cls('adduktory')" :cx="sx * 2.6" cy="108" rx="2.8" ry="12" />
          </g>
          <!-- Přímý břišní: dva pruhy, ať to nevypadá jako jedna deska. -->
          <rect :class="cls('brisni')" x="-7" y="51" width="6.2" height="23" rx="3" />
          <rect :class="cls('brisni')" x="0.8" y="51" width="6.2" height="23" rx="3" />
          <!-- Hluboký střed sedí jako pás nízko kolem pasu – tam, kde ho
               při zpevnění cítíš. Nekreslí se pod břišní sval, kde by ho
               nikdo neviděl. -->
          <rect :class="cls('hluboky-stred')" x="-11.5" y="76" width="23" height="10" rx="5" />
          <!-- Srdce. U kardia je poctivější ukázat oběh než vybarvit náhodné
               svaly na nohou. Jinde se nekreslí vůbec: prázdné srdíčko na
               hrudi by vypadalo jako sval, který se dá procvičit. -->
          <path
            v-if="shows('srdce')"
            :class="cls('srdce')"
            d="M -4.4 42.4 a 2.8 2.8 0 0 1 5 -1.5 a 2.8 2.8 0 0 1 5 1.5 c 0 3.2 -5 6.3 -5 6.3 s -5 -3.1 -5 -6.3 Z"
          />
        </template>

        <!-- Zezadu -------------------------------------------------- -->
        <template v-else>
          <!-- Páteř. U rozhýbání je to jediné, co se opravdu cvičí. Kreslí se
               první, takže vzpřimovače po jejích stranách leží na ní. -->
          <rect :class="cls('patere')" x="-2.2" y="33" width="4.4" height="53" rx="2.2" />
          <g v-for="sx in [-1, 1]" :key="sx">
            <ellipse :class="cls('ramena')" :cx="sx * 17.5" cy="36" rx="6" ry="7" />
            <ellipse :class="cls('mezilopatkove')" :cx="sx * 7.5" cy="40" rx="6" ry="5" />
            <path
              :class="cls('siroky-zadovy')"
              :d="`M ${sx * 3.5} 46 L ${sx * 14} 44 Q ${sx * 15} 56 ${sx * 11.5} 66 L ${sx * 3.5} 69 Z`"
            />
            <ellipse :class="cls('triceps')" :cx="sx * 20.5" cy="50" rx="4.4" ry="9.5" />
            <rect :class="cls('vzprimovace')" :x="sx > 0 ? 2 : -7.6" y="54" width="5.6" height="30" rx="2.8" />
            <ellipse :class="cls('hyzde')" :cx="sx * 8" cy="90" rx="8" ry="7" />
            <ellipse :class="cls('hamstringy')" :cx="sx * 9" cy="114" rx="6.4" ry="17" />
            <ellipse :class="cls('lytka')" :cx="sx * 8.5" cy="148" rx="5.4" ry="13" />
          </g>
        </template>

        <text class="cap" x="0" y="180">{{ side === 'front' ? 'zepředu' : 'zezadu' }}</text>
      </g>
    </svg>

    <figcaption v-if="withLegend" class="tiny legend">
      <span class="strong">Hlavně:</span> {{ names(muscles.primary) }}<template
        v-if="muscles.secondary.length"
      >
        <br /><span class="faint">Vedle toho: {{ names(muscles.secondary) }}</span></template
      >
    </figcaption>
  </figure>
</template>

<style scoped>
.wrap {
  margin: 0;
}

.map {
  display: block;
  width: 100%;
  /* Menší než ukázka provedení: je to doplňující informace, ne hlavní
     obrázek stránky – a hlavně za ní má být vidět první krok postupu. */
  max-width: 258px;
  height: auto;
  margin: 0 auto;
}

/*
 * Silueta je pozadí, ne obsah – drží tvar, ale nemá na sebe tahat oči.
 *
 * Obrys má barvu karty, ne vlastní odstín: bez něj splyne paže s trupem
 * do jednoho beztvarého bloku, protože jsou to dvě plochy stejné barvy,
 * které se překrývají. Takhle mezi nimi zůstane mezera.
 */
.body,
.m {
  fill: var(--surface-3);
  stroke: var(--surface);
  stroke-width: 1.2;
  /* Obrys pod výplní, stejně jako u postavičky – paže se pak od trupu
     oddělí mezerou místo aby s ním splynula. */
  paint-order: stroke;
  stroke-linejoin: round;
}

.m.on {
  fill: var(--tone);
}

/*
 * Vedlejší svaly: ta samá barva, slabší výplň a obrys navíc. Jen slabší
 * výplň nestačí – na tmavém pozadí z ní vyjde blátivá skvrna, u které se
 * nepozná, jestli je zvýrazněná, nebo jen jinak nasvícená. Obrys to řekne
 * jednoznačně a přitom nekřičí tolik co plná barva.
 *
 * Jiný odstín schválně ne: vypadal by jako další skupina, ne jako menší
 * míra téhož.
 */
.m.half {
  fill: color-mix(in srgb, var(--tone) 30%, var(--surface-3));
  stroke: color-mix(in srgb, var(--tone) 72%, transparent);
  stroke-width: 1.4;
}

.cap {
  fill: var(--text-faint);
  font-size: 8px;
  text-anchor: middle;
  font-family: inherit;
}

.legend {
  margin-top: 8px;
  text-align: center;
  line-height: 1.5;
}
</style>
