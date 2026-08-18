<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  passkeysAvailable,
  registrationOpen,
  serverReachable,
  signIn,
  signInWithFaceId,
  signUp,
} from '@/stores/auth'
import { autofillAvailable, PasskeyCancelled } from '@/lib/passkey'

/**
 * Přihlášení a založení účtu na jedné obrazovce.
 *
 * Registrace je otevřená jen do prvního účtu – ten si zakládá majitel serveru
 * hned po nasazení. Kdo přijde potom, potřebuje pozvánku.
 *
 * Hlavní cesta dovnitř je Face ID / Touch ID. Heslo zůstává jako druhá cesta:
 * účet se jím zakládá a je to záchrana pro nové zařízení nebo ztracený telefon.
 */
const mode = ref<'login' | 'register'>(registrationOpen.value ? 'register' : 'login')

const email = ref('')
const password = ref('')
const name = ref('')
const invite = ref('')

const busy = ref(false)
const passkeyBusy = ref(false)
const error = ref('')

const registering = computed(() => mode.value === 'register')
const needsInvite = computed(() => registering.value && !registrationOpen.value)

/** Klíčem se dá přihlásit, ne založit účet – ten musí nejdřív vzniknout. */
const showPasskey = computed(() => passkeysAvailable && !registering.value)

const canSubmit = computed(() => {
  if (!email.value.includes('@') || password.value.length < (registering.value ? 10 : 1)) return false
  if (needsInvite.value && !invite.value.trim()) return false
  return !busy.value && !passkeyBusy.value
})

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  error.value = ''
  try {
    if (registering.value) {
      await signUp({
        email: email.value.trim(),
        password: password.value,
        name: name.value.trim(),
        invite: invite.value.trim() || undefined,
      })
    } else {
      await signIn(email.value.trim(), password.value)
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function faceId(): Promise<void> {
  if (passkeyBusy.value) return
  passkeyBusy.value = true
  error.value = ''
  try {
    await signInWithFaceId()
  } catch (err) {
    // Zavřené okno s Face ID není chyba – člověk si to jen rozmyslel.
    if (!(err instanceof PasskeyCancelled)) error.value = (err as Error).message
  } finally {
    passkeyBusy.value = false
  }
}

/**
 * Nabídka klíče přímo v poli pro e-mail (conditional UI). Běží na pozadí
 * a čeká, jestli si člověk vybere; když ne, tiše skončí. Prohlížeč to musí
 * umět, jinak se to ani nespouští.
 */
let autofillStarted = false

async function startAutofill(): Promise<void> {
  if (autofillStarted || !passkeysAvailable || registering.value) return
  if (!(await autofillAvailable())) return
  autofillStarted = true
  try {
    await signInWithFaceId({ autofill: true })
  } catch {
    // Zrušení i přepnutí na tlačítko sem spadnou stejně – oboje je v pořádku.
  }
}

onMounted(startAutofill)
watch(registering, (yes) => {
  if (!yes) void startAutofill()
})

function switchMode(): void {
  mode.value = registering.value ? 'login' : 'register'
  error.value = ''
}
</script>

<template>
  <main class="gate">
    <div class="box">
      <div class="brand">
        <div class="logo" aria-hidden="true">🏃</div>
        <h1>Henry</h1>
        <p class="muted small">Kroky, core, protahování. A dluh, který se nedá utéct.</p>
      </div>

      <div v-if="!serverReachable" class="card warn">
        <strong class="small">Server neodpovídá.</strong>
        <p class="tiny muted" style="margin-top: 4px">
          Zkontroluj, jestli běží a jestli je dostupný přes HTTPS. Bez něj se přihlásit nedá.
        </p>
      </div>

      <form class="card stack-sm" @submit.prevent="submit">
        <div class="card-title" style="margin: 0">
          {{ registering ? (registrationOpen ? 'Založ si účet' : 'Účet na pozvánku') : 'Přihlášení' }}
        </div>

        <template v-if="showPasskey">
          <button
            class="btn btn-primary btn-block btn-lg"
            type="button"
            :disabled="passkeyBusy"
            @click="faceId"
          >
            {{ passkeyBusy ? 'Ověřuju…' : 'Přihlásit se přes Face ID' }}
          </button>
          <p class="tiny faint center" style="margin: 0">
            Funguje, jen když sis na tomhle zařízení klíč už nastavil.
          </p>
          <div class="divider"><span class="tiny faint">nebo heslem</span></div>
        </template>

        <p v-if="registering && registrationOpen" class="tiny faint">
          Tenhle server je čerstvě nasazený, takže první účet je tvůj. Další lidi pak pouštíš dál
          pozvánkou z nastavení. Face ID si zapneš hned potom v nastavení.
        </p>

        <input
          v-model="email"
          type="email"
          inputmode="email"
          placeholder="E-mail"
          :autocomplete="registering ? 'username' : 'username webauthn'"
          autocapitalize="off"
          autocorrect="off"
          required
        />

        <input
          v-model="password"
          type="password"
          :placeholder="registering ? 'Heslo (aspoň 10 znaků)' : 'Heslo'"
          :autocomplete="registering ? 'new-password' : 'current-password'"
          required
        />

        <input v-if="registering" v-model="name" type="text" placeholder="Jak ti má Henry říkat (nepovinné)" />

        <input
          v-if="needsInvite"
          v-model="invite"
          type="text"
          placeholder="Kód pozvánky"
          autocapitalize="off"
          autocorrect="off"
        />

        <p v-if="error" class="small c-danger">{{ error }}</p>

        <button
          class="btn btn-block btn-lg"
          :class="showPasskey ? 'btn-ghost' : 'btn-primary'"
          type="submit"
          :disabled="!canSubmit"
        >
          {{ busy ? 'Moment…' : registering ? 'Založit účet' : 'Přihlásit se' }}
        </button>

        <button v-if="!registrationOpen" class="btn btn-ghost btn-block btn-sm" type="button" @click="switchMode">
          {{ registering ? 'Už mám účet' : 'Mám pozvánku, chci účet' }}
        </button>
      </form>

      <p class="tiny faint center">
        Data jsou tvoje a leží na tvém serveru. Žádná analytika, žádné sdílení.
      </p>
    </div>
  </main>
</template>

<style scoped>
.gate {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: calc(var(--safe-top) + 24px) 18px calc(var(--safe-bottom) + 24px);
}

.box {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.brand {
  text-align: center;
  margin-bottom: 4px;
}

.logo {
  font-size: 2.5rem;
  line-height: 1;
  margin-bottom: 6px;
}

.brand h1 {
  margin: 0 0 4px;
  letter-spacing: -0.03em;
}

.card.warn {
  border-color: color-mix(in srgb, var(--warn) 45%, transparent);
  background: var(--warn-soft);
}

/* Čára s popiskem uprostřed – oddělí klíč od hesla. */
.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 0;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
</style>
