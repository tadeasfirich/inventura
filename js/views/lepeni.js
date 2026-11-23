// Lepení štítků v jedné místnosti. Stejné věci jsou pohromadě: „Židle žákovská – 20 ks“.
// Jedno ťuknutí „Nalepeno vše“ odklikne celou skupinu. Když něco nesedí, skupina se rozklikne
// a u konkrétních čísel se označí „Ve třídě není“ (štítek zbyl) nebo „Nemám štítek“.
// Věci s poznámkou „neoznačeno“ (rozhlas, koberec…) a „V/Vyřadit“ se nelepí – jsou zvlášť, jen se odkliknou.

import { h, mount, mark, toast, ask, fmt } from '../ui.js';
import * as M from '../model.js';
import { listHref, progress, navicSection, noteSection, readOnlyBanner, emptyMaster, invBlock, specialSection } from './common.js';

const ROLE = 'lepic';
const ST = [
  { s: 'ok', label: 'Nalepeno' },
  { s: 'chybi', label: 'Ve třídě není' },
  { s: 'bez', label: 'Nemám štítek' },
];

export async function render(el, ctx, { params }) {
  const data = ctx.data;
  const key = params[0];
  const room = data.index.roomMap.get(key);
  if (!room) {
    mount(el, data.index.rooms.length
      ? h('div', { class: 'box dashed empty' }, h('h2', null, 'Místnost nenalezena'), h('a', { class: 'btn', href: listHref(ROLE) }, 'Zpět na seznam'))
      : emptyMaster(ctx));
    return null;
  }
  const items = room.items;
  const normal = items.filter((it) => !M.isSpecial(it));
  const special = items.filter(M.isSpecial);
  const groups = M.groupItems(normal);
  const open = new Set();
  let doc = await data.room(key);
  data.pullRoom(key);

  const headEl = h('div');
  const listEl = h('div', { class: 'groups' });
  const specialEl = h('div');
  const restEl = h('div');

  const part = () => doc.lepic;
  const readOnly = () => !!part().hotovo?.v;

  function setMany(invs, s, label) {
    const before = invs.map((inv) => [inv, part().items[inv] || null]);
    data.edit(key, ROLE, (p, stamp) => { for (const inv of invs) p.items[inv] = { s, ...stamp() }; });
    toast(label, {
      action: 'Zpět',
      onAction: () => data.edit(key, ROLE, (p, stamp) => {
        for (const [inv, prev] of before) p.items[inv] = prev ? { ...prev, ...stamp() } : { s: '', ...stamp() };
      }),
    });
  }

  function groupCard(g) {
    const ro = readOnly();
    const sts = g.items.map((it) => M.itemState(part(), it.inv));
    const unset = g.items.filter((_, i) => !sts[i]);
    const c = { ok: 0, chybi: 0, bez: 0 };
    sts.forEach((s) => { if (s) c[s.s]++; });
    const complete = unset.length === 0;
    const problems = c.chybi + c.bez;
    const isOpen = open.has(g.key);
    const shape = !complete ? (unset.length < g.items.length ? 'wait' : 'opt') : problems ? 'bad' : 'ok';
    const summary = [
      c.ok ? `nalepeno ${c.ok}` : '',
      c.chybi ? `ve třídě není ${c.chybi}` : '',
      c.bez ? `nemám štítek ${c.bez}` : '',
      unset.length && unset.length < g.items.length ? `zbývá ${unset.length}` : '',
    ].filter(Boolean).join('; ');

    const toggle = () => { if (isOpen) open.delete(g.key); else open.add(g.key); draw(); };

    return h('article', { class: `group ${complete ? 'complete' : ''} ${isOpen ? 'open' : ''}` },
      h('div', { class: 'group-main' },
        mark(shape, 'lg'),
        h('div', { class: 'grow' },
          h('h3', null, g.nazev),
          h('div', { class: 'meta' },
            h('span', { class: 'count' }, fmt.ks(g.items.length)),
            h('span', { class: 'nums num' }, M.compactNumbers(g.items.map((i) => i.inv), 64)))),
        ro ? null : (complete
          ? h('span', { class: 'done-tag' }, 'Hotovo')
          : h('button', {
            class: 'btn primary big-tap',
            onclick: () => setMany(unset.map((i) => i.inv), 'ok', `Nalepeno ${unset.length}× – ${g.nazev}`),
          }, unset.length === g.items.length ? (g.items.length === 1 ? 'Nalepeno' : `Nalepeno vše ${g.items.length}`) : `Nalepeno zbylé ${unset.length}`))),
      h('button', { class: 'group-toggle', 'aria-expanded': String(isOpen), onclick: toggle },
        h('span', null, isOpen ? 'Sbalit' : (g.items.length > 1 ? 'Rozkliknout po kusech' : 'Rozkliknout')),
        summary ? h('span', { class: 'muted' }, summary) : null),
      isOpen ? h('ul', { class: 'items' }, g.items.map((it) => itemRow(it, ro))) : null);
  }

  function itemRow(it, ro) {
    const cur = M.itemState(part(), it.inv);
    return h('li', { class: 'item' },
      h('div', { class: 'item-id' }, invBlock(it, it.pozn ? h('small', { class: 'muted' }, it.pozn) : null)),
      h('div', { class: 'seg seg-item', role: 'group', 'aria-label': `Stav ${it.inv}` }, ST.map((o) => h('button', {
        'aria-pressed': String(cur?.s === o.s),
        disabled: ro || undefined,
        onclick: () => data.edit(key, ROLE, (p, stamp) => { p.items[it.inv] = { s: cur?.s === o.s ? '' : o.s, ...stamp() }; }),
      }, o.label))));
  }

  function draw() {
    const c = M.counts(part(), items);
    const cn = M.counts(part(), normal);
    const ro = readOnly();
    mount(headEl,
      h('a', { class: 'back', href: listHref(ROLE) }, 'Místnosti'),
      h('div', { class: 'eyebrow' }, `Lepení štítků – ${fmt.ks(items.length)}`),
      h('h1', { class: 'title' }, room.name),
      progress(c.done, c.total, 'Hotovo'),
      h('div', { class: 'legend' },
        h('span', null, mark('ok'), `Nalepeno ${cn.ok}`),
        h('span', null, mark('bad'), `Ve třídě není ${cn.chybi}`),
        h('span', null, mark('bad'), `Nemám štítek ${cn.bez}`),
        special.length ? h('span', null, mark('opt'), `Bez štítku odkliknuto ${c.done - cn.done} z ${special.length}`) : null,
        c.navic ? h('span', null, mark('bad'), `Navíc ${c.navic}`) : null),
      readOnlyBanner(part(), 'Lepení', () => data.edit(key, ROLE, (p, stamp) => { p.hotovo = { v: false, ...stamp() }; })),
      !ro && !c.done ? h('p', { class: 'hint' }, 'Nalep celou skupinu a ťukni na „Nalepeno vše“. Když ti štítek zbyde nebo chybí, rozklikni skupinu.') : null);
    mount(listEl, groups.map(groupCard));
    mount(specialEl, specialSection(ctx, key, ROLE, part(), items, { readOnly: ro }));
    mount(restEl,
      navicSection(ctx, key, ROLE, part(), { readOnly: ro }),
      noteSection(ctx, key, ROLE, part(), { readOnly: ro }),
      ro ? h('a', { class: 'btn wide', href: listHref(ROLE) }, 'Další místnost')
        : h('button', { class: 'btn primary wide xl', onclick: finish }, 'Hotovo – další místnost'));
  }

  async function finish() {
    const cs = M.counts(part(), special);
    if (cs.nic) {
      const v = await ask(`Odklikni ještě ${cs.nic} ${fmt.plural(cs.nic, 'věc', 'věci', 'věcí')} bez štítku`, 'Koberec, rozhlas a podobné věci se nelepí, jen se označí, jestli tu jsou.', [
        { label: 'Zpět, odkliknu', value: 'back', kind: 'primary' },
        { label: 'Ve třídě nejsou', value: 'chybi' },
      ]);
      if (v !== 'chybi') { specialEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const invs = special.filter((it) => !M.itemState(part(), it.inv)).map((it) => it.inv);
      await data.edit(key, ROLE, (p, stamp) => { for (const inv of invs) p.items[inv] = { s: 'chybi', ...stamp() }; });
    }
    const c = M.counts(part(), normal);
    if (c.nic) {
      const v = await ask(`Zbývá ${c.nic} ${fmt.plural(c.nic, 'věc', 'věci', 'věcí')}`, 'Nejsou označené jako nalepené. Co s nimi?', [
        { label: 'Zpět, dolepím', value: 'back', kind: 'primary' },
        { label: 'Ve třídě nejsou (štítky zbyly)', value: 'chybi' },
        { label: 'Nemám na ně štítky', value: 'bez' },
      ]);
      if (!v || v === 'back') {
        const firstOpen = groups.find((g) => g.items.some((it) => !M.itemState(part(), it.inv)));
        if (firstOpen) { open.add(firstOpen.key); draw(); el.querySelector('.group:not(.complete)')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        return;
      }
      const invs = normal.filter((it) => !M.itemState(part(), it.inv)).map((it) => it.inv);
      await data.edit(key, ROLE, (p, stamp) => { for (const inv of invs) p.items[inv] = { s: v, ...stamp() }; });
    }
    await data.edit(key, ROLE, (p, stamp) => { p.hotovo = { v: true, ...stamp() }; });
    toast(`${room.name} hotovo`, { kind: 'ok' });
    sessionStorage.setItem('hledej-lepic', '');
    location.hash = listHref(ROLE);
  }

  mount(el, headEl, listEl, specialEl, restEl);
  draw();

  const off = data.on(async (what, k) => {
    if (what === 'room' && k === key) {
      doc = await data.room(key);
      const ae = document.activeElement;
      if (ae && ae.tagName === 'TEXTAREA') { // nerušit psaní poznámky
        mount(listEl, groups.map(groupCard));
        mount(specialEl, specialSection(ctx, key, ROLE, doc.lepic, items, { readOnly: readOnly() }));
        return;
      }
      draw();
    }
  });
  const t = setInterval(() => data.pullRoom(key), 20000);
  const onVis = () => { if (document.hidden) data.flush(key); };
  document.addEventListener('visibilitychange', onVis);
  return () => { off(); clearInterval(t); document.removeEventListener('visibilitychange', onVis); data.flush(key); };
}
