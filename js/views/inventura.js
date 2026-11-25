// Inventura učitele v jedné místnosti.
// Zapnu čtečku, projdu třídu, každý načtený štítek se sám odškrtne. Pak vidím, co zbývá:
// dohledám, odkliknu („Je tu“), označím „Chybí“, nebo „Bez štítku“ s poznámkou, kde věc stojí.
// Věc z jiné místnosti se zapíše jako navíc i s tím, kam patří. Nakonec „Poslat Marcelce“.

import { h, mount, mark, toast, ask, formDialog, modal, fmt, uid } from '../ui.js';
import * as M from '../model.js';
import { listHref, progress, navicSection, noteSection, readOnlyBanner, emptyMaster, downloadRoom, sendResult, addNavicDialog, invBlock, specialSection, itemQuery, roomSearchInput } from './common.js';
import { CameraScanner, cameraSupported, listenKeyboardScanner, feedback, fixKeyboard, prewarm, soundOn, setSound, unlockAudio } from '../scanner.js';

const ROLE = 'ucitel';
const TABS = [
  { id: 'zbyva', label: 'Zbývá' },
  { id: 'hotovo', label: 'Hotovo' },
  { id: 'jinak', label: 'Jinak' },
  { id: 'vse', label: 'Vše' },
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
  prewarm();
  const items = room.items;
  const inRoom = new Set(items.map((i) => String(i.inv)));
  const open = new Set();
  let tab = 'zbyva';
  let doc = await data.room(key);
  data.pullRoom(key);

  const part = () => doc.ucitel;
  const readOnly = () => !!part().hotovo?.v;
  const lep = (inv) => M.itemState(doc.lepic, inv);

  // ---------- čtečka ----------
  let scanner = null;
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
  const lastEl = h('div', { class: 'scan-last', 'aria-live': 'assertive' }, h('span', { class: 'muted' }, 'Namiř na čárový kód štítku'));
  const torchBtn = h('button', { class: 'btn small dark', hidden: true, onclick: async () => { const on = await scanner.toggleTorch(); torchBtn.setAttribute('aria-pressed', String(on)); } }, 'Světlo');
  const zoomBtn = h('button', { class: 'btn small dark', hidden: true, onclick: async () => { const on = await scanner.toggleZoom(); zoomBtn.setAttribute('aria-pressed', String(on)); } }, 'Přiblížit');
  const soundBtn = h('button', {
    class: 'btn small dark', 'aria-pressed': String(soundOn()),
    onclick: () => { const on = !soundOn(); setSound(on); soundBtn.setAttribute('aria-pressed', String(on)); soundBtn.textContent = on ? 'Zvuk' : 'Bez zvuku'; },
  }, soundOn() ? 'Zvuk' : 'Bez zvuku');
  const scanPanel = h('section', { class: 'scan-panel', hidden: true },
    h('div', { class: 'scan-view' }, video, h('div', { class: 'scan-frame', 'aria-hidden': 'true' }, h('i'))),
    h('div', { class: 'scan-tools' }, torchBtn, zoomBtn, soundBtn, h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => stopScan() }, 'Vypnout čtečku')),
    lastEl);

  async function startScan() {
    unlockAudio();
    if (!cameraSupported()) { toast('Tento prohlížeč neumí kameru. Použij ruční zadání nebo Bluetooth čtečku.', { timeout: 7000 }); return; }
    scanPanel.hidden = false;
    scanBtnWrap.hidden = true;
    mount(lastEl, h('span', { class: 'muted' }, 'Zapínám kameru…'));
    scanner = new CameraScanner(video, { onCode: (c) => onCode(c, 'kamera'), isKnown: (c) => !!data.index.lookup(c) });
    try {
      await scanner.start();
      torchBtn.hidden = !scanner.hasTorch;
      zoomBtn.hidden = !scanner.hasZoom;
      mount(lastEl, h('span', { class: 'muted' }, 'Namiř na čárový kód štítku (asi 10–20 cm)'));
      scanPanel.scrollIntoView({ block: 'start' });
    } catch (e) {
      console.error(e);
      stopScan();
      const msg = e && e.name === 'NotAllowedError'
        ? 'Kamera není povolená. Povol ji v prohlížeči (ikona zámku vedle adresy) a zkus znovu.'
        : (e && e.name === 'NotFoundError') ? 'V zařízení není kamera.' : 'Čtečku se nepodařilo spustit. Bez internetu se napoprvé nemusí načíst – zkus to s wifi, příště už půjde i bez ní.';
      toast(msg, { timeout: 9000 });
    }
  }
  function stopScan() {
    if (scanner) scanner.stop();
    scanner = null;
    scanPanel.hidden = true;
    scanBtnWrap.hidden = false;
  }

  function showLast(kind, title, sub) {
    const shape = kind === 'ok' ? 'ok' : kind === 'again' ? 'opt' : 'bad';
    mount(lastEl, mark(shape, 'lg'), h('div', { class: 'grow' }, h('b', null, title), sub ? h('div', { class: 'small' }, sub) : null),
      h('span', { class: 'num scan-count' }, `${M.counts(part(), items).done}/${items.length}`));
    lastEl.className = `scan-last flash-${kind}`;
    void lastEl.offsetWidth;
    lastEl.classList.add('flash');
  }

  async function onCode(raw, src) {
    if (readOnly()) { toast('Místnost je uzavřená. Nahoře ji můžeš otevřít znovu.'); return; }
    const code = fixKeyboard(raw);
    const it = data.index.lookup(code);
    if (it && inRoom.has(String(it.inv))) {
      const cur = M.itemState(part(), it.inv);
      if (cur?.s === 'ok') { feedback('again'); showLast('again', `Už načteno – ${it.nazev}`, `${it.inv}`); return; }
      await data.edit(key, ROLE, (p, stamp) => { p.items[it.inv] = { s: 'ok', jak: 'sken', ...stamp() }; });
      feedback('ok');
      showLast('ok', it.nazev, `${it.inv}${cur ? ` (předtím: ${M.STAV_UCITEL[cur.s]})` : ''}`);
      return;
    }
    if (it) {
      // věc z jiné místnosti → vyskočí okno, člověk ji označí a hospodářka ji v evidenci převede
      const exists = M.navicList(part()).find((n) => n.cislo === String(it.inv));
      if (exists) { feedback('again'); showLast('again', `Už zapsáno jako navíc – ${it.nazev}`, `patří do ${it.room}`); return; }
      feedback('jinde');
      showLast('jinde', `Sem nepatří: ${it.nazev}`, `${it.inv} – podle evidence ${it.room}`);
      scanner?.pause();
      const r = await foreignDialog(it);
      scanner?.resume();
      if (!r) { showLast('again', 'Nezapsáno', `${it.inv} ${it.nazev}`); return; }
      await data.edit(key, ROLE, (p, stamp) => { p.navic[uid()] = { cislo: String(it.inv), nazev: it.nazev, odkud: it.room, pozn: r.pozn, ...stamp() }; });
      showLast('jinde', `Zapsáno navíc: ${it.nazev}`, `${it.inv} – v evidenci se převede z ${it.room} sem`);
      return;
    }
    // neznámé číslo
    feedback('jinde');
    showLast('jinde', 'Neznámé číslo', code);
    scanner?.pause();
    const r = await addNavicDialog(data.index, key, { cislo: code });
    scanner?.resume();
    if (r) await data.edit(key, ROLE, (p, stamp) => { p.navic[uid()] = { ...r, ...stamp() }; });
  }

  function foreignDialog(it) {
    return new Promise((resolve) => {
      let out = null;
      modal((close) => {
        const ta = h('textarea', { rows: 2, placeholder: 'např. u okna, třetí lavice' });
        return [
          h('div', { class: 'eyebrow' }, 'Tahle věc sem nepatří'),
          h('h2', { class: 'dlg-title' }, it.nazev),
          h('div', { class: 'box fill foreign' },
            h('div', null, h('small', null, 'Číslo'), h('b', { class: 'num' }, it.inv)),
            h('div', null, h('small', null, 'Podle evidence je v'), h('b', null, it.room)),
            h('div', null, h('small', null, 'Teď je tady'), h('b', null, room.name))),
          h('p', { class: 'dlg-text' }, `Zapiš ji jako navíc. Hospodářka ji pak v evidenci převede sem a v ${it.room} se neukáže jako chybějící.`),
          h('label', { class: 'field' }, h('span', null, 'Kde přesně stojí', h('em', null, ' (nepovinné)')), ta),
          h('div', { class: 'btn-col' },
            h('button', { class: 'btn primary', autofocus: true, onclick: () => { out = { pozn: ta.value.trim() }; close(); } }, 'Zapsat – je tady'),
            h('button', { class: 'btn ghost', onclick: () => close() }, 'Nezapisovat (omyl)')),
        ];
      }, { onClose: () => resolve(out) });
    });
  }

  // ruční zadání (a Bluetooth čtečka, když je kurzor v políčku)
  const manual = h('input', {
    type: 'text', inputmode: 'numeric', class: 'manual-input', placeholder: 'Číslo ze štítku',
    'aria-label': 'Číslo ze štítku', autocomplete: 'off', enterkeyhint: 'done',
  });
  const submitManual = () => { const v = manual.value.trim(); if (!v) return; manual.value = ''; onCode(v, 'ruka'); };
  manual.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitManual(); } });
  const scanBtnWrap = h('div', { class: 'scan-start' },
    h('button', { class: 'btn primary wide xl', onclick: startScan }, h('span', { class: 'barcode-ico', 'aria-hidden': 'true' }), 'Zapnout čtečku'));
  const manualRow = h('div', { class: 'manual' }, manual, h('button', { class: 'btn', onclick: submitManual }, 'Zapsat'));
  const offKeys = listenKeyboardScanner((c) => onCode(c, 'ctecka'));

  // ---------- seznam ----------
  const headEl = h('div');
  const tabsEl = h('div', { class: 'seg tabs', role: 'tablist' });
  const listEl = h('div', { class: 'groups' });
  const specialEl = h('div');
  const restEl = h('div');
  const normal = items.filter((it) => !M.isSpecial(it));

  function setItem(inv, s, extra = {}) {
    return data.edit(key, ROLE, (p, stamp) => { p.items[inv] = { s, jak: s === 'ok' ? 'ruka' : undefined, ...extra, ...stamp() }; });
  }

  async function markBez(it) {
    const cur = M.itemState(part(), it.inv);
    const r = await formDialog(`Bez štítku – ${it.nazev}`, [
      { name: 'pozn', label: 'Kde přesně ve třídě je?', required: true, type: 'textarea', value: cur?.s === 'bez' ? cur.pozn : '', placeholder: 'např. druhá lavice od okna, u katedry' },
    ], { ok: 'Uložit', text: `Číslo ${it.inv}. Podle poznámky ji hospodářka najde a dolepí štítek.` });
    if (r) await setItem(it.inv, 'bez', { pozn: r.pozn });
  }

  async function itemMenu(it) {
    const v = await ask(it.nazev, `Číslo ${it.inv}`, [
      { label: 'Je tu', value: 'ok', kind: 'primary' },
      { label: 'Je tu, ale nemá štítek', value: 'bez' },
      { label: 'Chybí', value: 'chybi' },
      { label: 'Zrušit označení', value: 'clear', kind: 'ghost' },
    ]);
    if (!v) return;
    if (v === 'bez') return markBez(it);
    await setItem(it.inv, v === 'clear' ? '' : v);
  }

  const inTab = (it) => {
    const s = M.itemState(part(), it.inv);
    if (tab === 'zbyva') return !s;
    if (tab === 'hotovo') return s?.s === 'ok';
    if (tab === 'jinak') return s && s.s !== 'ok';
    return true;
  };

  // hledání v seznamu: název ukáže celou skupinu, číslo jen kusy, které sedí
  let q = itemQuery('');
  const searchEl = roomSearchInput((v) => { q = itemQuery(v); drawList(); }, { sticky: false });

  function groupCard(g) {
    const ro = readOnly();
    const nameHit = q.empty || g.items.some(q.name);
    const shown = g.items.filter((it) => inTab(it) && (nameHit || q.num(it)));
    if (!shown.length) return null;
    if (g.items.length === 1) return singleCard(g.items[0], ro);
    const sts = g.items.map((it) => M.itemState(part(), it.inv));
    const done = sts.filter(Boolean).length;
    const bad = sts.filter((s) => s && s.s !== 'ok').length;
    const unset = g.items.filter((_, i) => !sts[i]);
    const isOpen = open.has(g.key) || g.items.length === 1 || tab === 'jinak' || !nameHit;
    const shape = done === g.items.length ? (bad ? 'bad' : 'ok') : done ? 'wait' : 'opt';
    return h('article', { class: `group ${isOpen ? 'open' : ''}` },
      h('div', { class: 'group-main' },
        mark(shape, 'lg'),
        h('div', { class: 'grow' },
          h('h3', null, g.nazev),
          h('div', { class: 'meta' },
            h('span', { class: 'count num' }, `${done} z ${g.items.length}`),
            g.items.length > 1 ? h('span', { class: 'nums num' }, M.compactNumbers(shown.map((i) => i.inv), 48)) : null)),
        !ro && unset.length && g.items.length > 1 ? h('button', {
          class: 'btn big-tap',
          onclick: () => {
            const invs = unset.map((i) => i.inv);
            data.edit(key, ROLE, (p, stamp) => { for (const inv of invs) p.items[inv] = { s: 'ok', jak: 'ruka', ...stamp() }; });
            toast(`Odkliknuto ${invs.length}× – ${g.nazev}`, {
              action: 'Zpět',
              onAction: () => data.edit(key, ROLE, (p, stamp) => { for (const inv of invs) p.items[inv] = { s: '', ...stamp() }; }),
            });
          },
        }, `Je tu všech ${unset.length}`) : null),
      g.items.length > 1 && tab !== 'jinak' ? h('button', {
        class: 'group-toggle', 'aria-expanded': String(isOpen),
        onclick: () => { if (open.has(g.key)) open.delete(g.key); else open.add(g.key); drawList(); },
      }, h('span', null, isOpen ? 'Sbalit' : `Rozkliknout (${shown.length})`)) : null,
      isOpen ? h('ul', { class: 'items' }, shown.map((it) => itemRow(it, ro))) : null);
  }

  function itemHint(it) {
    const cur = M.itemState(part(), it.inv);
    const l = lep(it.inv);
    return [
      it.pozn,
      l && l.s !== 'ok' ? `lepení: ${M.STAV_LEPIC[l.s].toLowerCase()}` : '',
      found.get(String(it.inv)) ? `našlo se v ${found.get(String(it.inv)).room}` : '',
      cur?.pozn,
    ].filter(Boolean).join(' – ');
  }

  function itemActions(it, ro) {
    const cur = M.itemState(part(), it.inv);
    if (ro) return cur ? h('span', { class: `state st-${cur.s}` }, M.STAV_UCITEL[cur.s]) : h('span', { class: 'muted small' }, 'neověřeno');
    if (!cur) {
      return h('div', { class: 'seg seg-item' },
        h('button', { onclick: () => setItem(it.inv, 'ok') }, 'Je tu'),
        h('button', { onclick: () => setItem(it.inv, 'chybi') }, 'Chybí'),
        h('button', { onclick: () => markBez(it) }, 'Bez štítku'));
    }
    return h('button', { class: `state st-${cur.s}`, onclick: () => itemMenu(it) },
      cur.s === 'ok' && cur.jak === 'sken' ? 'Načteno' : M.STAV_UCITEL[cur.s], h('span', { class: 'edit-ico', 'aria-hidden': 'true' }));
  }

  function itemRow(it, ro) {
    const cur = M.itemState(part(), it.inv);
    const hint = itemHint(it);
    return h('li', { class: `item ${cur ? 'is-' + cur.s : ''}` },
      h('div', { class: 'item-id' },
        invBlock(it, hint ? h('small', { class: 'muted' }, hint) : null)),
      itemActions(it, ro));
  }

  // jedna věc = jeden řádek bez rozklikávání
  function singleCard(it, ro) {
    const cur = M.itemState(part(), it.inv);
    const hint = itemHint(it);
    const shape = !cur ? 'opt' : cur.s === 'ok' ? 'ok' : 'bad';
    return h('article', { class: 'group single' },
      h('div', { class: 'group-main' },
        mark(shape, 'lg'),
        h('div', { class: 'grow' },
          h('h3', null, it.nazev),
          h('div', { class: 'meta' }, h('span', { class: 'count num' }, it.inv), it.evid ? h('span', { class: 'num' }, `(${it.evid})`) : null, hint ? h('span', null, hint) : null)),
        h('div', { class: 'single-actions' }, itemActions(it, ro))));
  }

  let found = data.foundElsewhere();
  function drawList() {
    found = data.foundElsewhere();
    const c = M.counts(part(), items);
    const n = { zbyva: c.nic, hotovo: c.ok, jinak: c.chybi + c.bez, vse: c.total };
    mount(tabsEl, TABS.map((t) => h('button', {
      role: 'tab', 'aria-selected': String(tab === t.id), 'aria-pressed': String(tab === t.id),
      onclick: () => { tab = t.id; drawList(); },
    }, t.label, h('span', { class: 'cnt' }, n[t.id]))));
    const cards = M.groupItems(normal).map(groupCard).filter(Boolean);
    const sp = q.empty ? items : items.filter((it) => M.isSpecial(it) && (q.name(it) || q.num(it)));
    mount(specialEl, sp.length ? specialSection(ctx, key, ROLE, part(), sp, { readOnly: readOnly() }) : null);
    let empty = null;
    if (!q.empty && !cards.length) {
      mount(listEl, h('p', { class: 'muted empty-q' }, sp.length ? 'V této záložce nic, podívej se níž nebo do záložky Vše.' : 'V této místnosti nic takového není. Zkus jiné slovo nebo číslo, nebo záložku Vše.'));
      return;
    }
    const specialLeft = items.filter((it) => M.isSpecial(it) && !M.itemState(part(), it.inv)).length;
    if (!cards.length && tab === 'zbyva' && specialLeft) {
      empty = h('p', { class: 'hint' }, `Se štítkem je hotovo. Odklikni ještě ${specialLeft} ${fmt.plural(specialLeft, 'věc', 'věci', 'věcí')} bez štítku níže.`);
    } else if (!cards.length) {
      if (tab === 'zbyva') empty = h('div', { class: 'box fill all-done' }, mark('ok', 'lg'), h('div', null, h('b', null, 'Všechno je označené.'), h('p', null, `Zkontroluj „Navíc“ dole a pošli výsledek ${ctx.prijemce}.`)));
      else empty = h('p', { class: 'muted empty-q' }, tab === 'jinak' ? 'Nic nechybí, všechno má štítek.' : 'Zatím nic.');
    }
    mount(listEl, cards.length ? cards : empty);
  }

  function drawHead() {
    const c = M.counts(part(), items);
    mount(headEl,
      h('a', { class: 'back', href: listHref(ROLE) }, 'Místnosti'),
      h('div', { class: 'eyebrow' }, `Inventura ${data.kolo} – ${fmt.ks(items.length)}`),
      h('h1', { class: 'title' }, room.name),
      progress(c.done, c.total, 'Ověřeno'),
      h('div', { class: 'legend' },
        h('span', null, mark('ok'), `Je tu ${c.ok}`),
        h('span', null, mark('bad'), `Chybí ${c.chybi}`),
        h('span', null, mark('bad'), `Bez štítku ${c.bez}`),
        h('span', null, mark('bad'), `Navíc ${c.navic}`)),
      readOnlyBanner(part(), 'Inventura', async () => {
        await data.edit(key, ROLE, (p, stamp) => { p.hotovo = { v: false, ...stamp() }; });
      }));
    scanBtnWrap.hidden = readOnly() || !!scanner;
    manualRow.hidden = readOnly();
  }

  function drawRest() {
    const ro = readOnly();
    const sent = part().odeslano;
    mount(restEl,
      navicSection(ctx, key, ROLE, part(), { readOnly: ro }),
      noteSection(ctx, key, ROLE, part(), { readOnly: ro }),
      ro
        ? h('div', { class: 'btn-col' },
          h('button', { class: 'btn primary wide xl', onclick: () => doSend() }, sent ? `Poslat ${ctx.prijemce} znovu` : `Poslat ${ctx.prijemce}`),
          h('button', { class: 'btn ghost wide', onclick: () => downloadRoom(ctx, key) }, 'Stáhnout Excel'))
        : h('div', { class: 'btn-col' },
          h('button', { class: 'btn primary wide xl', onclick: finish }, `Hotovo – poslat ${ctx.prijemce}`),
          h('button', { class: 'btn ghost wide', onclick: () => downloadRoom(ctx, key) }, 'Stáhnout Excel')));
  }

  function draw() { drawHead(); drawList(); drawRest(); }

  async function finish() {
    let c = M.counts(part(), items);
    if (c.nic) {
      const jinde = items.filter((it) => !M.itemState(part(), it.inv) && found.get(String(it.inv))).length;
      const v = await ask(`Zbývá ${c.nic} ${fmt.plural(c.nic, 'věc', 'věci', 'věcí')}`, `Nejsou načtené ani odkliknuté. Co s nimi?${jinde ? ` (${jinde} z nich se našlo v jiné místnosti – tam to hospodářka uvidí jako přesun.)` : ''}`, [
        { label: 'Zpět, dohledám je', value: 'back', kind: 'primary' },
        { label: 'Označit jako chybí', value: 'chybi' },
      ]);
      if (v !== 'chybi') { tab = 'zbyva'; drawList(); tabsEl.scrollIntoView({ behavior: 'smooth' }); return; }
      const invs = items.filter((it) => !M.itemState(part(), it.inv)).map((it) => it.inv);
      await data.edit(key, ROLE, (p, stamp) => { for (const inv of invs) p.items[inv] = { s: 'chybi', ...stamp() }; });
      c = M.counts(part(), items);
    }
    const v = await ask(`Poslat ${ctx.prijemce}?`, `Je tu ${c.ok}; chybí ${c.chybi}; bez štítku ${c.bez}; navíc ${c.navic}. Uloží se Excel na SharePoint${data.settings.posilatEmail ? ' a odejde e-mail' : ''}.`, [
      { label: `Poslat ${ctx.prijemce}`, value: 'send', kind: 'primary' },
      { label: 'Jen uzavřít, pošlu později', value: 'close' },
      { label: 'Zpět', value: null, kind: 'ghost' },
    ]);
    if (!v) return;
    stopScan();
    await data.edit(key, ROLE, (p, stamp) => { p.hotovo = { v: true, ...stamp() }; });
    if (v === 'send') await doSend();
  }

  async function doSend() {
    const t = toast('Odesílám…', { timeout: 30000 });
    const res = await data.send(ROLE, [key]);
    t();
    sendResult(ctx, res);
  }

  mount(el, headEl, scanBtnWrap, scanPanel, manualRow, searchEl, tabsEl, listEl, specialEl, restEl);
  draw();

  const off = data.on(async (what, k) => {
    if (what === 'stav') { drawList(); return; }
    if (what === 'room' && k === key) {
      doc = await data.room(key);
      drawHead(); drawList();
      const ae = document.activeElement;
      if (!(ae && ae.tagName === 'TEXTAREA')) drawRest();
    }
  });
  const onVis = () => { if (document.hidden) { if (scanner) stopScan(); data.flush(key); } };
  document.addEventListener('visibilitychange', onVis);
  const t = setInterval(() => data.pullRoom(key), 20000);
  return () => { off(); offKeys(); stopScan(); clearInterval(t); document.removeEventListener('visibilitychange', onVis); data.flush(key); };
}
