// Výstupy pro hospodářku: Excel za místnost, souhrnný přehled všech místností a text e-mailu.

import { writeWorkbook, S } from './xlsx.js';
import { CONFIG } from './config.js';
import * as M from './model.js';
import { fmt } from './ui.js';

const CO = {
  chybi: 'Chybí ve třídě',
  bez: 'Je tu, chybí štítek',
  nic: 'Neověřeno',
};

const num = (inv) => (/^\d{1,15}$/.test(String(inv)) ? { v: Number(inv), s: S.int } : String(inv ?? ''));
const money = (v) => (typeof v === 'number' ? { v, s: S.money } : '');

// Rozdíly a shody jedné místnosti
export function analyzeRoom(doc, items, index) {
  doc = doc || M.emptyRoom('');
  const jinak = [];
  const sedi = [];
  const anyDone = doc.lepic?.hotovo?.v || doc.ucitel?.hotovo?.v;
  const c = { total: items.length, sedi: 0, chybi: 0, bez: 0, navic: 0, nic: 0 };
  for (const it of items) {
    const f = M.finalState(doc, it.inv);
    if (f.s === 'ok') {
      c.sedi++;
      sedi.push({ it, jak: M.jakOvereno(f) });
    } else if (f.s === 'chybi' || f.s === 'bez') {
      c[f.s]++;
      const who = (f.u || f.l);
      jinak.push({ co: CO[f.s], s: f.s, inv: it.inv, nazev: it.nazev, kde: f.pozn, zdroj: `${f.zdroj}${who?.name ? ` – ${who.name}` : ''}`, it });
    } else {
      c.nic++;
      if (anyDone) jinak.push({ co: CO.nic, s: 'nic', inv: it.inv, nazev: it.nazev, kde: '', zdroj: '', it });
    }
  }
  // navíc z lepení i z inventury; stejné číslo jen jednou (inventura má přednost)
  const seen = new Set();
  for (const role of ['ucitel', 'lepic']) {
    for (const n of M.navicList(doc[role])) {
      const k = n.cislo ? `#${n.cislo}` : `${role}|${n.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const ev = n.cislo && index ? index.lookup(n.cislo) : null;
      let co = 'Navíc – není v evidenci';
      if (ev) co = ev.room === doc.room ? 'Navíc – už v seznamu třídy' : `Navíc – v evidenci patří do ${ev.room}`;
      else if (n.cislo) co = 'Navíc – číslo není v evidenci';
      c.navic++;
      jinak.push({
        co, s: 'navic', inv: n.cislo || '', nazev: n.nazev || ev?.nazev || '', kde: n.pozn || '',
        zdroj: `${role === 'ucitel' ? 'Inventura' : 'Lepení'}${n.name ? ` – ${n.name}` : ''}`, it: ev,
      });
    }
  }
  const order = { chybi: 0, bez: 1, navic: 2, nic: 3 };
  jinak.sort((a, b) => order[a.s] - order[b.s] || M.cmp(a.nazev, b.nazev) || M.cmp(a.inv, b.inv));
  sedi.sort((a, b) => M.cmp(a.it.nazev, b.it.nazev) || M.cmp(a.it.inv, b.it.inv));
  return { c, jinak, sedi };
}

function partText(p, items) {
  const st = M.partStatus(p, items);
  if (st === 'hotovo') return `hotovo – ${p.hotovo.name || ''}, ${fmt.dt(p.hotovo.t)}`;
  if (st === 'rozpr') return 'rozpracováno';
  return 'nezačato';
}

const JINAK_HEAD = ['Co je jinak', 'Inv. číslo', 'Název', 'Kde je / poznámka', 'Zjistil(a)', 'Skupina', 'Evid. číslo', 'Pořiz. cena'];
const JINAK_W = [34, 13, 38, 42, 30, 9, 14, 14];
const jinakRow = (j) => [j.co, num(j.inv), j.nazev, j.kde, j.zdroj, j.it?.skupina || '', j.it?.evid || '', money(j.it?.cena)];
const head = (arr) => arr.map((v) => ({ v, s: S.head }));

export function roomWorkbook(doc, items, index, kolo) {
  const a = analyzeRoom(doc, items, index);
  const now = new Date().toISOString();
  const souhrn = [
    [{ v: `Inventura ${kolo} – ${doc.room}`, s: S.title }],
    [{ v: CONFIG.schoolName, s: S.muted }],
    [],
    head(['Výsledek', 'Počet']),
    ['Sedí', a.c.sedi],
    ['Chybí ve třídě', a.c.chybi],
    ['Je tu, chybí štítek', a.c.bez],
    ['Navíc (není v seznamu třídy)', a.c.navic],
    ['Neověřeno', a.c.nic],
    [{ v: 'Celkem podle evidence', s: S.bold }, { v: a.c.total, s: S.bold }],
    [],
    head(['Kdo a kdy', '']),
    ['Lepení štítků', partText(doc.lepic, items)],
    ['Inventura', partText(doc.ucitel, items)],
    ['Poznámka z lepení', { v: doc.lepic?.pozn?.v || '', s: S.wrap }],
    ['Poznámka z inventury', { v: doc.ucitel?.pozn?.v || '', s: S.wrap }],
    [],
    [{ v: `Podrobnosti jsou na listech „Co je jinak“ a „Co sedí“. Vytvořeno ${fmt.dt(now)}.`, s: S.muted }],
  ];
  const blob = writeWorkbook([
    { name: 'Souhrn', widths: [34, 70], rows: souhrn },
    { name: 'Co je jinak', widths: JINAK_W, headerRow: 0, rows: [head(JINAK_HEAD), ...a.jinak.map(jinakRow)] },
    {
      name: 'Co sedí', widths: [13, 40, 28, 9, 14, 14], headerRow: 0,
      rows: [head(['Inv. číslo', 'Název', 'Jak ověřeno', 'Skupina', 'Evid. číslo', 'Pořiz. cena']),
        ...a.sedi.map((s) => [num(s.it.inv), s.it.nazev, s.jak, s.it.skupina || '', s.it.evid || '', money(s.it.cena)])],
    },
  ]);
  return { blob, analysis: a };
}

const STAV_TXT = { none: 'nezačato', rozpr: 'rozpracováno', hotovo: 'hotovo' };

// docs: Map(key → doc)
export function overviewWorkbook(index, docs, kolo) {
  const now = new Date().toISOString();
  const rows = [];
  const all = [];
  const tot = { total: 0, sedi: 0, chybi: 0, bez: 0, navic: 0, nic: 0, lepHot: 0, invHot: 0 };
  for (const r of index.rooms) {
    const doc = docs.get(r.key) || M.emptyRoom(r.name);
    const a = analyzeRoom(doc, r.items, index);
    const ls = M.partStatus(doc.lepic, r.items);
    const us = M.partStatus(doc.ucitel, r.items);
    if (ls === 'hotovo') tot.lepHot++;
    if (us === 'hotovo') tot.invHot++;
    for (const k of ['total', 'sedi', 'chybi', 'bez', 'navic', 'nic']) tot[k] += a.c[k];
    rows.push([
      r.name, a.c.total,
      STAV_TXT[ls], ls === 'hotovo' ? doc.lepic.hotovo.name || '' : '',
      STAV_TXT[us], us === 'hotovo' ? doc.ucitel.hotovo.name || '' : '',
      doc.ucitel?.odeslano?.t ? fmt.dt(doc.ucitel.odeslano.t) : '',
      a.c.sedi, a.c.chybi, a.c.bez, a.c.navic, a.c.nic,
    ]);
    for (const j of a.jinak) all.push([r.name, ...jinakRow(j)]);
  }
  const mistnosti = [
    [{ v: `Inventura ${kolo} – přehled místností`, s: S.title }],
    [{ v: `${CONFIG.schoolName}. Aktualizováno ${fmt.dt(now)}. Lepení hotovo ${tot.lepHot} z ${index.rooms.length}, inventura hotovo ${tot.invHot} z ${index.rooms.length}.`, s: S.muted }],
    [],
    head(['Místnost', 'Položek', 'Lepení', 'Lepil(a)', 'Inventura', 'Provedl(a)', 'Odesláno', 'Sedí', 'Chybí', 'Bez štítku', 'Navíc', 'Neověřeno']),
    ...rows,
    [{ v: 'Celkem', s: S.bold }, { v: tot.total, s: S.bold }, '', '', '', '', '',
      { v: tot.sedi, s: S.bold }, { v: tot.chybi, s: S.bold }, { v: tot.bez, s: S.bold }, { v: tot.navic, s: S.bold }, { v: tot.nic, s: S.bold }],
  ];
  const navod = [
    [{ v: 'Jak s tím pracovat', s: S.title }],
    [],
    ['1.', 'List „Místnosti“ ukazuje, kde je lepení a inventura hotová a kolik věcí nesedí.'],
    ['2.', 'List „Co je jinak – vše“ je jeden seznam všech rozdílů ze všech místností. Filtrem v hlavičce si vybereš místnost nebo druh rozdílu.'],
    ['3.', 'Každá místnost má navíc vlastní soubor ve složce „Místnosti“ (souhrn, co je jinak, co sedí).'],
    ['4.', 'Soubory se přepisují samy, když učitel nebo lepič pošle výsledek. Tento přehled je tedy vždy aktuální.'],
    [],
    ['Co je jinak', 'Význam'],
    ['Chybí ve třídě', 'Podle evidence tu věc má být, ale nikdo ji nenašel (u lepení zbyl štítek).'],
    ['Je tu, chybí štítek', 'Věc ve třídě je, ale nemá štítek. Ve sloupci „Kde je“ je napsané, kde přesně ji najdete.'],
    ['Navíc – patří do …', 'Věc je v evidenci, ale v jiné místnosti. Nejspíš se přestěhovala.'],
    ['Navíc – není v evidenci', 'Věc ve třídě je, ale v evidenci ji nemáme.'],
    ['Neověřeno', 'Místnost je uzavřená, ale u věci nikdo nevyplnil stav.'],
  ].map((r, i) => (i === 7 ? head(r) : r.map((v, j) => (j === 1 ? { v, s: S.wrap } : v))));
  return writeWorkbook([
    { name: 'Místnosti', widths: [28, 9, 13, 22, 13, 22, 16, 8, 8, 10, 8, 11], headerRow: 3, rows: mistnosti },
    { name: 'Co je jinak – vše', widths: [22, ...JINAK_W], headerRow: 0, rows: [head(['Místnost', ...JINAK_HEAD]), ...all] },
    { name: 'Jak to číst', widths: [24, 90], rows: navod },
  ]);
}

// ---------------------------------------------------------------- e-mail

const e = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TD = 'style="padding:4px 10px 4px 0;border-bottom:1px solid #d8dce5;vertical-align:top"';
const TH = 'style="text-align:left;padding:0 10px 4px 0;border-bottom:2px solid #14171f;font-weight:bold"';

function mailShell(title, inner, links) {
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:15px;color:#14171f;max-width:760px">
<p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#2A4B9B;margin:0">${e(CONFIG.schoolName)}</p>
<h2 style="margin:4px 0 12px">${e(title)}</h2>
${inner}
${links.filter((l) => l.url).length ? `<p style="margin-top:18px">${links.filter((l) => l.url).map((l) => `<a href="${e(l.url)}" style="color:#2A4B9B;font-weight:bold">${e(l.label)}</a>`).join('<br>')}</p>` : ''}
<p style="color:#5a6172;font-size:13px;margin-top:18px">Odesláno z aplikace Inventura. Excel je v příloze a zároveň uložený na SharePointu ve složce inventury.</p>
</div>`;
}

export function roomMail({ doc, analysis, user, folderUrl, fileUrl, kolo }) {
  const a = analysis;
  const rows = a.jinak.slice(0, 80).map((j) => `<tr><td ${TD}>${e(j.co)}</td><td ${TD}>${e(j.inv)}</td><td ${TD}>${e(j.nazev)}</td><td ${TD}>${e(j.kde)}</td></tr>`).join('');
  const inner = `<p>Dobrý den,<br>inventura místnosti <b>${e(doc.room)}</b> je hotová. Provedl(a) ${e(user.name)}, ${fmt.dt(new Date())}.</p>
<p><b>Sedí ${a.c.sedi}</b> z ${a.c.total}; chybí ${a.c.chybi}; bez štítku ${a.c.bez}; navíc ${a.c.navic}${a.c.nic ? `; neověřeno ${a.c.nic}` : ''}.</p>
${a.jinak.length ? `<table style="border-collapse:collapse;font-size:14px"><tr><th ${TH}>Co je jinak</th><th ${TH}>Inv. číslo</th><th ${TH}>Název</th><th ${TH}>Kde je / poznámka</th></tr>${rows}</table>
${a.jinak.length > 80 ? `<p>… a dalších ${a.jinak.length - 80} řádků v příloze.</p>` : ''}` : '<p>Všechno sedí, žádné rozdíly.</p>'}`;
  return {
    subject: `Inventura ${kolo} – ${doc.room} – hotovo`,
    html: mailShell(`Inventura – ${doc.room}`, inner, [
      { label: 'Otevřít Excel této místnosti', url: fileUrl },
      { label: 'Otevřít složku inventury (přehled všech místností)', url: folderUrl },
    ]),
  };
}

export function lepeniMail({ index, docs, user, folderUrl, kolo }) {
  const done = [];
  for (const r of index.rooms) {
    const d = docs.get(r.key);
    if (!d?.lepic?.hotovo?.v) continue;
    const c = M.counts(d.lepic, r.items);
    done.push({ r, c, navic: M.navicList(d.lepic).length });
  }
  const rows = done.map(({ r, c, navic }) => `<tr><td ${TD}>${e(r.name)}</td><td ${TD}>${c.ok}</td><td ${TD}>${c.chybi}</td><td ${TD}>${c.bez}</td><td ${TD}>${navic}</td></tr>`).join('');
  const inner = `<p>Dobrý den,<br>posílám stav lepení štítků. Hotovo je <b>${done.length} z ${index.rooms.length}</b> místností. Odeslal(a) ${e(user.name)}.</p>
<table style="border-collapse:collapse;font-size:14px"><tr><th ${TH}>Místnost</th><th ${TH}>Nalepeno</th><th ${TH}>Ve třídě není</th><th ${TH}>Nemám štítek</th><th ${TH}>Navíc</th></tr>${rows}</table>`;
  return {
    subject: `Inventura ${kolo} – lepení štítků (${done.length} z ${index.rooms.length} místností)`,
    html: mailShell('Lepení štítků', inner, [{ label: 'Otevřít složku inventury', url: folderUrl }]),
  };
}

export function fileName(s) {
  return M.roomKey(s);
}
