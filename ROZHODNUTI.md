# Rozhodnutí mimo zadání

Co jsem při stavbě rozhodl sám, proč a jak to změnit.

| Rozhodnutí | Proč | Jak změnit |
|---|---|---|
| **Data jako soubory v knihovně Dokumenty**, ne SharePoint seznamy | Evidence (tisíce položek) se nahraje jedním souborem během vteřin, místo tisíců zápisů do seznamu. Každá místnost má vlastní soubor, takže se lidé v různých místnostech nepletou. Vše je v jedné složce. | `js/store/sharepoint.js` |
| **Dva lidé v jedné místnosti** se sloučí věc po věci (vyhrává novější zápis) | Lepič a učitel, nebo dva učitelé, můžou být v místnosti zároveň. Zápis hlídá eTag; když mezitím zapsal někdo jiný, aplikace stáhne jeho stav, sloučí a uloží znovu. | `mergeRoom()` v `js/model.js` |
| **Nejdřív do telefonu, potom na server** (IndexedDB + fronta) | Ve sklepě, tělocvičně nebo kabinetu bývá slabá wifi. Nic se neztratí, odešle se samo. Platí i pro „Poslat Marcelce“. | `js/store/data.js` |
| **Lepič: „Nalepeno vše“ + rozkliknutí po kusech** místo počítadla | Jedno ťuknutí pro 24 židlí. Když zbydou 2 štítky, jsou na nich konkrétní čísla – ty se označí „Ve třídě není“, takže hospodářka ví přesně které. Počítadlo by tuhle informaci ztratilo. | `js/views/lepeni.js` |
| **Stavy lepiče:** Nalepeno / Ve třídě není / Nemám štítek | Podle zadání („zbyly mi, ale měly tam být“ a „nemám na ně lepík“). | `ST` v `js/views/lepeni.js` |
| **Stavy učitele:** Je tu (načteno/odkliknuto) / Chybí / Bez štítku + povinná poznámka, kde věc je | Podle zadání; poznámka je povinná, aby hospodářka věc našla. | `js/views/inventura.js` |
| **Výsledek věci rozhoduje inventura učitele**, lepení jen když inventura ještě nebyla | Učitel ověřuje až po lepení, je to novější a přesnější informace. Výjimka: když lepič neměl štítek a učitel věc jen odklikl (nenačetl), zůstává „chybí štítek“ – štítek je pořád potřeba dotisknout. | `finalState()` v `js/model.js` |
| **Načtený kód z jiné místnosti** – vyskočí okno „Tahle věc sem nepatří“, člověk ji zapíše (nebo „Nezapisovat“, když to byl omyl) | Věc se nesmí zapsat potichu, ať se v tom nedělá bordel. Po zapsání se v původní třídě neukáže jako chybějící, ale jako „Je v jiné místnosti“, a v přehledu je na listu **Přesuny** (podle evidence v → skutečně v), takže ji Marcelka jen převede. | `foreignDialog()` v `inventura.js`, `foundFromDocs()` v `model.js` |
| **Neznámý kód musí kamera přečíst dvakrát stejně**, známý stačí jednou | Čárové kódy se občas přečtou špatně; u známého čísla je chyba prakticky vyloučená. | `CameraScanner.handle()` |
| **Kamera čte jen střed obrazu (rámeček)** | Rychlejší a nechytí sousední štítek na vedlejší židli. | `CameraScanner.loop()` |
| **Bluetooth čtečka bez klikání do políčka** a oprava české klávesnice | Čtečky „píšou“ jako americká klávesnice; na české by z 281123 bylo „ěá+++š“. | `listenKeyboardScanner()`, `fixKeyboard()` |
| **„Tvoje třída“ nahoře** podle příjmení v názvu místnosti („1.A Nováková“) | Učitel nemusí hledat. Do cizí třídy se dostane hledáním. | `myRooms()` v `js/model.js` |
| **Na konci místnosti s neoznačenými věcmi** se aplikace zeptá (dohledat / chybí) | Ať neodejde neúplný výsledek omylem. | `finish()` v obou obrazovkách |
| **E-mail odchází ze schránky toho, kdo kliká** (Graph `Mail.Send`) | Není potřeba žádný server ani Power Automate. Marcelka vidí, od koho to je, a může odpovědět. | Správa → Nastavení (vypnout e-mail); `doSend()` |
| **Excely pro hospodářku se aktualizují samy**, nezávisle na tlačítku „Poslat“ | Lidé zapomínají odeslat. Soubor místnosti se zapíše hned při první změně, pak nejvýš jednou za 20 s, při odchodu z místnosti, zavření aplikace a uzavření místnosti hned. Přehled všech místností při uzavření místnosti hned, jinak nejvýš jednou za 3 minuty. Když někdo zavře telefon dřív, dorovná to kterékoli jiné zařízení s aplikací (v `stav.json` je u každé místnosti čas poslední změny a čas posledního Excelu). Starší verze drží SharePoint v Historii verzí. | `autoPublish()` v `js/store/data.js` |
| **„Poslat Marcelce“ = jen e-mail navíc** | Excel na SharePointu už je. E-mail je upozornění, že je místnost hotová. | `doSend()` |
| **Excel bez knihoven** (vlastní čtení/zápis .xlsx) | Import i export funguje offline a nic se nestahuje z cizích serverů. | `js/xlsx.js` |
| **Kolo inventury** („2026“) – změnou ve Správě začne nová inventura do nové složky | Příští rok stačí přepsat název a nahrát nový Excel, stará data zůstanou. | Správa → Nastavení |
| **Správce může v cizí místnosti cokoli opravit** a otevřít uzavřenou místnost znovu | Někdo se vždycky splete. | – |
| **Lepiči se přihlašují školním účtem** (skupina `Inventura Lepiči`) | Zápis do SharePointu potřebuje přihlášeného člověka. Když nemají účet, dá se založit jeden sdílený účet „Lepení“ a dát ho do skupiny. | `config.js` → `roleGroups` |
| **Knihovny z CDN** (MSAL na přihlášení, ZXing čtečka pro iPhone) | Bez build kroku; service worker si je uloží pro práci offline. Android používá vestavěnou čtečku. | `config.js` → `cdn` |

## Pro verzi 2

- Tisk chybějících štítků přímo z aplikace (seznam „Bez štítku“ → PDF pro tiskárnu štítků).
- `Sites.Selected` místo `Sites.ReadWrite.All` – aplikace pak smí jen na web Inventura.
- Fotka věci k položce „Navíc“ nebo „Bez štítku“.
- Rozdělení místnosti mezi víc lepičů (např. podle skupin věcí).
