<script setup lang="ts">
import { EXERCISES } from '@/data/exercises'
import { FIGURES } from '@/data/figures'
import ExerciseFigure from '@/components/ExerciseFigure.vue'

/**
 * Kontaktní list všech postaviček. **Jen pro vývoj** – router tuhle
 * obrazovku v produkčním buildu vůbec nezaregistruje.
 *
 * Souřadnice pózy se dají posoudit jedině okem. Testy uhlídají, že nic
 * nevyčnívá z plátna a že se končetiny neutrhly, ale jestli to vypadá jako
 * boční prkno, nebo jako rozsypaný čaj, se ověřit nedá jinak než podívat se.
 * Proto tahle stránka: po úpravě pózy nebo přidání cviku si projdeš všech
 * šestačtyřicet vedle sebe místo klikání po detailech.
 *
 * Vlevo statická cílová poloha (to, co se kreslí v seznamech), vpravo
 * rozhýbaná – ať je vidět obojí.
 */
const items = EXERCISES.map((exercise) => ({
  exercise,
  figure: FIGURES[exercise.id] ?? null,
}))
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">jen pro vývoj · {{ items.length }} cviků</div>
        <h1>Ukázky provedení</h1>
      </div>
    </header>

    <p class="tiny faint">
      Levý obrázek je statická poloha ze seznamů, pravý se hýbe. Chybějící obrázek se pozná podle
      prázdného místa – testy ho odhalí taky, ale tady je vidět hned.
    </p>

    <ul class="list-reset grid">
      <li v-for="{ exercise, figure } in items" :key="exercise.id" class="card cell">
        <div class="pair">
          <ExerciseFigure :figure="figure" :category="exercise.category" />
          <ExerciseFigure :figure="figure" :category="exercise.category" animated />
        </div>
        <div class="small strong">{{ exercise.name }}</div>
        <div class="tiny faint mono">{{ exercise.id }}</div>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}

.cell {
  padding: 8px 10px 10px;
}

.pair {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.pair > * {
  flex: 1;
  min-width: 0;
  background: var(--bg-soft);
  border-radius: var(--r-sm);
}
</style>
