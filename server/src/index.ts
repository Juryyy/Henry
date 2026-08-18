/**
 * Start serveru. Samotné routy žijí v `app.ts`, aby se daly testovat
 * bez toho, aby se při importu otevřel port a rozjel plánovač.
 */

import { app } from './app.js'
import { config } from './config.js'
import { startScheduler } from './scheduler.js'
import { loadDb, persist } from './store.js'

loadDb()

const server = app.listen(config.port, config.host, () => {
  console.log(`[henry] server běží na http://${config.host}:${config.port} (${config.timezone})`)
  if (config.schedulerEnabled) startScheduler()
  else console.log('[henry] plánovač je vypnutý (SCHEDULER=off)')
})

function shutdown(signal: string): void {
  console.log(`[henry] ${signal} – ukládám a končím`)
  persist(true)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Pojistka: jednou za 5 minut uložit i bez signálu.
setInterval(() => persist(), 5 * 60 * 1000).unref()
