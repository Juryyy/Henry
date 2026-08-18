<script setup lang="ts">
import { computed, ref } from 'vue'
import { state, today } from '@/stores/app'
import { activeBlocks, blockConfig, buildBlock, defaultBlocks, FOCUS_LABELS, templateFor } from '@/lib/plan'
import type { BlockConfig, BlockFocus, BlockSlot } from '@/lib/types'

/**
 * Rozvržení dne.
 *
 * Tři pozice v dni, každá s vlastním názvem, ikonou, zaměřením a délkou.
 * Pozice se nemění ani při přejmenování – visí na ní zapsané odcvičené bloky,
 * časy notifikací i odkazy z nich. Proto se blok vypíná, nemaže: „cvičím jen
 * večer" znamená vypnutý první a druhý, ne posunutý třetí.
 */
const blocks = computed(() => state.settings.exercise.blocks)
const activeCount = computed(() => activeBlocks(state).length)
const open = ref<BlockSlot | null>(null)

const FOCUS_ORDER: BlockFocus[] = ['rozhybani', 'core', 'protazeni', 'kardio']
const MINUTES = [5, 10, 15, 20, 30]
const EMOJI = ['🌅', '💪', '🧘', '🔥', '☀️', '🌙', '🏃', '⚡', '🧗', '🫁']

function patch(slot: BlockSlot, changes: Partial<BlockConfig>): void {
  const index = blocks.value.findIndex((b) => b.slot === slot)
  if (index < 0) return
  const next = { ...blocks.value[index]!, ...changes }
  next.title = next.title.trim().slice(0, 30) || templateFor(next.focus).title
  // Razítko pro synchronizaci nasadí hlídač nastavení ve storu – tady stačí
  // hodnotu zapsat.
  blocks.value[index] = next
}

/** Poslední zapnutý blok se vypnout nedá – den bez cvičení nemá co plánovat. */
function canDisable(slot: BlockSlot): boolean {
  return !blockConfig(state, slot).enabled || activeCount.value > 1
}

function toggle(block: BlockConfig): void {
  if (block.enabled && !canDisable(block.slot)) return
  patch(block.slot, { enabled: !block.enabled })
}

function resetBlocks(): void {
  state.settings.exercise.blocks = defaultBlocks()
  open.value = null
}

/**
 * Kolik minut plán opravdu vyjde. Nemusí to sedět s nastavenou délkou:
 * u protahování se přes ~4 minuty na svalovou skupinu a sezení rozsah už
 * nezvětšuje (Ingram et al. 2024), takže se blok radši nedoplní do sytosti,
 * než aby přidával minuty, ze kterých nic není.
 *
 * Počítá se pro všechny bloky najednou, ne v šabloně: jinak by se to samé
 * sestavení plánu volalo několikrát na jeden blok jen proto, že se výsledek
 * potřebuje na třech místech.
 */
const planned = computed(() =>
  new Map(blocks.value.map((b) => [b.slot, Math.round(buildBlock(state, today.value, b.slot).totalSeconds / 60)])),
)

const plannedMinutes = (block: BlockConfig): number => planned.value.get(block.slot) ?? block.minutes

/** Vejde se do bloku to, co si člověk nastavil? */
const fallsShort = (block: BlockConfig): boolean => plannedMinutes(block) < block.minutes - 2

const summary = (block: BlockConfig): string => {
  const length = fallsShort(block)
    ? `${block.minutes} min, plán vyjde na ${plannedMinutes(block)}`
    : `${block.minutes} min`
  return `${FOCUS_LABELS[block.focus]} · ${length}`
}
</script>

<template>
  <div class="stack-sm">
    <p class="tiny faint" style="margin: 0">
      Tři pozice v dni. Každou si pojmenuješ, vybereš jí zaměření a délku – nebo ji vypneš.
      Cvičit jen večer je legitimní plán.
    </p>

    <ul class="list-reset stack-sm">
      <li v-for="block in blocks" :key="block.slot" class="block" :class="{ off: !block.enabled }">
        <div class="head">
          <label class="toggle grow">
            <input
              type="checkbox"
              :checked="block.enabled"
              :disabled="!canDisable(block.slot)"
              @change="toggle(block)"
            />
            <span>
              <span class="emoji" aria-hidden="true">{{ block.emoji }}</span>
              {{ block.title }}
              <span class="tiny faint block-hint">{{ summary(block) }}</span>
            </span>
          </label>
          <button
            class="btn btn-sm btn-ghost"
            :aria-expanded="open === block.slot"
            :aria-label="`Upravit blok ${block.title}`"
            @click="open = open === block.slot ? null : block.slot"
          >
            {{ open === block.slot ? 'Hotovo' : 'Upravit' }}
          </button>
        </div>

        <div v-if="open === block.slot" class="body stack-sm">
          <div class="field">
            <label :for="`bt-${block.slot}`">Název</label>
            <input
              :id="`bt-${block.slot}`"
              type="text"
              :value="block.title"
              maxlength="30"
              @change="patch(block.slot, { title: ($event.target as HTMLInputElement).value })"
            />
          </div>

          <div class="field">
            <label>Ikona</label>
            <div class="chips">
              <button
                v-for="option in EMOJI"
                :key="option"
                class="emoji-btn"
                type="button"
                :class="{ on: block.emoji === option }"
                :aria-pressed="block.emoji === option"
                :aria-label="`Ikona ${option}`"
                @click="patch(block.slot, { emoji: option })"
              >
                {{ option }}
              </button>
            </div>
          </div>

          <div class="field">
            <label>Zaměření</label>
            <div class="chips">
              <button
                v-for="focus in FOCUS_ORDER"
                :key="focus"
                class="chip"
                type="button"
                :class="{ on: block.focus === focus }"
                :aria-pressed="block.focus === focus"
                @click="patch(block.slot, { focus })"
              >
                {{ FOCUS_LABELS[focus] }}
              </button>
            </div>
            <div class="hint">
              Rozhodne, z jakých cviků se blok skládá. Ranní rozhýbání navíc vynechává cviky,
              kde se pod zátěží ohýbá bedra – po probuzení jsou ploténky nasáklé vodou.
            </div>
          </div>

          <div class="field">
            <label>Délka</label>
            <div class="chips">
              <button
                v-for="m in MINUTES"
                :key="m"
                class="chip"
                type="button"
                :class="{ on: block.minutes === m }"
                :aria-pressed="block.minutes === m"
                :aria-label="`${m} minut`"
                @click="patch(block.slot, { minutes: m })"
              >
                {{ m }} min
              </button>
            </div>
            <div v-if="fallsShort(block)" class="hint">
              Z {{ block.minutes }} minut vyjde plán na {{ plannedMinutes(block) }}. Delší blok tuhle
              práci neudělá lépe – u protahování se přes zhruba čtyři minuty na svalovou skupinu
              rozsah už nezvětšuje a série navíc by byly jen čas. Zkus jinou délku, nebo si přidej
              druhý blok s jiným zaměřením.
            </div>
          </div>

          <p v-if="!canDisable(block.slot)" class="tiny faint">
            Tenhle blok vypnout nejde – aspoň jeden musí zůstat, jinak by nebylo co plánovat.
          </p>
        </div>
      </li>
    </ul>

    <button class="btn btn-sm btn-ghost" type="button" @click="resetBlocks">Výchozí rozvržení</button>
  </div>
</template>

<style scoped>
.block {
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  background: var(--surface-2);
}

.block.off {
  opacity: 0.62;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.emoji {
  margin-right: 4px;
}

.block-hint {
  display: block;
}

.body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
</style>
