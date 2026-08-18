import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'

// `.env` leží v kořeni repozitáře (odtud ho bere i docker compose), ale
// `npm run dev` se pouští z `server/`. Načte se proto obojí; dotenv už
// nastavené proměnné nepřepisuje, takže na pořadí nezáleží.
loadEnv()
loadEnv({ path: resolve(process.cwd(), '../.env') })

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(
      `\n[henry] Chybí proměnná prostředí ${name}.\n` +
        `Vygeneruj klíče příkazem:  npm run keys\n` +
        `a zkopíruj výstup do .env (vzor je v .env.example).\n`,
    )
    process.exit(1)
  }
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',

  /** Časové pásmo, ve kterém se vyhodnocují časy připomínek. */
  timezone: process.env.TZ_NAME ?? 'Europe/Prague',

  vapid: {
    publicKey: required('VAPID_PUBLIC_KEY', process.env.VAPID_PUBLIC_KEY),
    privateKey: required('VAPID_PRIVATE_KEY', process.env.VAPID_PRIVATE_KEY),
    /** mailto: adresa – vyžadují ji push služby pro kontakt při problému. */
    subject: process.env.VAPID_SUBJECT ?? 'mailto:henry@example.com',
  },

  /** Databáze: účty, data uživatelů i provozní stav serveru. */
  dbFile: resolve(process.env.DB_FILE ?? './data/henry.sqlite'),

  /** Odkud se servíruje appka. Prázdné = server je jen API. */
  appDir: process.env.APP_DIR ?? '../app/dist',

  /**
   * Cookie se sezením se posílá jen po HTTPS. Na localhostu při vývoji to
   * nejde, proto přepínač – v produkci musí zůstat zapnutý.
   */
  secureCookies: process.env.SECURE_COOKIES !== 'off',

  /** Povolené originy pro CORS. '*' = cokoli (appka běží na tvé doméně / Pages). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),

  /** Vypnutí plánovače (hodí se při ladění). */
  schedulerEnabled: process.env.SCHEDULER !== 'off',
} as const

export type Config = typeof config
