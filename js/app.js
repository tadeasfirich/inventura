// Start aplikace: přihlášení, načtení dat, hlavička s přepínačem rolí a směrování.

import { CONFIG, isDemo } from './config.js';
import { h, mount, mark, toast, modal, fmt } from './ui.js';
import * as auth from './auth.js';
import { Data } from './store/data.js';
import { DemoBackend } from './store/demo.js';
import { SharePointBackend } from './store/sharepoint.js';
import { DEMO_MASTER, DEMO_VERSION } from './demo-data.js';

const root = document.getElementById('app');
const demo = isDemo();

// #/lepeni – seznam místností, #/lepeni/<místnost> – lepení v místnosti; stejně #/inventura
const VIEWS = {
  lepeni: { app: 'lepeni', role: 'lepic', load: (p) => (p.length ? import('./views/lepeni.js') : import('./views/mistnosti.js')) },
  inventura: { app: 'inventura', role: 'ucitel', load: (p) => (p.length ? import('./views/inventura.js') : import('./views/mistnosti.js')) },
  sprava: { app: 'sprava', load: () => import('./views/sprava.js') },
};

const ctx = {
  demo,
  data: null,
  user: null,
  be: null,
  navigate(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  isAdmin() { return ctx.user?.role === 'spravce'; },
  get prijemce() { return ctx.data?.settings.prijemceJmeno || 'hospodářce'; },
};
window.__ctx = ctx;

let cleanup = null;
let topbarEl = null;
let contentEl = null;

boot().catch((e) => {
  console.error(e);
  mount(root, h('main', { class: 'login' }, h('div', { class: 'login-card' },
    h('div', { class: 'eyebrow' }, 'Chyba při spuštění'),
    h('h1', { class: 'title' }, 'Aplikace se nespustila'),
    h('p', null, e.message || String(e)),
    h('p', { class: 'muted small' }, 'Zkontroluj připojení k internetu a obnov stránku. Když to přetrvá, napiš správci.'),
    h('button', { class: 'btn', onclick: () => location.reload() }, 'Obnovit stránku'))));
});

async function boot() {
  registerSW();
  if (demo) {
    const u = auth.demoUser();
    if (!u) return showDemoLogin();
    ctx.user = { ...u };
    ctx.be = new DemoBackend();
    await ctx.be.init(async (be) => {
      await be.putJson(`_data/${CONFIG.defaults.kolo}/majetek.json`, { ...DEMO_MASTER, kolo: CONFIG.defaults.kolo }, null, { overwrite: true });
    }, DEMO_VERSION);
  } else {
    let account = null;
    try { account = await auth.msInit(); } catch (e) { console.error(e); }
    if (!account) return showMsLogin();
    let u;
    try { u = await auth.msUser(); localStorage.setItem('ms-user-cache', JSON.stringify(u)); } catch (e) {
      u = JSON.parse(localStorage.getItem('ms-user-cache') || 'null'); // bez sítě: poslední známá role
      if (!u) throw e;
    }
    ctx.user = u;
    if (!u.role) return showNoAccess(u);
    ctx.be = new SharePointBackend(auth.getToken);
    try { await ctx.be.init(); } catch (e) { if (!ctx.be.driveId) throw e; }
    const back = auth.takeReturnHash();
    if (back) history.replaceState(null, '', back);
  }
  ctx.data = new Data(ctx.be, ctx.user);
  await ctx.data.init();
  ctx.data.on((what) => { if (what === 'status') updatePill(); });
  buildShell();
  window.addEventListener('hashchange', route);
  route();
}

// ---------- přihlášení ----------
function loginShell(...children) {
  mount(root, h('main', { class: 'login' }, h('div', { class: 'login-card' },
    h('div', { class: 'brand-mark big', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i')),
    h('div', { class: 'eyebrow' }, CONFIG.schoolName),
    h('h1', { class: 'title' }, CONFIG.appName),
    ...children)));
}

function showMsLogin() {
  loginShell(
    h('p', { class: 'sub' }, 'Lepení štítků a inventura majetku po místnostech. Přihlas se školním účtem.'),
    h('hr', { class: 'rule' }),
    h('button', { class: 'btn primary wide', onclick: () => auth.msLogin() },
      h('span', { class: 'ms-logo', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
      'Přihlásit přes Microsoft'));
}

function showNoAccess(u) {
  loginShell(
    h('p', { class: 'sub' }, `Jsi přihlášen(a) jako ${u.name}, ale do inventury zatím nemáš přístup.`),
    h('hr', { class: 'rule' }),
    h('p', null, 'Napiš správci, ať tě přidá do správné skupiny.'),
    h('button', { class: 'btn', onclick: () => auth.msLogout() }, 'Odhlásit'));
}

function showDemoLogin() {
  loginShell(
    h('p', { class: 'sub' }, 'Testovací režim: ukázková data, uložená jen v tomto prohlížeči. Vyber, za koho to chceš vyzkoušet.'),
    h('hr', { class: 'rule' }),
    h('div', { class: 'btn-col' }, auth.DEMO_USERS.map((u) => h('button', {
      class: 'btn role-btn',
      onclick: () => { auth.demoLogin(u); location.hash = ''; location.reload(); },
    }, h('b', null, auth.ROLE_LABEL[u.role]), h('small', null, `${u.name} – ${u.popis}`)))));
}

// ---------- hlavička ----------
function buildShell() {
  topbarEl = h('header', { class: 'topbar' });
  contentEl = h('main', { class: 'content', id: 'main' });
  mount(root, h('div', { class: 'shell' }, topbarEl, contentEl));
}

function renderTopbar(currentApp) {
  const apps = auth.appsFor(ctx.user.role);
  mount(topbarEl,
    h('a', { class: 'brand', href: auth.APPS[apps[0]].route },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i')),
      h('span', null, h('b', null, CONFIG.appName), h('small', null, `${ctx.data.kolo}${demo ? ' – test' : ''}`))),
    apps.length > 1 ? h('nav', { class: 'switcher', 'aria-label': 'Přepnout roli' },
      apps.map((a) => h('a', { href: auth.APPS[a].route, 'aria-current': a === currentApp ? 'page' : null }, auth.APPS[a].label))) : null,
    h('span', { class: 'spacer' }),
    h('span', { id: 'sync-pill' }),
    h('button', { class: 'who', onclick: openMenu, 'aria-label': 'Účet' },
      h('span', { class: 'who-name' }, ctx.user.name), h('span', { class: 'who-dot', 'aria-hidden': 'true' })));
  updatePill();
}

function updatePill() {
  const el = document.getElementById('sync-pill');
  if (!el || !ctx.data) return;
  const s = ctx.data.status;
  let node;
  if (s.offline) node = h('span', { class: 'pill warn', title: 'Vše se ukládá do telefonu a odešle samo, až bude síť.' }, mark('wait'), s.pending ? `Bez sítě – čeká ${s.pending}` : 'Bez sítě');
  else if (s.error) node = h('button', { class: 'pill warn', onclick: () => toast(s.error, { timeout: 8000 }) }, mark('bad'), 'Chyba ukládání');
  else if (s.pending || s.syncing) node = h('span', { class: 'pill' }, mark('wait'), 'Ukládám…');
  else node = h('span', { class: 'pill ok' }, mark('ok'), 'Uloženo');
  mount(el, node);
}

function openMenu() {
  modal((close) => [
    h('div', { class: 'eyebrow' }, auth.ROLE_LABEL[ctx.user.role]),
    h('h2', { class: 'dlg-title' }, ctx.user.name),
    h('p', { class: 'muted' }, ctx.user.email),
    h('p', { class: 'small muted' }, ctx.data.status.lastSync ? `Naposledy uloženo na server ${fmt.short(ctx.data.status.lastSync)}.` : ''),
    h('div', { class: 'btn-col' },
      h('button', { class: 'btn', onclick: async () => { close(); await ctx.data.refresh().catch((e) => ctx.data.noteError(e)); await ctx.data.syncNow(); route(); toast('Načteno znovu'); } }, 'Načíst znovu ze serveru'),
      demo ? h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: ctx.be.offline || undefined, onchange: (e) => { ctx.be.offline = e.target.checked; if (!e.target.checked) ctx.data.kick(0); } }),
        'Simulovat výpadek sítě') : null,
      demo
        ? h('button', { class: 'btn ghost', onclick: () => { auth.demoLogout(); location.hash = ''; location.reload(); } }, 'Přepnout testovací účet')
        : h('button', { class: 'btn ghost', onclick: () => auth.msLogout() }, 'Odhlásit')),
  ]);
}

// ---------- směrování ----------
function defaultRoute() {
  return auth.APPS[auth.appsFor(ctx.user.role)[0]].route;
}

async function route() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const view = VIEWS[name];
  if (!view || !auth.appsFor(ctx.user.role).includes(view.app)) { location.replace(defaultRoute()); return; }
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  renderTopbar(view.app);
  contentEl.className = `content view-${name}`;
  mount(contentEl, h('div', { class: 'loading' }, 'Načítám…'));
  const params = rest.filter(Boolean).map((p) => decodeURIComponent(p));
  const mod = await view.load(params);
  cleanup = (await mod.render(contentEl, ctx, { role: view.role, params, name })) || null;
  window.scrollTo(0, 0);
}

// ---------- service worker ----------
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Je k dispozici nová verze aplikace.', { action: 'Načíst', onAction: () => location.reload(), timeout: 15000 });
        }
      });
    });
  }).catch(() => {});
}
