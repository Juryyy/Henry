import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Konfigurace serveru končí `process.exit(1)`, když chybí klíče. Testy
    // je proto musí mít nastavené dřív, než se modul vůbec načte.
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
  },
})
