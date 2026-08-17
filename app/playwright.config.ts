import { defineConfig, devices } from '@playwright/test'

/**
 * E2E testy jedou proti produkčnímu buildu, ne proti dev serveru – zajímá
 * nás appka tak, jak ji uvidí telefon, včetně service workeru.
 *
 * Prohlížeč je předinstalovaný v obrazu; cesta se dá přebít proměnnou
 * CHROME_PATH, když si to někdo pouští u sebe.
 */
const executablePath = process.env.CHROME_PATH || undefined

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],

  use: {
    baseURL: 'http://127.0.0.1:4173/',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      // Kontejnery běží pod rootem a Chromium tam bez tohohle vůbec nenastartuje.
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },

  projects: [
    {
      name: 'iphone',
      use: {
        ...devices['iPhone 14'],
        // Popis iPhonu si jinak vyžádá WebKit, který v obrazu není.
        // Testuje se rozměr a dotyk, ne konkrétní engine.
        browserName: 'chromium',
        colorScheme: 'dark',
      },
    },
  ],

  webServer: {
    command: 'npm run build:only && npx vite preview --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
