# Server na Raspberry Pi

Appka funguje i bez serveru, ale dvě věci bez něj nejdou:

- **notifikace v naplánovaný čas při zavřené appce** – ty musí spustit něco,
  co v ten čas běží jinde než v telefonu,
- **data mimo telefon** – záloha, která přežije výměnu telefonu, a společná
  data mezi telefonem a notebookem.

Tady je návod, jak to „něco" rozjet na Raspberry.

Zvládne to i Pi Zero 2 W. Server je jeden Node proces, který devadesát devět
procent času spí a jednou za minutu se podívá na hodinky.

---

## 1. Co budeš potřebovat

- Raspberry Pi s 64bitovým systémem (Raspberry Pi OS Lite bohatě stačí),
- síť a nějakou formu přístupu (SSH),
- **veřejnou HTTPS adresu** – bez ní push nefunguje a iOS navíc odmítne
  self-signed certifikát s nicneříkající chybou. Jak na ni zadarmo a bez
  vlastní domény je v kroku 5.

---

## 2. Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Odhlas se a přihlas znovu, ať se skupina projeví.
```

---

## 3. Stáhnout a nastavit

```bash
git clone https://github.com/Juryyy/Henry.git
cd Henry/server

# Vygeneruje VAPID klíče a náhodný token.
docker run --rm -v "$PWD":/app -w /app node:22-alpine sh -c "npm ci --silent && npm run keys"
```

Výstup zkopíruj do `.env`:

```bash
cp .env.example .env
nano .env
```

Vyplň `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (tvůj e-mail)
a `HENRY_TOKEN`.

> **VAPID klíče vygeneruj jednou a pak už na ně nesahej.** Přegenerování
> zneplatní všechny existující odběry a telefon se musí registrovat znovu.
>
> `.env` do gitu nepatří (je v `.gitignore`). Token je jediné, co server
> chrání – zacházej s ním jako s heslem.

---

## 4. Spustit

```bash
docker compose up -d
docker compose logs -f
```

Ověření zevnitř sítě:

```bash
curl http://localhost:8080/api/health
```

Musí odpovědět `{"ok":true,...}`. `restart: unless-stopped` v compose souboru
zařídí, že se server po restartu Raspberry nahodí sám.

---

## 5. Veřejná HTTPS adresa

### Varianta A: Tailscale Funnel (bez vlastní domény, doporučeno)

Zdarma, stabilní adresa, a hlavně **nemusíš otevírat žádný port na routeru** –
Raspberry zůstane zvenčí neviditelné a ven vede jen ta jedna služba.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale funnel --bg 8080
```

Poslední příkaz vypíše adresu ve tvaru
`https://raspberry.tvuj-tailnet.ts.net/`. Když si Tailscale postěžuje, že
Funnel nebo HTTPS certifikáty nejsou v tailnetu povolené, vypíše k tomu rovnou
odkaz do administrace – zapnout a zopakovat.

Zkouška z telefonu na mobilních datech (ne přes Wi-Fi doma):
`https://raspberry.tvuj-tailnet.ts.net/api/health`

### Varianta B: Cloudflare Tunnel (když máš vlastní doménu na Cloudflare)

```bash
curl -fsSL https://pkg.cloudflare.com/install.sh | sudo bash
sudo apt install cloudflared
cloudflared tunnel login
cloudflared tunnel create henry
cloudflared tunnel route dns henry henry.tvojedomena.cz
cloudflared tunnel run --url http://localhost:8080 henry
```

Aby to jelo i po restartu: `sudo cloudflared service install`.

### Co nedělat

Přesměrování portu na routeru plus vlastní certifikát je práce navíc a vystaví
Raspberry celému internetu. Oba tunely výše jsou zdarma a bezpečnější.

---

## 6. Propojit s appkou

V appce na telefonu: **Nastavení → Server**

1. Adresa serveru: `https://raspberry.tvuj-tailnet.ts.net` (bez lomítka na konci).
2. Token: ten z `.env`.
3. **Otestovat spojení** – musí napsat, že server odpovídá.
4. **Zapnout notifikace** – iOS se zeptá na povolení.
5. **Test ze serveru** – za chvíli to musí cinknout.
6. **Synchronizovat** – od téhle chvíle se data drží i mimo telefon. Na dalším
   zařízení stačí vyplnit tutéž adresu a token a data se stáhnou sama.

> Notifikace na iPhonu fungují **jen** když je appka přidaná na plochu
> a spuštěná z ikony, ne z karty v Safari. V Safari objekt `Notification`
> na iOS vůbec neexistuje.

---

## 7. Provoz

**Aktualizace na novou verzi:**

```bash
cd Henry && git pull
cd server && docker compose up -d --build
```

**Záloha dat serveru.** Server drží dva soubory: `db.json` (odběry notifikací,
rozvrh) a `henry.sqlite` (**tvoje data** – dny, cvičení, úkoly, míry). Ten druhý
je ten, o který nechceš přijít:

```bash
docker compose cp henry:/app/data/henry.sqlite ./henry-zaloha.sqlite
docker compose cp henry:/app/data/db.json ./db-zaloha.json
```

Server si navíc po každé synchronizaci sám odkládá posledních třicet verzí
stavu – vrátit se k nim jde přímo v appce (Nastavení → Verze na serveru).

**Co se děje:**

```bash
docker compose logs --tail 50
curl -H "Authorization: Bearer TVUJ_TOKEN" https://tvoje-adresa/api/log
```

**Ruční kopnutí do plánovače** (jinak si tikne sám každou minutu):

```bash
curl -X POST -H "Authorization: Bearer TVUJ_TOKEN" https://tvoje-adresa/api/tick
```

---

## 8. Kroky z Apple Health

Až bude server běžet, dává smysl nastavit i automatické přebírání kroků –
návod je v **[apple-health.md](apple-health.md)**. Do té doby si kroky zapisuješ
v appce ručně, což je jeden ťuk denně.

---

## Když to nechodí

| Projev | Kde hledat |
|---|---|
| Appka hlásí, že server neodpovídá | Sedí adresa i token? Adresa musí být `https://` a bez lomítka na konci. |
| Spojení funguje, ale notifikace nechodí | Je appka spuštěná z ikony na ploše? V Safari to nepojede. |
| Test ze serveru projde, naplánované ne | Sedí `TZ_NAME` v `.env`? A necinkl už dnes denní limit čtyř notifikací se zvukem? |
| Po přeinstalaci appky nic nechodí | Odběr zanikl s appkou. Stačí v Nastavení znovu **Zapnout notifikace**. |
| Konkrétní připomínka přestala chodit | Když ji třikrát po sobě ignoruješ, server ji na dva dny ztlumí. Sama se vrátí. |
