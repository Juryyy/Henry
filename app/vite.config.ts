import { fileURLToPath, URL } from 'node:url'
// vitest/config je nadmnožina vite/config – přidává klíč `test`.
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * `base` je potřeba nastavit, když se appka hostuje v podadresáři
 * (typicky GitHub Pages: https://uzivatel.github.io/henry/).
 * Nastav proměnnou prostředí BASE_PATH při buildu.
 */
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [
    vue(),
    VitePWA({
      // injectManifest = píšeme si vlastní service worker (kvůli push notifikacím),
      // Workbox do něj jen vloží seznam souborů k předcachování.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        // `id` musí odpovídat scope – jinak by se dvě PWA na stejné doméně
        // (typicky víc projektů na GitHub Pages) tvářily jako jedna appka.
        id: base,
        name: 'Henry – tvůj otravný trenér',
        short_name: 'Henry',
        description: 'Kroky, core, protahování a týdenní úkoly. S dluhem, který se nedá utéct.',
        lang: 'cs',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        categories: ['health', 'fitness', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Zapsat kroky', short_name: 'Kroky', url: `${base}#/kroky` },
          { name: 'Spustit blok', short_name: 'Cvičit', url: `${base}#/cviceni` },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
