import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

/**
 * Hash historie schválně – appka takhle funguje i na GitHub Pages nebo
 * z jakéhokoli statického hostingu bez přepisovacích pravidel.
 */

const routes: RouteRecordRaw[] = [
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

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(_to, _from, saved) {
    return saved ?? { top: 0 }
  },
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · Henry` : 'Henry'
})
