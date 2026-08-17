/**
 * Vygeneruje VAPID klíčový pár a náhodný token.
 * Spustí se `npm run keys` a výstup se zkopíruje do `.env`.
 */
import { randomBytes } from 'node:crypto'
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
const token = randomBytes(24).toString('base64url')

console.log(`
# ─────────────────────────────────────────────────────────────
# Zkopíruj do server/.env  (a NIKDY to necommituj)
# ─────────────────────────────────────────────────────────────
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:tvuj@email.cz
HENRY_TOKEN=${token}
TZ_NAME=Europe/Prague
PORT=8080
DATA_FILE=./data/db.json
CORS_ORIGINS=*

# ─────────────────────────────────────────────────────────────
# Do appky (Nastavení → Server) zadej:
#   URL serveru: https://…tvoje-adresa…
#   Token:       ${token}
# Veřejný VAPID klíč si appka stáhne sama z /api/config.
# ─────────────────────────────────────────────────────────────
`)
