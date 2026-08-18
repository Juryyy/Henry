/**
 * Přihlašování.
 *
 * Dvě cesty dovnitř, každá pro jiného klienta:
 *
 *  1. **Cookie se sezením** – appka v prohlížeči. `httpOnly`, takže se k ní
 *     nedostane žádný skript, a `SameSite=Lax`, takže ji prohlížeč nepřipojí
 *     k požadavku z cizí stránky. To je zároveň obrana proti CSRF: cizí web
 *     sice může na server poslat POST, ale bez cookie.
 *  2. **Token v hlavičce** – Apple Shortcuts. Zkratka cookie neumí, takže
 *     tudy vede druhá cesta, vázaná na uživatele a kdykoli zrušitelná.
 *
 * Ověření běží **před** parsováním těla požadavku. Kdyby to bylo naopak,
 * kdokoli z internetu by nás mohl donutit alokovat paměť bez přihlášení.
 */

import type { NextFunction, Request, Response } from 'express'
import { config } from './config.js'
import { resolveApiToken, resolveSession, type User } from './users.js'

export const SESSION_COOKIE = 'henry_session'

declare module 'express-serve-static-core' {
  interface Request {
    /** Doplní `requireAuth`. */
    user?: User
    /** Otisk sezení – kvůli „odhlásit ostatní zařízení“. */
    sessionId?: string
  }
}

/* ------------------------------------------------------------------ */
/*  Cookies                                                            */
/* ------------------------------------------------------------------ */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      out[name] = part.slice(eq + 1).trim()
    }
  }
  return out
}

const NINETY_DAYS = 90 * 24 * 3_600

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: NINETY_DAYS * 1000,
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/' })
}

/* ------------------------------------------------------------------ */
/*  Middleware                                                         */
/* ------------------------------------------------------------------ */

function bearerToken(req: Request): string | undefined {
  const header = req.header('authorization')
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  const custom = req.header('x-henry-token')
  return custom?.trim() || undefined
}

export function sessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE]
}

/** Přihlášeného uživatele doplní do `req`, ale nikoho neodmítne. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const session = resolveSession(sessionToken(req))
  if (session) {
    req.user = session.user
    req.sessionId = session.sessionId
    next()
    return
  }
  const token = bearerToken(req)
  if (token) {
    const user = resolveApiToken(token)
    if (user) req.user = user
  }
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  attachUser(req, res, () => {
    if (!req.user) {
      res.status(401).json({ error: 'Nepřihlášeno.' })
      return
    }
    next()
  })
}

/* ------------------------------------------------------------------ */
/*  Omezení pokusů                                                     */
/* ------------------------------------------------------------------ */

/**
 * Jednoduchý čítač v paměti. Na appku pro pár lidí to stačí a nepotřebuje
 * to další závislost; po restartu serveru se počítadlo vynuluje, což je
 * u přihlašování přijatelné.
 */
const attempts = new Map<string, { count: number; until: number }>()

export interface LimitOptions {
  /** Kolik pokusů za okno. */
  max: number
  /** Délka okna v milisekundách. */
  windowMs: number
}

export function rateLimit({ max, windowMs }: LimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.path}|${req.ip ?? 'neznámá'}`
    const now = Date.now()
    const entry = attempts.get(key)

    if (!entry || entry.until <= now) {
      attempts.set(key, { count: 1, until: now + windowMs })
      next()
      return
    }

    entry.count++
    if (entry.count > max) {
      const seconds = Math.ceil((entry.until - now) / 1000)
      res.setHeader('Retry-After', String(seconds))
      res.status(429).json({ error: `Moc pokusů. Zkus to za ${seconds} s.` })
      return
    }
    next()
  }
}

/** Po úspěšném přihlášení nemá smysl držet napočítané pokusy. */
export function clearRateLimit(req: Request): void {
  attempts.delete(`${req.path}|${req.ip ?? 'neznámá'}`)
}

/** Jen pro testy. */
export function resetRateLimits(): void {
  attempts.clear()
}
