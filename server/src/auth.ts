import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { config } from './config.js'

/**
 * Porovnání odolné vůči časovému útoku.
 *
 * Obě strany se nejdřív zahašují, takže mají vždy stejnou délku. Kdyby se
 * porovnávaly rovnou, `timingSafeEqual` by na různých délkách vyhodilo výjimku –
 * a už to, že vyhodila, by prozradilo délku tokenu.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * Token se čte jen z hlaviček. Do query stringu schválně nepatří – URL
 * se propisují do logů proxy i do hlavičky Referer.
 *
 *   Authorization: Bearer <token>   (doporučené, umí to i Apple Shortcuts)
 *   X-Henry-Token: <token>          (záloha)
 */
function extractToken(req: Request): string | null {
  const auth = req.header('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  const header = req.header('x-henry-token')
  if (header) return header.trim()
  return null
}

/**
 * Ověřuje se PŘED parsováním těla požadavku. Kdyby to bylo naopak, kdokoli
 * z internetu by nás mohl donutit alokovat megabajty paměti bez přihlášení.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req)
  if (!token || !safeEqual(token, config.token)) {
    res.status(401).json({ error: 'Neplatný token.' })
    return
  }
  next()
}
