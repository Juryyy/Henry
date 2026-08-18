/**
 * Start serveru. Samotné routy žijí v `app.ts`, aby se daly testovat
 * bez toho, aby se při importu otevřel port a rozjel plánovač.
 */

import { app } from './app.js'
import { config } from './config.js'
import { startScheduler } from './scheduler.js'
import { openDb } from './db.js'
import { purgeExpired, userCount } from './users.js'

// Otevřít hned při startu, ať se případný problém s úložištěm projeví teď
// a ne až při prvním požadavku.
openDb()
purgeExpired()

const server = app.listen(config.port, config.host, () => {
  console.log(`[henry] server běží na http://${config.host}:${config.port} (${config.timezone})`)
  if (userCount() === 0) {
    console.log('[henry] zatím tu není žádný účet – první založíš rovnou v appce')
  }
  if (config.schedulerEnabled) startScheduler()
  else console.log('[henry] plánovač je vypnutý (SCHEDULER=off)')
})

function shutdown(signal: string): void {
  console.log(`[henry] ${signal} – končím`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Jednou denně úklid propadlých sezení a pozvánek.
setInterval(() => purgeExpired(), 24 * 3_600_000).unref()
