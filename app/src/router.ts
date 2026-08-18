import {
  createRouter,
  createWebHashHistory,
  type RouteLocationNormalized,
  type RouteLocationRaw,
  type RouteRecordRaw,
} from 'vue-router'
import { state } from './stores/app'
import { stateReady } from './lib/sync'

/**
 * Hash historie schválně – appka takhle funguje i na GitHub Pages nebo
 * z jakéhokoli statického hostingu bez přepisovacích pravidel.
 */

const routes: RouteRecordRaw[] = [
  {
    path: '/start',
    name: 'start',
    component: () => import('./views/OnboardingView.vue'),
    meta: { title: 'Vítej', fullscreen: true, public: true },
  },
  {
    path: '/',
    name: 'dnes',
    component: () => import('./views/TodayView.vue'),
    meta: { title: 'Dnes' },
  },
  {
    path: '/cviceni',
    name: 'cviceni',
    component: () => import('./views/TrainView.vue'),
    meta: { title: 'Cvičení' },
  },
  {
    path: '/cviceni/:slot',
    name: 'blok',
    component: () => import('./views/BlockView.vue'),
    meta: { title: 'Blok', fullscreen: true },
  },
  {
    path: '/kroky',
    name: 'kroky',
    component: () => import('./views/StepsView.vue'),
    meta: { title: 'Kroky' },
  },
  {
    path: '/tyden',
    name: 'tyden',
    component: () => import('./views/WeekView.vue'),
    meta: { title: 'Týden' },
  },
  {
    path: '/pokrok',
    name: 'pokrok',
    component: () => import('./views/ProgressView.vue'),
    meta: { title: 'Pokrok' },
  },
  {
    path: '/cviky',
    name: 'cviky',
    component: () => import('./views/CatalogueView.vue'),
    meta: { title: 'Cviky' },
  },
  {
    path: '/cviky/:id',
    name: 'cvik',
    component: () => import('./views/ExerciseView.vue'),
    meta: { title: 'Cvik' },
  },
  {
    path: '/nastaveni',
    name: 'nastaveni',
    component: () => import('./views/SettingsView.vue'),
    meta: { title: 'Nastavení' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

/**
 * Kontaktní list ukázek u cviků. Pózy se dají posoudit jenom okem, takže
 * po jejich úpravě je potřeba je vidět všechny vedle sebe – klikat se přes
 * šestačtyřicet detailů nedá. Do produkčního buildu se tahle obrazovka
 * nedostane: `import.meta.env.DEV` vyhodí i ten dynamický import.
 */
if (import.meta.env.DEV) {
  routes.push({
    path: '/figury',
    name: 'figury',
    component: () => import('./views/FiguresView.vue'),
    meta: { title: 'Ukázky' },
  })
}

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(_to, _from, saved) {
    return saved ?? { top: 0 }
  },
})

/**
 * Kam uživatele pustit. `null` znamená „tam, kam šel“. Dokud neprojde úvodním
 * průvodcem, nemá smysl ho pouštět do appky – viděl by výchozí cíle, které
 * o něm nic neví.
 *
 * Je to funkce, ne jen tělo strážce, protože rozhodnutí padá dvakrát: při
 * navigaci a znovu ve chvíli, kdy dorazí data ze serveru. Opakovaná navigace
 * na tu samou adresu totiž strážce nespustí (router ji zahodí jako duplicitní),
 * takže by se rozhodnutí po synchronizaci nikdy neopravilo.
 */
export function guardDestination(to: RouteLocationNormalized): RouteLocationRaw | null {
  // Dokud nedoběhla první synchronizace, nevíme, jestli je uživatel nový,
  // nebo jen otevřel appku na novém zařízení. Rozhodnout se v tu chvíli
  // znamená poslat dlouholetého uživatele do průvodce, který by mu po
  // dokončení přepsal cíl, úroveň i datum začátku.
  if (!stateReady.value) return null

  const onboarded = !!state.settings.onboardedAt
  // Zpátky do průvodce se jít nedá. Znovu projitý průvodce by přepsal cíl,
  // úroveň i datum začátku – a tím shodil sérii i historii.
  if (to.name === 'start') return onboarded ? { path: '/' } : null
  if (to.meta.public) return null
  return onboarded ? null : { name: 'start' }
}

router.beforeEach((to) => guardDestination(to) ?? true)

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · Henry` : 'Henry'
})
