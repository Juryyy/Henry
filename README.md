# Henry

Osobní PWA na to, aby ses hýbal. Kroky s týdenním dluhem, třikrát denně patnáct
minut cvičení, týdenní úkoly a notifikace, které chodí i když je appka zavřená.

Zaměření: **zpevnit střed těla, zhubnout, dostat se rukama na zem.**

<!-- Obrázek sem přijde, až si appku nasadíš a uděláš screenshot. -->

---

## Co to umí

**Úvodní průvodce.** Při prvním spuštění se Henry zeptá, kolik chodíš *teď*,
a první cíl postaví jen o desetinu výš. Cíl nastavený od stolu je nejrychlejší
cesta k tomu appku po týdnu smazat.

**Kroky s dluhem.** Týden je jeden hrnec. Co v pondělí nedochodíš, se rozpustí
do zbytku týdne – denní porce se prostě zvedne. Co zbude v neděli, se přenese
do dalšího týdne, ale **jen do stropu dvou denních dávek**. Zbytek se odpustí.

Ten strop je tam schválně. Bez něj by ti po dvou zkažených týdnech naskočila
nesplatitelná hypotéka a appku bys smazal. S ním je nejhorší možný scénář
„příští týden dva dny navíc“, což je 1,3násobek běžného objemu – přesně horní
hranice pásma, které tělo bez problémů unese.

Když se to i tak nakupí, je tu **bankrot**: jedním klepnutím dluh na nulu,
jednou za třicet dní. Není to podvod, je to pojistka proti tomu appku smazat.

**Cíl, který roste sám.** Začínáš na 35 000 krocích týdně (5 000 denně).
Po každém splněném týdnu se laťka zvedne o 3 500 (+500 denně), až na 49 000
(7 000 denně). Po nesplněném týdnu se nezvedne – zvyšovat nároky někomu, komu
to zrovna nevyšlo, je nejjistější způsob, jak ho odradit.

**Tři bloky po patnácti minutách.** Každý má jinou práci:

| Blok | Kdy | Co | Proč |
|---|---|---|---|
| Ráno | 7:15 | rozhýbání páteře, dýchání, McGillova trojka | ploténky jsou po noci nasáklé vodou, ohýbat se pod zátěží je pro ně ráno nejhorší – proto tu nejsou sedy-lehy |
| Poledne | 12:30 | core naostro + jeden cvik na kyčle | přerušení sezení, které je ten hlavní problém |
| Večer | 20:00 | protahování se zaměřením na zadní stranu stehen | večer je rozsah pohybu největší a sval prohřátý |

Plán se každý den mírně obmění, kostra zůstává. Protažení hamstringů je každý
večer – rozsah roste z pravidelnosti, ne z toho, jak silně do toho jdeš.

**46 cviků** s postupem, chybami, lehčí i těžší variantou a poznámkou, kdy to
nedělat. Co se ti nelíbí nebo tě to bolí, vyřadíš a Henry to nahradí jiným.

**Série, která snese jeden špatný den.** Za každých sedm dní máš záchranu –
propadlý den ji spotřebuje, ale sérii neshodí. Teprve druhý propadlý den
v témže týdnu ji ukončí. Nemoc nebo služebku navíc označíš jako den odpočinku
a nepočítá se vůbec.

**Milníky** místo prázdných odznaků: první blok, sedm dní v řadě, 100 000 kroků,
minuta v prkně, půl cesty k zemi, dlaně na zemi. Odemykají se za věci, které
něco znamenají.

**Notifikace, které opravdu chodí.** Na iPhonu s appkou přidanou na plochu.
Maximálně čtyři se zvukem denně, noční klid, poslední místo v denním rozpočtu
je rezervované pro to důležité, a když konkrétní připomínku třikrát po sobě
ignoruješ, na dva dny se odmlčí.

**Kroky z Apple Health** přes Zkratku, která je jednou denně pošle na server.
Nebo si je zapíšeš ručně, appka funguje i tak.

**Pokrok** – váha, obvod pasu, kolik centimetrů ti chybí na zem, výdrž v prkně.

---

## Jak je to poskládané

```
app/       PWA (Vue 3 + Vite + TypeScript). Data žijí v telefonu.
  src/lib/       výpočty: dluh, série, plán dne, milníky – čisté funkce s testy
  src/views/     obrazovky
  e2e/           testy, které appku proklikají v prohlížeči
server/    Malý Node/Express: posílá notifikace a přebírá kroky z Health.
```

Zdrojem pravdy jsou data v telefonu. Server nedrží tvoji historii cvičení –
jen odběry notifikací, snímek dnešního stavu (aby uměl napsat „chybí ti
3 200 kroků“ místo obecné hlášky) a kroky nahrané ze Zkratky.

**Bez serveru appka funguje**: zapisuješ kroky ručně, odškrtáváš bloky, všechno
počítá. Nefunguje jediná věc – notifikace v naplánovaný čas při zavřené appce.
A to není nedodělek: na iOS neexistuje způsob, jak to udělat z prohlížeče.
Notification Triggers API se nikdy nedodělalo, Periodic Background Sync na iOS
není a časovač v service workeru nepřežije jeho ukončení (~30 s nečinnosti).
Notifikaci v konkrétní čas může spustit jedině něco, co v ten čas běží jinde.

---

## Rozjezd

Potřebuješ Node 22+.

```bash
# appka
cd app
npm install
npm run dev          # http://localhost:5173

# server (v druhém terminálu)
cd server
npm install
npm run keys         # vypíše VAPID klíče a token
cp .env.example .env # a vlož do něj výstup předchozího příkazu
npm run dev          # http://localhost:8080
```

Pak v appce **Nastavení → Server**: adresa serveru a token. Tlačítko
*Otestovat spojení* řekne, jestli to sedí.

### Testy a kontroly

```bash
cd app
npm test          # jednotkové testy výpočtů (49)
npm run e2e       # e2e testy v prohlížeči (32) – projdou appku jako uživatel
npm run typecheck
npm run build

cd ../server
npm test
npm run typecheck
npm run build
```

E2E testy jedou proti produkčnímu buildu v mobilním rozlišení a kontrolují
celé toky: úvodního průvodce, zápis kroků, průchod blokem cvičení včetně
odpočtu, přenos dluhu, bankrot, měření, milníky, zálohu i registraci service
workeru. Běží i v CI (`.github/workflows/ci.yml`).

---

## Nasazení

### Appka

Statický build, hodí se kamkoli. Na GitHub Pages je připravený workflow
(`.github/workflows/deploy-pages.yml`) – zapni Pages v nastavení repozitáře
(Settings → Pages → Source: GitHub Actions) a při pushi do `main` se to nasadí
samo na `https://<uživatel>.github.io/henry/`.

Ručně kamkoli jinam:

```bash
cd app
BASE_PATH=/ npm run build   # obsah dist/ nahraj na hosting
```

> **Musí to běžet přes HTTPS.** Bez něj nejde service worker ani push, a iOS
> navíc odmítne self-signed certifikát s nicneříkající chybou.

### Server

Kdekoli, kde běží Node a je to dostupné přes HTTPS – VPS, Fly.io, Railway,
Raspberry doma za tunelem. Přiložený je Dockerfile i compose:

```bash
cd server
docker compose up -d
```

Server drží data v jednom JSON souboru (`data/db.json`). Je to appka pro
jednoho člověka, databáze by tu byla na parádu.

### Přidání na plochu (iPhone)

1. Otevři adresu appky v **Safari** (ne v Chromu – ten na iOS neumí přidat
   PWA tak, aby fungovaly notifikace).
2. Sdílet → **Přidat na plochu**.
3. Spusť appku **z ikony**, ne ze Safari.
4. Nastavení → Server → vyplň adresu a token → **Zapnout notifikace**.
5. *Test ze serveru* – za chvíli to musí cinknout.

Bez kroku 2 a 3 push nefunguje a nejde to obejít: v Safari na kartě objekt
`Notification` na iOS vůbec neexistuje.

---

## Kroky z Apple Health

Návod krok za krokem je v **[docs/apple-health.md](docs/apple-health.md)**.

Stručně: Zkratka jednou denně přečte kroky z Health a pošle je POSTem na
`/api/ingest/steps`. Posílá vždycky poslední tři dny, protože HealthKit je
při zamčeném telefonu nečitelný a jeden den občas vypadne – takhle se to
příští den samo zahojí.

---

## Odkud jsou cviky

Katalog vychází z rešerše doporučení ACSM, prací Stuarta McGilla ke stabilizaci
páteře a metaanalýz k protahování. Několik čísel, která ovlivnila návrh:

- **Protahování**: rozsah pohybu roste nejvíc kolem 4 minut na svalovou skupinu
  a sezení, ~10 minut týdně; nad tím se nic navíc nezíská (Ingram et al.,
  *Sports Medicine* 2024, 189 studií).
- **Proč to zpočátku funguje**: prvních zhruba osm týdnů nepovoluje sval, roste
  tolerance k tahu (Weppler & Magnusson, *Physical Therapy* 2010). Trvalá změna
  délky svalu potřebuje zátěž, ne jen protahování – proto jsou v plánu i excentrické
  a plnorozsahové pohyby.
- **Na zem se dostaneš**: první měřitelná změna po ~4 týdnech, typicky 2–5 cm.
  Měř jednou za dva týdny, ne denně – rozsah kolísá o 3–5 cm podle denní doby.
- **Kroky**: 7 000 denně proti 2 000 odpovídá zhruba 47% nižší celkové úmrtnosti
  (*Lancet Public Health* 2025, 57 studií). Nad 7 000 se křivka už jen mírně ohýbá.
  Deset tisíc je marketingové číslo z japonského krokoměru z roku 1965.
- **Dohánění kroků**: koncentrovat týdenní objem je v pořádku – „weekend warrior“
  analýzy nenacházejí rozdíl proti rovnoměrnému rozložení. Limit není metabolický,
  ale tkáňový: skokový nárůst nad ~1,3násobek běžného objemu zvedá riziko přetížení.
  Odtud strop dluhu na dva dny.

**Tohle není lékařská rada.** U každého cviku je poznámka, kdy ho nedělat.
Když se objeví bolest vystřelující do nohy, brnění nebo necitlivost, nepřetlačuj
to a běž za fyzioterapeutem.

---

## Poznámky k bezpečnosti

- Token se posílá jen v hlavičce `Authorization`, nikdy v URL – query stringy
  končí v logu proxy a v hlavičce `Referer`.
- Ověření běží **před** parsováním těla požadavku, takže nepřihlášený požadavek
  nedonutí server alokovat paměť.
- Token se porovnává v konstantním čase přes hash, takže neprozradí ani délku.
- VAPID klíče vygeneruj jednou a nech je být. Přegenerování zneplatní všechny
  existující odběry.
- `.env` a `data/` do gitu nepatří (jsou v `.gitignore`).

---

## Data

Všechno leží v `localStorage` telefonu. Když smažeš ikonu z plochy, data zmizí
s ní – proto je v Nastavení → Data stažení zálohy. Sedmidenní mazání úložiště,
kterým Safari trestá běžné weby, se na appky přidané na plochu nevztahuje.
