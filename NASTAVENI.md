# Inventura – nastavení ostrého provozu

Návod pro správce školního Microsoft 365. Kroky jdou po sobě, každý končí tím, co máš vidět (✔).
Počítej zhruba s jedním odpolednem.

1. Vyzkoušej testovací režim
2. Zapni GitHub Pages
3. SharePoint web a oprávnění
4. Skupiny v Microsoft 365
5. Registrace aplikace v Entra ID
6. Vyplň `js/config.js`
7. Nahraj evidenci
8. Hospodářka – kde co najde
9. Čtečky a telefony
10. Kontrolní seznam před spuštěním

---

## 1. Vyzkoušej testovací režim

Dokud je v `js/config.js` místo `clientId` text `DOPLNIT`, aplikace běží v testovacím režimu: ukázková data
(anonymizovaný výřez evidence + vymyšlené místnosti), přihlášení výběrem role, nic se nikam neposílá.

Projdi všechny tři role. Ve Správě je navíc záložka **Složka (test)** – ukazuje, jaké Excely by se uložily
na SharePoint a jaké e-maily by odešly hospodářce (dají se otevřít i stáhnout). V menu pod kolečkem vpravo
nahoře jde zapnout **Simulovat výpadek sítě**.

V ostrém provozu jde testovací režim kdykoli otevřít adresou s `?demo=1` (třeba na poradě), aniž by se
cokoli dotklo skutečných dat.

✔ Na telefonu jsi nalepil(a) místnost, udělal(a) v ní inventuru a ve „Složce (test)“ vidíš Excel a e-mail.

## 2. Zapni GitHub Pages

1. github.com/tadeasfirich/inventura → **Settings → Pages**.
2. Source: **Deploy from a branch**, Branch: **main**, složka **/ (root)** → Save.
3. Za minutu běží na `https://tadeasfirich.github.io/inventura/`.

> Na GitHubu je jen aplikace. Evidence ani výsledky tam nikdy nejsou – jdou rovnou do školního SharePointu.
> Ukázková data v `js/demo-data.js` jsou anonymizovaná (bez jmen, výrobních čísel a faktur).

✔ Na té adrese vidíš přihlašovací obrazovku s testovacími rolemi.

## 3. SharePoint web a oprávnění

Aplikace ukládá všechno do **jedné složky** v knihovně Dokumenty jednoho SharePoint webu.

1. Buď použij existující web, kam mají přístup všichni zaměstnanci, nebo založ nový:
   **SharePoint → Vytvořit web → Týmový web** (bez Teams stačí), název `Inventura`.
2. **Oprávnění webu → Členové (úpravy):** skupina učitelů (`Kantoři`, `Asistentky`), lepiči a hospodářka.
   Každý, kdo v aplikaci zapisuje, musí mít na web právo **upravovat** – aplikace smí jen to, co smí přihlášený člověk.
3. Složku `Inventura` zakládat nemusíš, vznikne sama při prvním uložení.

Co v ní bude:

```
Inventura/
  _data/                       data aplikace (JSON) – nikdo je nemusí otevírat
    nastaveni.json
    2026/majetek.json          evidence nahraná správcem
    2026/stav.json             stav všech místností (pro rychlý seznam)
    2026/mistnosti/1.A ….json  co se v místnosti zjistilo
  Výsledky 2026/               PRO HOSPODÁŘKU
    00 Přehled inventury.xlsx
    Místnosti/1.A ….xlsx
```

✔ Znáš adresu webu, např. `https://skolalibcice.sharepoint.com/sites/Inventura`.

## 4. Skupiny v Microsoft 365

Role se určují podle skupin. Mapování je v `js/config.js` (`roleGroups`), takže můžeš použít i skupiny, které už máš.

| Role | Skupina (výchozí název) | Kdo v ní je |
|---|---|---|
| správce | `Inventura Správci` | ty |
| učitel | `Kantoři`, `Asistentky` (už existují) | všichni, kdo budou dělat inventuru |
| lepič | `Inventura Lepiči` | ty, co lepí štítky |

Založení: **admin.microsoft.com → Týmy a skupiny → Aktivní týmy a skupiny → Přidat skupinu → Zabezpečení**.
Na velikosti písmen a diakritice v názvu nezáleží. Pokud by lepiči byli žáci, mají školní účet taky – stačí je
dát do skupiny a skupinu přidat mezi členy webu z kroku 3.

✔ Ve skupině `Inventura Správci` jsi ty, v `Inventura Lepiči` jsou lepiči.

## 5. Registrace aplikace v Entra ID

1. **entra.microsoft.com → Aplikace → Registrace aplikací → Nová registrace.**
2. Název `Inventura`, typ účtu: **Jen účty v tomto adresáři organizace**.
3. Identifikátor URI pro přesměrování: platforma **Jednostránková aplikace (SPA)**,
   adresa `https://tadeasfirich.github.io/inventura/` (i s lomítkem na konci).
4. Zaregistrovat. Z přehledu si opiš **ID aplikace (klienta)** a **ID adresáře (tenanta)**.
5. **Oprávnění rozhraní API → Přidat oprávnění → Microsoft Graph → Delegovaná:**
   - `User.Read` – jméno a e-mail přihlášeného
   - `GroupMember.Read.All` – role podle skupin
   - `Sites.ReadWrite.All` – zápis do SharePointu (jen tam, kam smí přihlášený člověk)
   - `Mail.Send` – e-mail hospodářce odchází ze školní schránky toho, kdo kliká
6. **Udělit souhlas správce pro organizaci** (tlačítko nad seznamem oprávnění).

✔ U všech čtyř oprávnění je zelená fajfka „Uděleno“.

## 6. Vyplň `js/config.js`

Na GitHubu otevři `js/config.js` → tužka (Edit) → doplň a ulož (Commit changes):

```js
msal: {
  clientId: 'ID aplikace z kroku 5',
  tenantId: 'ID adresáře z kroku 5',
},
sharepoint: {
  hostname: 'skolalibcice.sharepoint.com',
  sitePath: '/sites/Inventura',
  folder: 'Inventura',
},
```

Zkontroluj i `defaults` (e-mail hospodářky `bukova@skola.libcice.cz`, tvar „Marcelce“) – obojí se dá později
změnit přímo v aplikaci ve Správě → Nastavení.

Pak v `sw.js` zvyš `VERSION` (např. `inventura-v2`), ať si telefony stáhnou novou verzi.

✔ Na adrese aplikace je tlačítko „Přihlásit přes Microsoft“ a po přihlášení vidíš Správu.

## 7. Nahraj evidenci

1. **Správa → Evidence → Vyber Excel s evidencí.**
2. Formát jako export z účetnictví (přesně jako ukázkový soubor): sloupce `Invent.číslo`, `Název`,
   `Text z čís. Místnost` – na pořadí nezáleží, další sloupce (Skupina, Evid.číslo, Pořiz.cena, …) se převezmou do výstupů.
   Jeden soubor se všemi místnostmi. Jde vybrat i víc souborů naráz.
3. Zobrazí se náhled: kolik položek a místností, upozornění (duplicitní čísla, řádky bez čísla). **Nahrát do aplikace.**

Inventární číslo (2. sloupec) musí být stejné jako číslo pod čárovým kódem na štítku – podle něj čtečka věc pozná.
Nahrání nové evidence nic neodklikaného nesmaže, stav se pamatuje podle inventárních čísel.

✔ V Přehledu vidíš všechny místnosti, všude „nezačato“.

## 8. Hospodářka – kde co najde

Pošli Marcelce odkaz na složku `Inventura / Výsledky 2026` (Správa → Přehled → Otevřít složku na SharePointu → Sdílet).
Doporuč jí **Přidat zástupce do Mého OneDrivu** – pak ji má v Průzkumníku i v Excelu mezi soubory.

- `00 Přehled inventury.xlsx` – začíná se tady. List *Místnosti* (stav), *Co je jinak – vše* (všechny rozdíly, filtr
  v hlavičce), *Jak to číst* (vysvětlivky).
- `Místnosti/…xlsx` – detail jedné místnosti.
- E-mail „Inventura 2026 – 1.A … – hotovo“ s Excelem v příloze přijde, kdykoli učitel místnost odešle.

Excely se přepisují samy. Kdyby chtěla mít vše čerstvé najednou: Správa → **Aktualizovat Excely pro hospodářku**.

## 9. Čtečky a telefony

**Telefon jako čtečka (nic nekupovat):**
- Android + Chrome: čtečka je vestavěná, funguje hned a i bez sítě.
- iPhone + Safari: napoprvé otevři „Zapnout čtečku“ na wifi (stáhne se čtečka, asi 1 MB). Pak jede i offline.
- Povolit kameru: při prvním spuštění se prohlížeč zeptá. Když se omylem zakáže: ikona zámku vedle adresy → Kamera → Povolit.
- Štítek drž asi 10–20 cm od telefonu, čárový kód vodorovně přes rámeček. Ve tmavé skříni pomůže tlačítko **Světlo**.

**Bluetooth čtečka (rychlejší při velkých místnostech):**
- Jakákoli čtečka 1D kódů (Code 128) v režimu „HID / klávesnice“, cca 600–1 500 Kč.
- Spáruj s telefonem/tabletem jako klávesnici. V aplikaci nic nenastavuješ – stačí mít otevřenou místnost a mačkat spoušť.
- Pokud čtečka po kódu neposílá Enter, zapni ho podle jejího manuálu (konfigurační kód „Suffix CR/Enter“).

**Na plochu:** Chrome → ⋮ → Přidat na plochu; Safari → Sdílet → Přidat na plochu. Aplikace se pak otevírá jako appka.

**Bez wifi:** všechno se ukládá do telefonu a odešle samo, až bude síť. Vpravo nahoře je vidět „Bez sítě – čeká 3“.
Telefon se ale musí aspoň jednou přihlásit s internetem.

## 10. Kontrolní seznam před spuštěním

- [ ] Pages běží, `config.js` vyplněný, `VERSION` v `sw.js` zvýšená
- [ ] Souhlas správce v Entra ID udělený (4 oprávnění)
- [ ] Skupiny `Inventura Správci` a `Inventura Lepiči` naplněné
- [ ] Učitelé, lepiči a hospodářka mají na SharePoint web právo upravovat
- [ ] Evidence nahraná, počet místností sedí
- [ ] Zkušebně: jeden lepič a jeden učitel v jedné místnosti, „Poslat Marcelce“ → přišel e-mail, Excel je ve složce
- [ ] Marcelka má odkaz na složku `Výsledky 2026`
- [ ] Na jednom iPhonu otevřená čtečka s wifi (ať je stažená)
