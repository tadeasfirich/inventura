// Načtení evidence majetku z Excelu (export z účetního programu).
// Hlavičku najde sám, na pořadí sloupců nezáleží. Místnost bere ze sloupce
// „Text z čís. Místnost“ (např. „1.A Nováková“); když chybí, ze sloupce „Místnost“,
// a když není ani ten, použije název listu (jeden list = jedna místnost).

import { readWorkbook } from './xlsx.js';
import { normalize } from './ui.js';

const COLS = {
  inv: (h) => h.includes('invent'),
  evid: (h) => h.includes('evid'),
  nazev: (h) => h.startsWith('nazev') || h === 'nazev',
  skupina: (h) => h.startsWith('skupina'),
  pozn: (h) => h.startsWith('poznamka'),
  vyrob: (h) => h.includes('vyrob'),
  cena: (h) => h.includes('cena'),
  datum: (h) => h.startsWith('datum'),
  odp: (h) => h.includes('odpov'),
};

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const hs = (rows[i] || []).map((v) => normalize(v));
    if (hs.some((x) => x.includes('invent')) && hs.some((x) => x.startsWith('nazev'))) return i;
  }
  return -1;
}

function mapColumns(header) {
  const hs = header.map((v) => normalize(v));
  const map = {};
  for (const [k, test] of Object.entries(COLS)) {
    const i = hs.findIndex((x) => x && test(x));
    if (i >= 0) map[k] = i;
  }
  let room = hs.findIndex((x) => x.includes('text') && x.includes('mistnost'));
  if (room < 0) room = hs.findIndex((x) => x === 'mistnost');
  if (room < 0) room = hs.findIndex((x) => x.includes('mistnost'));
  if (room >= 0) map.room = room;
  return map;
}

function clean(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

// Místnost ze sloupce „Místnost“ bývá v exportu rozbitá na datum (1.A → 1. dubna). Takovou nebereme.
function looksBroken(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }

export async function parseInventoryFiles(files) {
  const items = [];
  const warnings = [];
  const seen = new Map();
  for (const file of files) {
    const buf = await file.arrayBuffer();
    let sheets;
    if (/\.csv$/i.test(file.name)) sheets = [{ name: file.name.replace(/\.csv$/i, ''), rows: parseCsv(new TextDecoder().decode(buf)) }];
    else sheets = await readWorkbook(buf);
    let usedSheets = 0;
    for (const sh of sheets) {
      const hi = findHeader(sh.rows);
      if (hi < 0) continue;
      usedSheets++;
      const map = mapColumns(sh.rows[hi]);
      if (map.inv === undefined || map.nazev === undefined) continue;
      if (map.room === undefined) warnings.push(`List „${sh.name}“ nemá sloupec s místností – použil jsem název listu.`);
      for (let r = hi + 1; r < sh.rows.length; r++) {
        const row = sh.rows[r] || [];
        const get = (k) => (map[k] === undefined ? '' : clean(row[map[k]]));
        const inv = get('inv');
        const nazev = get('nazev');
        if (!inv && !nazev) continue;
        if (!inv) { warnings.push(`Řádek ${r + 1} (${nazev}) nemá inventární číslo – přeskočen.`); continue; }
        let room = get('room');
        if (!room || looksBroken(room)) room = map.room === undefined ? sh.name : 'Bez místnosti';
        const cenaRaw = map.cena === undefined ? null : row[map.cena];
        const it = {
          inv, nazev: nazev || '(bez názvu)', room,
          skupina: get('skupina'), evid: get('evid'), pozn: get('pozn'), vyrob: get('vyrob'),
          cena: typeof cenaRaw === 'number' ? cenaRaw : (Number(String(cenaRaw ?? '').replace(/\s/g, '').replace(',', '.')) || null),
          datum: get('datum'), odp: get('odp'),
        };
        if (seen.has(inv)) {
          const prev = seen.get(inv);
          warnings.push(`Inventární číslo ${inv} je v souboru dvakrát (${prev.room} a ${room}) – nechávám první.`);
          continue;
        }
        seen.set(inv, it);
        items.push(it);
      }
    }
    if (!usedSheets) warnings.push(`V souboru „${file.name}“ jsem nenašel tabulku se sloupci „Invent.číslo“ a „Název“.`);
  }
  const rooms = new Set(items.map((i) => i.room));
  return { items, warnings, roomCount: rooms.size };
}

function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => (/^\d+$/.test(c) ? Number(c) : c.replace(/^﻿/, ''))));
}
