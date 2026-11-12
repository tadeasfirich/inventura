// Výběr místnosti – stejný pro lepení i inventuru. Hledání „9b“ najde „9.B Svobodová“.

import { h, mount, fmt, downloadBlob, toast, confirmDialog } from '../ui.js';
import * as M from '../model.js';
import { roomHref, statusMark, emptyMaster, sendResult } from './common.js';

const FILTERS = [
  { id: 'vse', label: 'Všechny' },
  { id: 'none', label: 'Nezačaté' },
  { id: 'rozpr', label: 'Rozdělané' },
  { id: 'hotovo', label: 'Hotové' },
];

export async function render(el, ctx, { role }) {
  const data = ctx.data;
  let q = sessionStorage.getItem(`hledej-${role}`) || '';
  let filter = sessionStorage.getItem(`filtr-${role}`) || 'vse';

  const input = h('input', {
    type: 'search', class: 'search', placeholder: 'Hledej místnost, např. 9.B', 'aria-label': 'Hledat místnost',
    autocomplete: 'off', enterkeyhint: 'search',
  });
  input.value = q;
  const listEl = h('div', { class: 'rooms' });
  const mineEl = h('div');
  const filterEl = h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': 'Filtr' });
  const footEl = h('div');

  const stav = (key) => {
    const s = data.stav[key];
    return s ? s[role] : null;
  };

  function roomRow(r) {
    const s = stav(r.key);
    const st = s?.stav || 'none';
    let detail;
    if (role === 'lepic') {
      if (!s || st === 'none') detail = `${fmt.ks(r.items.length)} k nalepení`;
      else detail = `nalepeno ${s.ok} z ${r.items.length}${s.chybi ? `; není ${s.chybi}` : ''}${s.bez ? `; bez štítku ${s.bez}` : ''}`;
    } else if (!s || st === 'none') detail = fmt.ks(r.items.length);
    else if (st === 'hotovo') detail = s.odeslano ? `odesláno ${fmt.short(s.odeslano)}` : `hotovo, neodesláno`;
    else detail = `hotovo ${s.total - s.nic} z ${s.total}`;
    return h('a', { class: `room st-${st}`, href: roomHref(role, r.key) },
      statusMark(st),
      h('span', { class: 'grow' }, h('b', null, r.name), h('small', null, detail)),
      h('span', { class: 'chev', 'aria-hidden': 'true' }));
  }

  function draw() {
    const rooms = data.index.rooms;
    if (!rooms.length) { mount(listEl, emptyMaster(ctx)); return; }
    let list = M.filterRooms(rooms, q);
    if (filter !== 'vse') list = list.filter((r) => (stav(r.key)?.stav || 'none') === filter);
    const cnt = (f) => rooms.filter((r) => (stav(r.key)?.stav || 'none') === f).length;
    mount(filterEl, FILTERS.map((f) => h('button', {
      'aria-pressed': String(filter === f.id),
      onclick: () => { filter = f.id; sessionStorage.setItem(`filtr-${role}`, filter); draw(); },
    }, f.label, f.id !== 'vse' ? h('span', { class: 'cnt' }, cnt(f.id)) : null)));

    if (role === 'ucitel' && !q) {
      const mine = M.myRooms(rooms, ctx.user.name);
      mount(mineEl, mine.length ? h('div', { class: 'mine' }, h('div', { class: 'eyebrow' }, 'Tvoje třída'), mine.map(roomRow)) : null);
    } else mount(mineEl);

    mount(listEl, list.length ? list.map(roomRow) : h('p', { class: 'muted empty-q' }, q ? `Nic jsem nenašel pro „${q}“.` : 'Tady nic není.'));

    if (role === 'lepic') {
      const done = cnt('hotovo');
      mount(footEl, h('section', { class: 'box fill end-box' },
        h('h4', null, 'Konec lepení'),
        h('p', null, `Hotovo ${done} z ${rooms.length} místností. Excel na SharePointu se ukládá sám; tlačítkem pošleš ${ctx.prijemce} navíc e-mail.`),
        h('div', { class: 'btn-col' },
          h('button', {
            class: 'btn primary', disabled: !done || undefined,
            onclick: async (e) => {
              if (!(await confirmDialog(`Poslat ${ctx.prijemce}?`, `Odešle se přehled lepení (${done} hotových místností) a uloží se Excel na SharePoint.`, 'Poslat'))) return;
              e.target.disabled = true; e.target.textContent = 'Odesílám…';
              const res = await data.send('lepic');
              sendResult(ctx, res);
              draw();
            },
          }, `Poslat ${ctx.prijemce}`),
          h('button', {
            class: 'btn ghost', onclick: async () => {
              const blob = await data.overviewXlsx();
              downloadBlob(`Inventura ${data.kolo} – přehled.xlsx`, blob);
            },
          }, 'Stáhnout Excel'))));
    }
  }

  input.addEventListener('input', () => { q = input.value; sessionStorage.setItem(`hledej-${role}`, q); draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = listEl.querySelector('a.room');
      if (first) location.hash = first.getAttribute('href');
    }
  });

  mount(el,
    h('div', { class: 'page-head' },
      h('div', { class: 'eyebrow' }, `${role === 'lepic' ? 'Lepení štítků' : 'Inventura'} – ${data.kolo}`),
      h('h1', { class: 'title' }, 'Vyber místnost'),
      h('p', { class: 'sub' }, role === 'lepic'
        ? 'Přijdi do místnosti, najdi ji tady a nalep štítky podle seznamu.'
        : 'Otevři místnost, zapni čtečku a projdi třídu. Co zbyde, dohledáš nebo odklikáš.')),
    h('div', { class: 'search-wrap' }, input),
    mineEl,
    filterEl,
    listEl,
    footEl);
  draw();

  const off = data.on((what) => { if (['stav', 'master', 'room'].includes(what)) draw(); });
  data.pullStav().then(() => draw()).catch(() => {});
  const t = setInterval(() => data.pullStav().catch(() => {}), 30000);
  return () => { off(); clearInterval(t); };
}
