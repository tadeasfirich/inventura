// Správa: přehled všech místností, nahrání evidence z Excelu, nastavení.
// V testovacím režimu navíc „Složka pro hospodářku“ – co by se uložilo na SharePoint a odeslalo e-mailem.

import { h, mount, mark, toast, modal, confirmDialog, fmt, downloadBlob } from '../ui.js';
import * as M from '../model.js';
import { parseInventoryFiles } from '../importer.js';
import { statusMark, roomHref } from './common.js';
import { CONFIG } from '../config.js';

const STAV = { none: 'nezačato', rozpr: 'rozdělané', hotovo: 'hotovo' };

export async function render(el, ctx, { params }) {
  const tab = params[0] || 'prehled';
  const tabs = [
    { id: 'prehled', label: 'Přehled' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'nastaveni', label: 'Nastavení' },
    ...(ctx.demo ? [{ id: 'slozka', label: 'Složka (test)' }] : []),
  ];
  const body = h('div');
  mount(el,
    h('div', { class: 'page-head' },
      h('div', { class: 'eyebrow' }, `Správa – inventura ${ctx.data.kolo}`),
      h('h1', { class: 'title' }, 'Správa inventury')),
    h('nav', { class: 'seg tabs', 'aria-label': 'Části správy' }, tabs.map((t) => h('a', {
      href: `#/sprava/${t.id}`, class: 'tab-link', 'aria-current': t.id === tab ? 'page' : null,
    }, t.label))),
    body);
  const views = { prehled, evidence, nastaveni, slozka };
  return (views[tab] || prehled)(body, ctx);
}

// ---------------------------------------------------------------- přehled
function prehled(el, ctx) {
  const data = ctx.data;
  const q = { text: '' };
  const kpiEl = h('div', { class: 'kpis' });
  const tableEl = h('div', { class: 'table-wrap' });
  const actionsEl = h('div', { class: 'btn-row' });

  function draw() {
    const rooms = data.index.rooms;
    if (!rooms.length) {
      mount(kpiEl, h('div', { class: 'box dashed empty' }, h('h2', null, 'Nejdřív nahraj evidenci'),
        h('p', null, 'Excel s majetkem všech místností. Aplikace z něj pozná, co má v které místnosti být.'),
        h('a', { class: 'btn primary', href: '#/sprava/evidence' }, 'Nahrát Excel')));
      mount(tableEl); return;
    }
    const st = (k, role) => data.stav[k]?.[role] || null;
    const lepH = rooms.filter((r) => st(r.key, 'lepic')?.stav === 'hotovo').length;
    const invH = rooms.filter((r) => st(r.key, 'ucitel')?.stav === 'hotovo').length;
    const sent = rooms.filter((r) => st(r.key, 'ucitel')?.odeslano).length;
    let jinak = 0;
    for (const r of rooms) { const u = st(r.key, 'ucitel'); if (u) jinak += u.chybi + u.bez + u.navic; }
    const kpi = (n, label, of) => h('div', { class: 'kpi' }, h('b', { class: 'num' }, n, of ? h('small', null, ` / ${of}`) : null), h('span', null, label));
    mount(kpiEl,
      kpi(lepH, 'lepení hotovo', rooms.length),
      kpi(invH, 'inventura hotovo', rooms.length),
      kpi(sent, 'odesláno hospodářce', rooms.length),
      kpi(jinak, 'rozdílů z inventury'));

    const list = M.filterRooms(rooms, q.text);
    mount(tableEl, h('table', { class: 'rooms-table' },
      h('thead', null, h('tr', null, h('th', null, 'Místnost'), h('th', { class: 'n' }, 'Položek'), h('th', null, 'Lepení'), h('th', null, 'Inventura'), h('th', { class: 'n' }, 'Rozdíly'))),
      h('tbody', null, list.map((r) => {
        const l = st(r.key, 'lepic'), u = st(r.key, 'ucitel');
        const lt = l?.stav || 'none', ut = u?.stav || 'none';
        const diff = u ? u.chybi + u.bez + u.navic : (l ? l.chybi + l.bez + l.navic : 0);
        return h('tr', { class: 'click', onclick: () => roomDetail(ctx, r) },
          h('td', null, h('b', null, r.name)),
          h('td', { class: 'n' }, r.items.length),
          h('td', null, h('span', { class: 'cell-st' }, statusMark(lt), lt === 'none' ? STAV[lt] : `${STAV[lt]} ${l.ok}/${l.total}`, l?.kdo ? h('small', null, l.kdo) : null)),
          h('td', null, h('span', { class: 'cell-st' }, statusMark(ut), ut === 'none' ? STAV[ut] : `${STAV[ut]} ${u.total - u.nic}/${u.total}`, u?.odeslano ? h('small', null, `odesláno ${fmt.short(u.odeslano)}`) : (u?.kdo ? h('small', null, u.kdo) : null))),
          h('td', { class: 'n' }, diff || ''));
      }))));
  }

  mount(actionsEl,
    h('button', {
      class: 'btn primary', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try {
          const res = await data.publish((i, n) => { b.textContent = `Ukládám ${i}/${n}…`; });
          toast(`Uloženo: přehled a ${res.rooms} ${fmt.plural(res.rooms, 'místnost', 'místnosti', 'místností')}`, { kind: 'ok' });
          if (res.folderUrl) window.open(res.folderUrl, '_blank', 'noopener');
        } catch (err) { toast(err.message, { timeout: 7000 }); }
        b.disabled = false; b.textContent = 'Aktualizovat Excely pro hospodářku';
      },
    }, 'Aktualizovat Excely pro hospodářku'),
    h('button', {
      class: 'btn', onclick: async () => downloadBlob(`Inventura ${data.kolo} – přehled.xlsx`, await data.overviewXlsx()),
    }, 'Stáhnout přehled'),
    ctx.demo ? h('a', { class: 'btn ghost', href: '#/sprava/slozka' }, 'Složka hospodářky (test)') : h('button', {
      class: 'btn ghost', onclick: async () => { const u = await data.resultsUrl(); if (u) window.open(u, '_blank', 'noopener'); else toast('Složka zatím neexistuje – vznikne při prvním odeslání.'); },
    }, 'Otevřít složku na SharePointu'));

  const search = h('input', { type: 'search', class: 'search', placeholder: 'Hledej místnost', oninput: (e) => { q.text = e.target.value; draw(); } });
  mount(el, kpiEl, actionsEl, h('p', { class: 'small muted' }, 'Excely pro hospodářku se na SharePointu aktualizují samy, i když nikdo nic neodešle. Tlačítko je jen pro jistotu.'), h('div', { class: 'search-wrap' }, search), tableEl);
  draw();
  const off = data.on((w) => { if (['stav', 'master'].includes(w)) draw(); });
  data.pullStav().catch(() => {});
  const t = setInterval(() => data.pullStav().catch(() => {}), 30000);
  return () => { off(); clearInterval(t); };
}

async function roomDetail(ctx, r) {
  const doc = await ctx.data.room(r.key);
  ctx.data.pullRoom(r.key);
  modal((close) => [
    h('div', { class: 'eyebrow' }, fmt.ks(r.items.length)),
    h('h2', { class: 'dlg-title' }, r.name),
    h('p', { class: 'muted small' }, 'Jako správce můžeš místnost otevřít v kterékoli roli a cokoli opravit.'),
    h('div', { class: 'btn-col' },
      h('a', { class: 'btn', href: roomHref('lepic', r.key), onclick: close }, 'Otevřít lepení'),
      h('a', { class: 'btn', href: roomHref('ucitel', r.key), onclick: close }, 'Otevřít inventuru'),
      h('button', { class: 'btn ghost', onclick: async () => downloadBlob(`${r.key}.xlsx`, await ctx.data.roomXlsx(r.key)) }, 'Stáhnout Excel místnosti')),
    doc.lepic.pozn?.v ? h('p', { class: 'small' }, h('b', null, 'Poznámka z lepení: '), doc.lepic.pozn.v) : null,
    doc.ucitel.pozn?.v ? h('p', { class: 'small' }, h('b', null, 'Poznámka z inventury: '), doc.ucitel.pozn.v) : null,
  ]);
}

// ---------------------------------------------------------------- evidence
function evidence(el, ctx) {
  const data = ctx.data;
  const m = data.master;
  const previewEl = h('div');
  const fileInput = h('input', { type: 'file', accept: '.xlsx,.csv', multiple: true, hidden: true });

  async function handle(files) {
    if (!files.length) return;
    mount(previewEl, h('p', { class: 'muted' }, 'Čtu Excel…'));
    let res;
    try { res = await parseInventoryFiles([...files]); } catch (e) {
      mount(previewEl, h('div', { class: 'box dashed' }, h('b', null, 'Excel se nepodařilo přečíst. '), e.message)); return;
    }
    if (!res.items.length) {
      mount(previewEl, h('div', { class: 'box dashed' }, h('b', null, 'V souboru jsem nenašel žádné položky.'),
        h('ul', null, res.warnings.slice(0, 8).map((w) => h('li', null, w))))); return;
    }
    const idx = M.buildIndex({ items: res.items });
    const known = new Set(data.index.rooms.map((r) => r.key));
    mount(previewEl, h('section', { class: 'box fill' },
      h('h4', null, 'Náhled'),
      h('p', { class: 'big-num' }, h('b', { class: 'num' }, res.items.length), ' položek v ', h('b', { class: 'num' }, idx.rooms.length), ' místnostech'),
      res.warnings.length ? h('details', null, h('summary', null, `Upozornění (${res.warnings.length})`),
        h('ul', { class: 'small' }, res.warnings.slice(0, 50).map((w) => h('li', null, w)))) : null,
      h('div', { class: 'table-wrap preview' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Místnost'), h('th', { class: 'n' }, 'Položek'), h('th', null, 'Například'))),
        h('tbody', null, idx.rooms.map((r) => h('tr', null,
          h('td', null, r.name, known.size && !known.has(r.key) ? h('small', { class: 'tag' }, 'nová') : null),
          h('td', { class: 'n' }, r.items.length),
          h('td', { class: 'muted small' }, M.groupItems(r.items).slice(0, 3).map((g) => `${g.nazev} ${g.items.length}×`).join('; '))))))),
      h('p', { class: 'small muted' }, 'Co už je odklikané, zůstane – stav se pamatuje podle inventárních čísel.'),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn primary', onclick: async (e) => {
            const btn = e.currentTarget; // po await už currentTarget neexistuje
            if (data.master && !(await confirmDialog('Nahradit evidenci?', `Současná evidence (${data.master.items.length} položek) se nahradí novou (${res.items.length} položek).`, 'Nahradit'))) return;
            btn.disabled = true; btn.textContent = 'Nahrávám…';
            try {
              await data.saveMaster({
                v: 1, kolo: data.kolo, imported: new Date().toISOString(), by: ctx.user.name,
                file: [...files].map((f) => f.name).join(', '), items: res.items,
              });
              toast('Evidence nahraná', { kind: 'ok' });
              ctx.navigate('#/sprava/prehled');
            } catch (err) { toast(err.message, { timeout: 8000 }); btn.disabled = false; btn.textContent = 'Nahrát do aplikace'; }
          },
        }, 'Nahrát do aplikace'),
        h('button', { class: 'btn ghost', onclick: () => mount(previewEl) }, 'Zrušit'))));
  }
  fileInput.addEventListener('change', () => handle(fileInput.files));

  const drop = h('button', { class: 'dropzone', onclick: () => fileInput.click() },
    h('b', null, 'Vyber Excel s evidencí'),
    h('span', null, 'nebo ho sem přetáhni. Jeden soubor se všemi místnostmi (můžeš vybrat i víc souborů naráz).'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files); });

  mount(el,
    h('section', { class: 'box' },
      h('h4', null, 'Současná evidence'),
      m ? [
        h('p', null, h('b', { class: 'num' }, m.items.length), ' položek, ', h('b', { class: 'num' }, data.index.rooms.length), ' místností'),
        h('p', { class: 'small muted' }, `Soubor ${m.file || '–'}; nahrál(a) ${m.by || '–'} ${m.imported ? fmt.dt(m.imported) : ''}`),
      ] : h('p', null, 'Zatím nic nenahráno.')),
    h('section', { class: 'section' },
      h('h2', null, 'Nahrát nový Excel'),
      h('p', { class: 'muted' }, 'Formát jako export z účetnictví: sloupce Invent.číslo, Název a Text z čís. Místnost (na pořadí nezáleží). Inventární číslo musí být stejné jako číslo pod čárovým kódem na štítku.'),
      drop, fileInput,
      h('p', { class: 'small' }, h('a', { href: 'docs/vzor-evidence.xlsx', download: true }, 'Stáhnout vzorový Excel'))),
    previewEl);
  return null;
}

// ---------------------------------------------------------------- nastavení
function nastaveni(el, ctx) {
  const data = ctx.data;
  const s = data.settings;
  const f = {
    prijemceJmeno: h('input', { type: 'text', value: s.prijemceJmeno }),
    prijemceEmail: h('input', { type: 'email', value: s.prijemceEmail }),
    posilatEmail: h('input', { type: 'checkbox', checked: s.posilatEmail || undefined }),
    kolo: h('input', { type: 'text', value: s.kolo }),
  };
  const save = async (e) => {
    e.preventDefault();
    const patch = {
      prijemceJmeno: f.prijemceJmeno.value.trim() || 'hospodářce',
      prijemceEmail: f.prijemceEmail.value.trim(),
      posilatEmail: f.posilatEmail.checked,
      kolo: f.kolo.value.trim().replace(/[\\/:*?"<>|#%]/g, '-') || s.kolo,
    };
    if (patch.kolo !== s.kolo && !(await confirmDialog('Začít novou inventuru?', `Inventura „${s.kolo}“ zůstane uložená. Všichni teď budou zapisovat do „${patch.kolo}“ (nová složka „Výsledky ${patch.kolo}“). Evidence se převezme, nebo nahraj novou.`, 'Začít novou'))) return;
    try { await data.saveSettings(patch); toast('Uloženo', { kind: 'ok' }); ctx.navigate('#/sprava/nastaveni'); } catch (err) { toast(err.message, { timeout: 7000 }); }
  };
  mount(el, h('form', { class: 'stack form-narrow', onsubmit: save },
    h('section', { class: 'box' },
      h('h4', null, 'Komu se výsledky posílají'),
      h('label', { class: 'field' }, h('span', null, 'Jméno na tlačítku („Poslat …“)'), f.prijemceJmeno, h('small', { class: 'muted' }, 'Ve 3. pádě, např. „Marcelce“.')),
      h('label', { class: 'field' }, h('span', null, 'E-mail'), f.prijemceEmail),
      h('label', { class: 'check' }, f.posilatEmail, 'Posílat e-mail s Excelem v příloze'),
      h('p', { class: 'small muted' }, `E-mail odchází ze školního účtu toho, kdo tlačítko zmáčkne. Excely se ukládají vždy do SharePointu: ${CONFIG.sharepoint.folder} / Výsledky ${s.kolo}.`)),
    h('section', { class: 'box' },
      h('h4', null, 'Inventura'),
      h('label', { class: 'field' }, h('span', null, 'Název inventury'), f.kolo, h('small', { class: 'muted' }, 'Např. „2026“. Změnou začneš novou inventuru s čistým stavem.'))),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Uložit'))),
    ctx.demo ? h('section', { class: 'box dashed', style: { marginTop: '24px' } },
      h('h4', null, 'Testovací režim'),
      h('p', null, 'Data jsou jen v tomto prohlížeči. Můžeš je smazat a začít s ukázkovou evidencí znovu.'),
      h('button', {
        class: 'btn', onclick: async () => {
          if (!(await confirmDialog('Smazat testovací data?', 'Všechno odklikané se ztratí.', 'Smazat'))) return;
          await ctx.be.reset(); location.reload();
        },
      }, 'Smazat testovací data')) : null);
  return null;
}

// ---------------------------------------------------------------- testovací složka hospodářky
async function slozka(el, ctx) {
  const be = ctx.be;
  if (!be.files) { mount(el, h('p', null, 'Jen v testovacím režimu.')); return null; }
  const files = await be.files();
  const mails = await be.mails();
  mount(el,
    h('p', { class: 'sub' }, `Takhle to uvidí hospodářka. Na SharePointu: knihovna Dokumenty → ${CONFIG.sharepoint.folder} → Výsledky ${ctx.data.kolo}.`),
    h('section', { class: 'section' },
      h('h2', null, 'Soubory'),
      files.length ? h('ul', { class: 'files' }, files.map((f) => h('li', null,
        mark('ok'),
        h('div', { class: 'grow' }, h('b', null, f.path.split('/').slice(1).join(' / ')), h('small', { class: 'muted' }, `${fmt.dt(f.t)}; ${Math.round(f.size / 1024)} kB`)),
        h('button', { class: 'btn small', onclick: () => downloadBlob(f.path.split('/').pop(), f.blob) }, 'Stáhnout'))))
        : h('p', { class: 'muted' }, 'Zatím nic. Soubory vzniknou, když učitel nebo lepič pošle výsledek.')),
    h('section', { class: 'section' },
      h('h2', null, 'Odeslané e-maily'),
      mails.length ? h('ul', { class: 'files' }, mails.map((m) => h('li', null,
        mark('opt'),
        h('div', { class: 'grow' }, h('b', null, m.subject), h('small', { class: 'muted' }, `komu: ${m.to}; ${fmt.dt(m.t)}`)),
        h('button', {
          class: 'btn small', onclick: () => modal(() => [
            h('div', { class: 'eyebrow' }, `komu: ${m.to}`),
            h('h2', { class: 'dlg-title' }, m.subject),
            h('div', { class: 'mail-preview', html: m.html }),
            h('div', { class: 'btn-row' }, m.attachments.map((a) => h('button', { class: 'btn small', onclick: () => downloadBlob(a.name, a.blob) }, `Příloha: ${a.name}`))),
          ], { wide: true }),
        }, 'Zobrazit'))))
        : h('p', { class: 'muted' }, 'Zatím žádný.')));
  return null;
}
