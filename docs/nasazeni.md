# Nasazení

Henry je jedna aplikace: server servíruje i appku, takže všechno běží z jedné
adresy. Poběží na Raspberry Pi i na nejmenším VPS – je to jeden Node proces,
který devadesát devět procent času spí a jednou za minutu se podívá na hodinky.

Bez serveru appka nefunguje: přihlášení, data mimo telefon i naplánované
notifikace potřebují něco, co běží nonstop jinde než v telefonu.

---

## 1. Co budeš potřebovat

- Raspberry Pi (stačí Zero 2 W) nebo malý VPS s 64bitovým systémem,
- Docker,
- **veřejnou HTTPS adresu** – bez ní nefunguje push ani přihlašovací cookie
  a iOS navíc odmítne self-signed certifikát s nicneříkající chybou.
  Jak na ni zadarmo a bez vlastní domény je v kroku 4.

---

## 2. Instalace

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Odhlas se a přihlas znovu, ať se skupina projeví.

git clone https://github.com/Juryyy/Henry.git
cd Henry
```

Vygeneruj klíče pro notifikace a vlož je do `.env`:

```bash
docker run --rm -v "$PWD/server":/app -w /app node:22-alpine \
  sh -c "npm ci --silent && npm run keys"

cp .env.example .env
nano .env    # vyplň VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY a VAPID_SUBJECT
```

> **VAPID klíče vygeneruj jednou a pak už na ně nesahej.** Přegenerování
> zneplatní všechny existující odběry a každé zařízení se musí registrovat znovu.
>
> Žádný sdílený token se tu nenastavuje – přístup řeší účty.

---

## 3. Spustit

```bash
docker compose up -d
docker compose logs -f
```

Ověření zevnitř sítě:

```bash
curl http://localhost:8080/api/health
```

Musí odpovědět `{"ok":true,…,"registrationOpen":true}`. To `true` na konci
znamená, že tam ještě není žádný účet a první registrace je otevřená.
`restart: unless-stopped` zařídí, že se server po restartu nahodí sám.

---

## 4. Veřejná HTTPS adresa

### Varianta A: Tailscale Funnel (bez vlastní domény, doporučeno)

Zdarma, stabilní adresa, a hlavně **nemusíš otevírat žádný port na routeru** –
stroj zůstane zvenčí neviditelný a ven vede jen ta jedna služba.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale funnel --bg 8080
```

Poslední příkaz vypíše adresu ve tvaru `https://raspberry.tvuj-tailnet.ts.net/`.
Když si Tailscale postěžuje, že Funnel nebo HTTPS certifikáty nejsou v tailnetu
povolené, vypíše k tomu rovnou odkaz do administrace – zapnout a zopakovat.

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

### Varianta C: VPS s vlastní doménou

Před Henryho postav Caddy – certifikát si vyřídí sám:

```
henry.tvojedomena.cz {
    reverse_proxy localhost:8080
}
```

### Co nedělat

Přesměrování portu na routeru s vlastním certifikátem je práce navíc a vystaví
stroj celému internetu. Tunely výše jsou zdarma a bezpečnější.

> Kdybys server provozoval bez HTTPS (jen v místní síti při ladění),
> přihlašovací cookie neprojde – pak nastav `SECURE_COOKIES=off`.
> **V produkci to nechej zapnuté.**

---

## 5. První účet

Otevři adresu v prohlížeči. Protože tam ještě žádný účet není, appka rovnou
nabídne **založení prvního účtu** – ten je tvůj a tím se registrace zavře.
Kdo se má dostat dovnitř potom, potřebuje pozvánku (Nastavení → Účet →
Pozvat někoho dalšího). Kód platí týden a jen na jedno použití.

Na iPhonu:

1. Otevři adresu v **Safari** (ne v Chromu – ten na iOS neumí přidat PWA tak,
   aby fungovaly notifikace).
2. Sdílet → **Přidat na plochu**.
3. Spusť appku **z ikony**, ne ze Safari, a přihlas se.
4. Nastavení → Notifikace → **Zapnout notifikace** → **Test ze serveru**.

Notifikace na iPhonu fungují **jen** z ikony na ploše. V Safari na kartě objekt
`Notification` na iOS vůbec neexistuje.

---

## 6. Provoz

**Aktualizace na novou verzi:**

```bash
cd Henry && git pull && docker compose up -d --build
```

**Záloha.** Všechno je v jednom souboru – účty, data i odběry notifikací:

```bash
docker compose cp henry:/app/data/henry.sqlite ./henry-zaloha.sqlite
```

Server si navíc po každé synchronizaci sám odkládá posledních třicet verzí
dat, ke kterým se dá vrátit přímo z appky (Nastavení → Verze na serveru).

**Co se děje:**

```bash
docker compose logs --tail 50
```

**Ruční kopnutí do plánovače** (jinak si tikne sám každou minutu):

```bash
curl -X POST -H "Authorization: Bearer TOKEN_ZE_ZKRATKY" https://tvoje-adresa/api/tick
```

---

## 7. Kroky z Apple Health

Návod je v **[apple-health.md](apple-health.md)**. Token si vygeneruješ
v Nastavení → Účet → Token pro Zkratku – Zkratka neumí přihlášení cookie,
takže potřebuje vlastní klíč. Zobrazí se jednou a dá se kdykoli zrušit.

---

## Když to nechodí

| Projev | Kde hledat |
|---|---|
| Appka se pořád ptá na přihlášení | Běží to přes HTTPS? Bez něj prohlížeč cookie zahodí. |
| „Server neodpovídá" | Naběhl kontejner? `docker compose logs --tail 50`. |
| Přihlásím se, ale notifikace nechodí | Je appka spuštěná z ikony na ploše? V Safari to nepojede. |
| Test ze serveru projde, naplánované ne | Sedí `TZ_NAME`? A necinkl už dnes limit čtyř notifikací se zvukem? |
| Konkrétní připomínka přestala chodit | Když ji třikrát po sobě ignoruješ, server ji na dva dny ztlumí. Sama se vrátí. |
| Zapomenuté heslo | Účet je jen v tvé databázi. Nejrychlejší cesta: smazat řádek v tabulce `users` (`sqlite3 data/henry.sqlite`) a založit účet znovu – data zůstanou, jen se k nim bude muset nový účet nasynchronizovat z telefonu. |
