import base from './playwright.config'

/**
 * Konfigurace pro generátor obrázků do README. Je oddělená proto, že hlavní
 * sada si soubor `screenshots.spec.ts` schválně ignoruje – není to test.
 *
 *   npm run screenshots
 */
export default {
  ...base,
  testIgnore: undefined,
  testMatch: 'screenshots.spec.ts',
}
