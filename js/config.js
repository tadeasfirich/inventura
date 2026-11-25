// Nastavení aplikace. Tohle je jediný soubor, který upravíš po registraci aplikace v Entra ID.
// Postup krok za krokem je v NASTAVENI.md.

export const CONFIG = {
  appName: 'Inventura',
  schoolName: 'ZŠ Karla Hašlera Libčice',

  // Dokud je clientId „DOPLNIT“, aplikace běží v testovacím režimu: data jen v tomto prohlížeči,
  // přihlášení výběrem role. Testovací režim jde vynutit i adresou s ?demo=1.
  msal: {
    clientId: 'd4b0e9c0-e0c7-4f3e-bd19-bcd657f49bc3',
    tenantId: '250cc053-db88-43ef-9b49-f32166589a36',
  },

  // Kam se ukládá: SharePoint web → knihovna Dokumenty → složka `folder`.
  sharepoint: {
    hostname: 'zslibcice.sharepoint.com', // např. skolalibcice.sharepoint.com
    sitePath: '/sites/Inventura',       // web, kam má přístup hospodářka i učitelé
    folder: 'Inventura',                // hlavní složka v knihovně Dokumenty
  },

  // Výchozí hodnoty, které správce může změnit přímo v aplikaci (Správa → Nastavení).
  defaults: {
    kolo: '2026',                                    // název inventury; pevně, ať se v lednu samo nepřepne na nový rok
    prijemceJmeno: 'Marcelce',                       // tvar do tlačítka „Poslat Marcelce“
    prijemceEmail: 'bukova@skola.libcice.cz',
    posilatEmail: true,
  },

  // Skupiny Microsoft 365 → role. Stačí název skupiny (na velikosti písmen a diakritice nezáleží)
  // nebo její ID. Má-li účet víc rolí, platí nejvyšší: spravce > ucitel > lepic.
  roleGroups: {
    spravce: ['Inventura Správci'],
    ucitel: ['Kantoři', 'Asistenti'],
    lepic: ['Inventura Lepiči'],
  },

  // Pojistka: tyto účty jsou správci vždy, i kdyby je někdo vyřadil ze skupiny.
  spravciEmails: ['firich@skola.libcice.cz'],

  // Oprávnění Microsoft Graph (delegovaná – aplikace smí jen to, co smí přihlášený člověk).
  scopes: ['User.Read', 'GroupMember.Read.All', 'Sites.ReadWrite.All', 'Mail.Send'],

  cdn: {
    msal: 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@4/+esm',
    // Čtení čárových kódů v prohlížečích bez vestavěné čtečky (iPhone, Firefox, Windows).
    // Na Androidu v Chromu se nic nestahuje, použije se čtečka zabudovaná v telefonu.
    barcode: 'https://cdn.jsdelivr.net/npm/barcode-detector@3/dist/es/ponyfill.min.js',
    zxingWasm: (ver) => `https://cdn.jsdelivr.net/npm/zxing-wasm@${ver}/dist/reader/zxing_reader.wasm`,
  },
};

export function isDemo() {
  const p = new URLSearchParams(location.search);
  if (p.get('demo') === '1') { try { sessionStorage.setItem('force-demo', '1'); } catch { /* nic */ } return true; }
  try { if (sessionStorage.getItem('force-demo') === '1') return true; } catch { /* nic */ }
  return !CONFIG.msal.clientId || CONFIG.msal.clientId === 'DOPLNIT';
}

export function appUrl() {
  return location.origin + location.pathname;
}
