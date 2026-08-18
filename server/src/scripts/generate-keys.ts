/**
 * Vygeneruje klíče pro Web Push. Spustí se `npm run keys` a výstup se vloží
 * do `.env` v kořeni repozitáře.
 *
 * Nic jiného se nastavovat nemusí – přístup řeší účty, ne sdílený token,
 * a appku i API servíruje ten samý server, takže není kam zadávat adresu.
 */
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

console.log(`
# ─────────────────────────────────────────────────────────────
# Vlož do .env v kořeni repozitáře (do gitu to NEPATŘÍ).
#
# Vygeneruj je JEDNOU a pak už na ně nesahej: přegenerování
# zneplatní všechny existující odběry notifikací a každé
# zařízení se musí zaregistrovat znovu.
# ─────────────────────────────────────────────────────────────
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:tvuj@email.cz

# ─────────────────────────────────────────────────────────────
# Pak už jen:  docker compose up -d
# a otevři adresu serveru v prohlížeči – první účet je tvůj.
# Veřejný VAPID klíč si appka stáhne sama z /api/config.
# ─────────────────────────────────────────────────────────────
`)
