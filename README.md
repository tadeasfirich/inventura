# Inventura

Webová aplikace (PWA) na lepení inventárních štítků a inventuru majetku po místnostech
pro ZŠ Karla Hašlera Libčice. Běží na GitHub Pages, data jsou ve školním SharePointu,
funguje i bez wifi.

**Vyzkoušet:** https://tadeasfirich.github.io/inventura/ (dokud není vyplněný `js/config.js`,
běží testovací režim s ukázkovými daty jen v prohlížeči).

## Tři role

| Role | Kdo | Co dělá |
|---|---|---|
| **Lepič** | holky, co lepí štítky | Najde místnost (hledání „9b“ najde „9.B …“). Stejné věci jsou pohromadě („židle žákovská – 24 ks“), jedním ťuknutím „Nalepeno vše“. Když něco nesedí, skupinu rozklikne a u konkrétních čísel dá „Ve třídě není“ (štítek zbyl) nebo „Nemám štítek“. Připíše, co je navíc. „Hotovo – další místnost“. Na konci „Poslat Marcelce“ nebo „Stáhnout Excel“. |
| **Učitel** | kdokoli ze sborovny | Otevře svou (nahoře „Tvoje třída“) nebo cizí místnost, zapne čtečku a projde třídu. Načtené věci se samy odškrtnou. Pak vidí, co zbývá: dohledá, odklikne „Je tu“, označí „Chybí“ nebo „Bez štítku“ s poznámkou, kde věc stojí. Věc z jiné místnosti se zapíše jako navíc i s tím, kam patří. „Hotovo – poslat Marcelce“. |
| **Správce** | Tadeáš | Nahraje Excel s evidencí, vidí přehled všech místností, přegeneruje Excely pro hospodářku, nastaví příjemce. Přepíná se i do Lepení a Inventury. |

## Čtečka čárových kódů

- **Kamera telefonu** – tlačítko „Zapnout čtečku“. Android + Chrome: vestavěná čtečka, rychlá. iPhone: napoprvé (s wifi) se stáhne čtečka ZXing, pak jede i offline. Pípnutí + vibrace, světlo a přiblížení, když je telefon umí.
- **Bluetooth/USB čtečka** (doporučeno pro velké místnosti) – v režimu klávesnice funguje kdekoli na stránce, bez klikání do políčka. Česká klávesnice (`+ěščř…` místo číslic) se opravuje sama.
- **Ruční zadání** – políčko „Číslo ze štítku“.

## Kde co najde hospodářka

SharePoint → Dokumenty → `Inventura` → `Výsledky 2026`:

- `00 Přehled inventury.xlsx` – všechny místnosti, stav lepení a inventury, a list „Co je jinak – vše“ s filtrem,
- `Místnosti/<místnost>.xlsx` – za každou místnost Souhrn, Co je jinak, Co sedí.

Soubory se přepisují samy při každém „Poslat Marcelce“. K tomu jí přijde e-mail s Excelem v příloze a odkazem.

## Dokumentace

- [NASTAVENI.md](NASTAVENI.md) – krok za krokem: GitHub Pages, SharePoint, skupiny, registrace v Entra ID, čtečky.
- [ROZHODNUTI.md](ROZHODNUTI.md) – co jsem rozhodl mimo zadání a jak to změnit.
- [docs/vzor-evidence.xlsx](docs/vzor-evidence.xlsx) – vzorový Excel ve formátu exportu z účetnictví.

## Technicky

Čisté HTML + JavaScript moduly, žádný build. Excel (.xlsx) čte i zapisuje vlastní kód (`js/xlsx.js`), takže
import i export funguje offline. Přihlášení MSAL, data přes Microsoft Graph do knihovny dokumentů SharePointu.

```
index.html, styles.css, sw.js, manifest.webmanifest
js/app.js            start, přihlášení, hlavička, směrování
js/config.js         JEDINÝ soubor k vyplnění
js/model.js          datový model, slučování, počty
js/importer.js       čtení evidence z Excelu
js/report.js         Excely a e-maily pro hospodářku
js/scanner.js        kamera, Bluetooth čtečka, pípání
js/xlsx.js, zip.js   Excel bez knihoven
js/store/            IndexedDB, SharePoint, testovací úložiště, synchronizace
js/views/            obrazovky
```
