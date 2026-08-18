# Kroky z Apple Health do Henryho

Cíl: iPhone jednou denně sám pošle počet kroků na server a v appce se objeví
bez ťukání.

Funguje to přes **Zkratky (Shortcuts)**. Nic se neinstaluje, ale je potřeba to
poskládat ručně – zabere to tak deset minut.

---

## Než začneš

Potřebuješ běžící server a token pro Zkratku. Vygeneruješ si ho v appce:
**Nastavení → Účet → Token pro Zkratku**. Ukáže se jednou – zkopíruj si ho
hned. Zkratka neumí přihlášení cookie, proto má vlastní klíč, který jde
kdykoli zrušit, aniž bys měnil heslo.
V dalším textu je adresa serveru psaná jako `https://henry.tvujserver.cz` –
dosaď svoji.

---

## Krok 1: Vytvoř zkratku

Aplikace **Zkratky** → záložka *Zkratky* → **+** vpravo nahoře.

Přidej postupně tyhle akce:

### 1.1 Najdi vzorky zdraví (Find Health Samples)

- **Typ**: `Kroky`
- **Filtr**: přidej řádek `Počáteční datum` → `je dnes`
- **Seskupit podle**: `Den`

> „Seskupit podle: Den“ je důležité. Bez toho zkratka dostane tisíce
> jednominutových vzorků a bude se s nimi rvát dlouhé sekundy. S ním dostane
> jeden součet za den.

### 1.2 Získej podrobnosti o vzorku zdraví (Get Details of Health Sample)

- Nastav na **Hodnota** (Value)
- Vstup: výstup předchozí akce

### 1.3 Vypočítej statistiku (Calculate Statistics)

- **Součet** (Sum) ze vstupu

Přejmenuj výsledek na proměnnou (podrž → *Přejmenovat*) třeba `KrokyDnes`.

### 1.4 Zopakuj to samé pro včerejšek a předevčírem

Ještě dvakrát tytéž tři akce, jen ve filtru:

- `Počáteční datum` → `je v posledních` → `2` `dny` … nebo prostě
  `je` → konkrétní relativní datum podle toho, co ti Zkratky nabídnou.

Pokud ti to přijde jako moc práce, **klidně to vynech a posílej jen dnešek.**
Jen počítej s tím, že když jeden den zkratka neproběhne, ten den bude v appce
nula, dokud ho nedopíšeš ručně.

### 1.5 Text (JSON tělo)

Přidej akci **Text** a napiš do ní přesně tohle (proměnné vkládej z lišty nad
klávesnicí, nepiš je ručně):

```json
{"source":"shortcuts","days":[
 {"date":"[DatumDnes]","steps":[KrokyDnes]},
 {"date":"[DatumVcera]","steps":[KrokyVcera]}
]}
```

Datum musí být ve formátu `RRRR-MM-DD`. Získáš ho akcí **Formátovat datum**
s vlastním formátem `yyyy-MM-dd`.

> Kroky posílej jako **číslo bez mezer**. Když Zkratky vloží „8 423“
> s oddělovačem tisíců, server si s tím poradí, ale je čistší tomu předejít.

### 1.6 Získej obsah URL (Get Contents of URL)

- **URL**: `https://henry.tvujserver.cz/api/ingest/steps`
- **Metoda**: `POST`
- **Hlavičky**: přidej řádek
  - klíč `Authorization`, hodnota `Bearer TVUJ_TOKEN`
- **Tělo požadavku**: `Soubor` (File) a jako vstup dej výstup akce **Text**

> Proč `Soubor` a ne `JSON`: vestavěný skládač JSON v Zkratkách je u vnořených
> polí rozbitý. Poslat hotový text jako tělo je odolnější.

Zkratku pojmenuj třeba **Henry kroky** a ulož.

---

## Krok 2: Spusť ji jednou ručně

**Tohle nepřeskakuj.** První spuštění vyvolá dvě potvrzení, která se nedají
udělit dopředu:

1. povolení číst data ze Zdraví,
2. povolení posílat data na tvoji doménu.

Kdybys rovnou zapnul automatizaci, první běh by na tom uvázl.

Když to projde, server odpoví `{"ok":true,...}` a v appce se po synchronizaci
objeví kroky.

---

## Krok 3: Automatizace

Zkratky → záložka **Automatizace** → **+** → **Denní doba**.

- Čas: **21:30** (nebo kdy jindy, ale viz varování níž)
- Opakovat: denně
- Akce: *Spustit zkratku* → `Henry kroky`
- Zvol **Spustit ihned** (ne *Spustit po potvrzení*)
- Pak vypni **Upozornit při spuštění**, ať ti nechodí banner

---

## Důležité: HealthKit je při zamčeném telefonu nečitelný

Tohle je ta věc, o které se nikde nepíše a která tyhle návody nejčastěji
rozbíjí.

Data ze Zdraví jsou šifrovaná třídou *Protected Unless Open*. Přístup k nim
systém odebere **zhruba deset minut po zamknutí telefonu** a vrátí ho až po
odemčení Face ID nebo kódem. Automatizace naplánovaná na 23:59 na telefonu,
který hodinu leží na nočním stolku, **proběhne, ale nic nenačte**.

Co s tím:

1. **Naplánuj to na čas, kdy telefon prokazatelně držíš v ruce.** 21:30 bývá
   dobrá volba, 3:00 ráno rozhodně ne.
2. **Posílej víc dní najednou** (viz krok 1.4). Server zapisuje podle data,
   takže opakované poslání nic nezdvojí – jen to přepíše. Vynechaný den se
   příští běh sám zahojí.
3. **Přidej druhý spouštěč.** Automatizace typu „Když otevřu aplikaci“ na něčem,
   co otevíráš denně, výrazně zvýší šanci, že aspoň jeden běh chytne odemčený
   telefon.

Ještě jedna poctivá poznámka: v iOS 26 se objevily rozšířené problémy s tím, že
osobní automatizace prostě nespustí. Apple to postupně opravuje, ale ber Zkratky
jako „většinou funguje“, ne jako spolehlivý cron. Ruční zápis v appce zůstává.

---

## Alternativa: Health Auto Export

Aplikace **Health Auto Export – JSON+CSV** umí posílat data na REST API sama
na pozadí, spolehlivěji než Zkratky. Háček: je to placená funkce (tarif
Premium, předplatné nebo asi 25 dolarů natrvalo, se sedmidenní zkušební dobou).

Server na ni má vlastní endpoint:

```
POST https://henry.tvujserver.cz/api/ingest/health-auto-export
Authorization: Bearer TVUJ_TOKEN
```

V aplikaci nastav REST API export, vyber metriku `step_count`, zapni dávkování
(Batch) a zúž okno synchronizace – při první plné synchronizaci umí odejít
i desítky megabajtů.

---

## Když to nefunguje

| Příznak | Nejčastější příčina |
|---|---|
| `401` | Token nesedí (nebo byl zrušený), nebo v hlavičce chybí slovo `Bearer` a mezera za ním |
| Kroky jsou 0 | Telefon byl v době běhu zamčený (viz výše) |
| Nesrozumitelná síťová chyba | Prázdný řádek v hlavičkách, přebývající dvojtečka v hodnotě, nebo self-signed certifikát |
| Automatizace nespustí | Zkus telefon restartovat; v iOS 26 je to známá vada |
| Kroky nesedí s aplikací Zdraví | Zdraví odečítá překryv iPhonu a Apple Watch, ve vzorcích to není. Rozdíl bývá malý, dá se s ním žít |

Co server přijal, se dá zkontrolovat na `GET /api/steps?days=14`
(s hlavičkou `Authorization`).

---

## Android

Health Connect je čistě lokální úložiště bez cloudového API – bez nativní
aplikace se k němu web nedostane. Google Fit REST API je od května 2024 zavřené
pro nové vývojáře a končí. Prakticky: buď hodinky s vlastním cloudovým API
(Fitbit, Garmin, Withings, Oura), nebo ruční zápis.
