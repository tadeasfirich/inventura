// Service worker: aplikace se otevře i bez sítě. Data řeší fronta v aplikaci (IndexedDB), ne tady.
// Při každé nové verzi zvyš VERSION, ať si telefony stáhnou nové soubory.
// Vlastní soubory se vždy nejdřív zkusí ze sítě (ať se hned projeví nová verze), při výpadku z mezipaměti.

const VERSION = 'inventura-v5';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/config.js', 'js/auth.js', 'js/ui.js', 'js/model.js', 'js/zip.js', 'js/xlsx.js',
  'js/importer.js', 'js/report.js', 'js/scanner.js', 'js/demo-data.js',
  'js/store/idb.js', 'js/store/data.js', 'js/store/demo.js', 'js/store/sharepoint.js',
  'js/views/common.js', 'js/views/mistnosti.js', 'js/views/lepeni.js', 'js/views/inventura.js', 'js/views/sprava.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'inventura-cdn').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Microsoft (přihlášení, Graph, SharePoint) nikdy necachujeme
  if (/microsoftonline|graph\.microsoft|sharepoint\.com|msauth|live\.com|svc\.ms/.test(url.hostname)) return;

  if (url.origin === location.origin) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
    return;
  }
  // knihovny (přihlášení, čtečka kódů) a písmo: mezipaměť napřed, ať čtečka jede i bez sítě
  if (/(cdn|fastly)\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith(caches.open('inventura-cdn').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }))));
  }
});
