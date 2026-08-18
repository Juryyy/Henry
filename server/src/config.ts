import 'dotenv/config'
import { resolve } from 'node:path'

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

  /** Sdílený token. Posílá ho appka i Apple Shortcut v hlavičce Authorization: Bearer …. */
  token: required('HENRY_TOKEN', process.env.HENRY_TOKEN),

  vapid: {
    publicKey: required('VAPID_PUBLIC_KEY', process.env.VAPID_PUBLIC_KEY),
    privateKey: required('VAPID_PRIVATE_KEY', process.env.VAPID_PRIVATE_KEY),
    /** mailto: adresa – vyžadují ji push služby pro kontakt při problému. */
    subject: process.env.VAPID_SUBJECT ?? 'mailto:henry@example.com',
  },

  /** Provozní stav serveru: odběry, rozvrh, co už dnes odešlo. */
  dataFile: resolve(process.env.DATA_FILE ?? './data/db.json'),

  /** Synchronizovaná data uživatele (dny, měření, úkoly). SQLite. */
  syncFile: resolve(process.env.SYNC_FILE ?? './data/henry.sqlite'),

  /** Povolené originy pro CORS. '*' = cokoli (appka běží na tvé doméně / Pages). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),

  /** Vypnutí plánovače (hodí se při ladění). */
  schedulerEnabled: process.env.SCHEDULER !== 'off',
} as const

export type Config = typeof config
