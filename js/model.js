// Datový model inventury. Žádná síť, jen čisté funkce – dají se testovat a sdílí je všechny obrazovky.
//
// Evidence (majetek) = co má v které místnosti být. Nahrává ji správce z Excelu.
// Dokument místnosti = co se v místnosti zjistilo. Má dvě části:
//   lepic  – lepení štítků (nalepeno / chybí ve třídě / nemám štítek)
//   ucitel – inventura učitele (je tu / chybí / je tu bez štítku)
// Každý zápis nese čas a autora, takže se dva telefony v jedné místnosti dají sloučit
// (vyhrává novější zápis u každé věci zvlášť).

import { normalize, searchKey } from './ui.js';

export const ROLES = {
  lepic: { label: 'Lepení štítků', short: 'Lepení' },
  ucitel: { label: 'Inventura', short: 'Inventura' },
};

export const STAV_LEPIC = {
  ok: 'Nalepeno',
  chybi: 'Ve třídě není',
  bez: 'Nemám štítek',
};
export const STAV_UCITEL = {
  ok: 'Je tu',
  chybi: 'Chybí',
  bez: 'Bez štítku',
};

// ---------------------------------------------------------------- druh věci podle poznámky
// Sloupec Poznámka v evidenci:
//   „neoznačeno“, „neozačeno“, „Neoznačovat“, „Neoznačeno štítkem“ → věc se nelepí ani nečte čtečkou,
//      jen se odklikne, jestli ve třídě je (typicky rozhlas, koberec, věšák).
//   „V“, „Vyřadit“ → věc jde k vyřazení, ve třídě už být nemusí.
export function itemKind(it) {
  const n = normalize(it?.pozn).replace(/\s+/g, ' ');
  if (!n) return 'normal';
  if (n === 'v' || n === 'v.' || n.startsWith('vyrad') || n.includes('vyradit')) return 'vyradit';
  if (n.includes('neoz')) return 'nestitkovat';
  return 'normal';
}
export const isSpecial = (it) => itemKind(it) !== 'normal';
export const KIND_LABEL = { nestitkovat: 'nelepí se', vyradit: 'k vyřazení' };

// ---------------------------------------------------------------- místnosti

export function roomKey(name) {
  return String(name || 'Bez místnosti')
    .replace(/["*:<>?/\\|#%~&{}\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '') || 'Bez místnosti';
}

const collator = new Intl.Collator('cs', { numeric: true, sensitivity: 'base' });
export const cmp = (a, b) => collator.compare(String(a), String(b));

// evidence → rychlé vyhledávání
export function buildIndex(master) {
  const byInv = new Map();
  const byEvid = new Map();
  const rooms = new Map();
  for (const it of master?.items || []) {
    byInv.set(String(it.inv), it);
    if (it.evid) byEvid.set(String(it.evid), it);
    const key = roomKey(it.room);
    if (!rooms.has(key)) rooms.set(key, { key, name: it.room || 'Bez místnosti', items: [], search: '' });
    rooms.get(key).items.push(it);
  }
  const list = [...rooms.values()].sort((a, b) => cmp(a.name, b.name));
  for (const r of list) {
    r.search = searchKey(r.name);
    r.items.sort((a, b) => cmp(a.nazev, b.nazev) || cmp(a.inv, b.inv));
  }
  return {
    byInv, byEvid, rooms: list, roomMap: rooms,
    lookup(code) {
      const c = String(code || '').trim();
      if (!c) return null;
      if (byInv.has(c)) return byInv.get(c);
      const noZeros = c.replace(/^0+/, '');
      if (byInv.has(noZeros)) return byInv.get(noZeros);
      if (byEvid.has(c)) return byEvid.get(c);
      const up = c.toUpperCase();
      if (byInv.has(up)) return byInv.get(up);
      if (byEvid.has(up)) return byEvid.get(up);
      return null;
    },
  };
}

// hledání místnosti: „9b“ najde „9.B Novák“; víc slov musí sedět všechna
export function filterRooms(rooms, q) {
  const words = normalize(q).split(/\s+/).filter(Boolean).map(searchKey);
  if (!words.length) return rooms;
  const starts = [], contains = [];
  for (const r of rooms) {
    if (!words.every((w) => r.search.includes(w))) continue;
    (r.search.startsWith(words[0]) ? starts : contains).push(r);
  }
  return [...starts, ...contains];
}

// Třída učitele podle příjmení v názvu místnosti („1.A Nováková“)
export function myRooms(rooms, userName) {
  const parts = normalize(userName).split(/\s+/).filter((p) => p.length >= 3);
  if (!parts.length) return [];
  return rooms.filter((r) => {
    const words = normalize(r.name).split(/[\s,.;-]+/);
    return parts.some((p) => words.includes(p));
  });
}

// stejné věci dohromady („Židle žákovská – 20 ks“)
export function groupItems(items) {
  const map = new Map();
  for (const it of items) {
    const k = normalize(it.nazev).replace(/\s+/g, ' ');
    if (!map.has(k)) map.set(k, { key: k, nazev: it.nazev, items: [] });
    map.get(k).items.push(it);
  }
  return [...map.values()].sort((a, b) => b.items.length - a.items.length || cmp(a.nazev, b.nazev));
}

// 9021334, 9021335, 9021336 → „9021334–9021336“
export function compactNumbers(invs, maxLen = 0) {
  const cut = (txt) => {
    if (!maxLen || txt.length <= maxLen) return txt;
    const i = txt.lastIndexOf(', ', maxLen);
    return `${txt.slice(0, i > 0 ? i : maxLen)} …`;
  };
  const nums = invs.map(String);
  if (!nums.every((n) => /^\d+$/.test(n))) return cut(nums.sort(cmp).join(', '));
  const s = nums.map(Number).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i + 1 ? `${s[i]}–${s[j]}` : j === i + 1 ? `${s[i]}, ${s[j]}` : `${s[i]}`);
    i = j;
  }
  return cut(out.join(', '));
}

// ---------------------------------------------------------------- dokument místnosti

function emptyPart() {
  return { items: {}, navic: {}, pozn: null, hotovo: null, odeslano: null };
}
export function emptyRoom(name) {
  return { v: 1, room: name, lepic: emptyPart(), ucitel: emptyPart() };
}

function newer(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(b.t) > String(a.t) ? b : a;
}
function mergeMap(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = newer(out[k], v);
  return out;
}
function mergePart(a = emptyPart(), b = emptyPart()) {
  return {
    items: mergeMap(a.items, b.items),
    navic: mergeMap(a.navic, b.navic),
    pozn: newer(a.pozn, b.pozn),
    hotovo: newer(a.hotovo, b.hotovo),
    odeslano: newer(a.odeslano, b.odeslano),
  };
}
export function mergeRoom(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { v: 1, room: a.room || b.room, lepic: mergePart(a.lepic, b.lepic), ucitel: mergePart(a.ucitel, b.ucitel) };
}

export function lastChange(doc) {
  let t = '';
  for (const role of ['lepic', 'ucitel']) {
    const p = doc?.[role];
    if (!p) continue;
    for (const v of [...Object.values(p.items), ...Object.values(p.navic), p.pozn, p.hotovo, p.odeslano]) {
      if (v && v.t > t) t = v.t;
    }
  }
  return t;
}

// ---------------------------------------------------------------- počty a stavy

export function itemState(part, inv) {
  const e = part?.items?.[inv];
  return e && e.s ? e : null;
}
export function navicList(part) {
  return Object.entries(part?.navic || {}).filter(([, v]) => v && !v.del).map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => String(a.t).localeCompare(String(b.t)));
}

export function counts(part, items) {
  const c = { total: items.length, ok: 0, chybi: 0, bez: 0, nic: 0, navic: navicList(part).length, sken: 0 };
  for (const it of items) {
    const e = itemState(part, it.inv);
    if (!e) c.nic++;
    else { c[e.s]++; if (e.jak === 'sken') c.sken++; }
  }
  c.done = c.total - c.nic;
  return c;
}

// 'none' | 'rozpr' | 'hotovo'
export function partStatus(part, items) {
  if (part?.hotovo?.v) return 'hotovo';
  const c = counts(part, items);
  if (c.done || c.navic || part?.pozn?.v) return 'rozpr';
  return 'none';
}

// Shrnutí místnosti pro přehled (ukládá se do stav.json).
// cisla = inventární čísla věcí, které se tu našly navíc (kvůli přesunům mezi místnostmi).
export function summarize(doc, items) {
  const cisla = new Set();
  for (const role of ['lepic', 'ucitel']) for (const n of navicList(doc[role])) if (n.cislo) cisla.add(String(n.cislo));
  const out = { room: doc.room, t: lastChange(doc), cisla: [...cisla] };
  for (const role of ['lepic', 'ucitel']) {
    const p = doc[role];
    const c = counts(p, items);
    out[role] = {
      stav: partStatus(p, items),
      total: c.total, ok: c.ok, chybi: c.chybi, bez: c.bez, nic: c.nic, navic: c.navic,
      kdo: p.hotovo?.v ? p.hotovo.name : '',
      kdy: p.hotovo?.v ? p.hotovo.t : '',
      odeslano: p.odeslano?.t || '',
    };
  }
  return out;
}

// ---------------------------------------------------------------- výsledek pro hospodářku

// Výsledný stav věci: rozhoduje inventura učitele, když chybí, tak lepení.
export function finalState(doc, inv, it = null) {
  const u = itemState(doc.ucitel, inv);
  const l = itemState(doc.lepic, inv);
  if (u) {
    // ručně odkliknutá věc, na kterou lepič neměl štítek, štítek pořád potřebuje (neplatí pro věci, co se nelepí)
    if (u.s === 'ok' && l?.s === 'bez' && u.jak !== 'sken' && !isSpecial(it)) {
      return { s: 'bez', zdroj: 'Lepení + inventura', pozn: u.pozn || 'Při lepení nebyl štítek, při inventuře nalezeno.', u, l };
    }
    return { s: u.s, zdroj: 'Inventura', pozn: u.pozn || '', u, l };
  }
  if (l) return { s: l.s, zdroj: 'Lepení', pozn: l.pozn || '', u, l };
  return { s: null, zdroj: '', pozn: '', u, l };
}

export function jakOvereno(f, it = null) {
  const kind = itemKind(it);
  if (kind !== 'normal' && (f.u?.s === 'ok' || f.l?.s === 'ok')) {
    return kind === 'vyradit' ? 'Je tu (k vyřazení)' : 'Je tu (neoznačuje se štítkem)';
  }
  if (f.u?.s === 'ok') return f.u.jak === 'sken' ? 'Inventura – čtečkou' : 'Inventura – odkliknuto';
  if (f.l?.s === 'ok') return 'Nalepeno (inventura zatím ne)';
  return '';
}

// Kde se věc našla mimo svou místnost: Map(inv → { room, key, name, t })
export function foundFromDocs(docs, index) {
  const out = new Map();
  for (const [key, doc] of docs) {
    for (const role of ['ucitel', 'lepic']) {
      for (const n of navicList(doc?.[role])) {
        if (!n.cislo) continue;
        const ev = index.lookup(n.cislo);
        if (!ev || roomKey(ev.room) === key) continue;
        const prev = out.get(String(ev.inv));
        if (!prev || String(n.t) > String(prev.t)) out.set(String(ev.inv), { room: doc.room || key, key, name: n.name || '', t: n.t, pozn: n.pozn || '', role });
      }
    }
  }
  return out;
}

export function foundFromStav(stav, index) {
  const out = new Map();
  for (const [key, s] of Object.entries(stav || {})) {
    for (const c of s?.cisla || []) {
      const ev = index.lookup(c);
      if (!ev || roomKey(ev.room) === key) continue;
      out.set(String(ev.inv), { room: s.room || key, key, t: s.t });
    }
  }
  return out;
}
