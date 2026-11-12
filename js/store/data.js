// Datová vrstva nad úložištěm (SharePoint nebo testovací).
//
// Zásada: každé ťuknutí se nejdřív uloží do zařízení (IndexedDB), teprve potom odešle.
// Aplikace tak funguje i bez wifi ve sklepě nebo v tělocvičně; jakmile je síť, samo se to dorovná.
// Dva lidé v jedné místnosti si nepřepíšou práci: při odeslání se oba stavy sloučí věc po věci.
//
// Excely pro hospodářku se na SharePointu aktualizují samy (autoPublish), nezávisle na tlačítku
// „Poslat Marcelce“. Když někdo zavře telefon dřív, než se jeho místnost stihla zapsat do Excelu,
// dorovná to kterékoli jiné zařízení s aplikací (podle stav.json pozná, co je zastaralé).

import { CONFIG } from '../config.js';
import { idb } from './idb.js';
import * as M from '../model.js';
import * as R from '../report.js';

// Novější shrnutí místnosti: rozhoduje čas poslední změny, při shodě to, které už je v Excelu.
function betterSummary(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (String(a.t) !== String(b.t)) return String(a.t) > String(b.t) ? a : b;
  return String(a.pub || '') >= String(b.pub || '') ? a : b;
}

export class Data {
  constructor(backend, user) {
    this.be = backend;
    this.user = user;
    this.settings = { ...CONFIG.defaults };
    this.master = null;
    this.masterEtag = null;
    this.index = M.buildIndex(null);
    this.stav = {};
    this.recs = new Map();
    this.listeners = new Set();
    this.status = { pending: 0, offline: false, error: null, syncing: false, lastSync: null };
    this.lock = Promise.resolve();
    this.syncing = null;
    this.syncAgain = false;
    this.stavDirty = new Set();
    this.results = new Map();
    this.pubAttempt = new Map();
    this.ovCheck = 0;
  }

  // ---------- události pro obrazovky ----------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what, key) { for (const fn of [...this.listeners]) { try { fn(what, key); } catch (e) { console.error(e); } } }

  locked(fn) {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  // ---------- cesty ----------
  get kolo() { return this.settings.kolo; }
  get paths() {
    const k = this.kolo;
    return {
      settings: '_data/nastaveni.json',
      master: `_data/${k}/majetek.json`,
      roomsDir: `_data/${k}/mistnosti`,
      room: (key) => `_data/${k}/mistnosti/${key}.json`,
      stav: `_data/${k}/stav.json`,
      prehled: `_data/${k}/prehled.json`,
      results: `Výsledky ${k}`,
      roomXlsx: (key) => `Výsledky ${k}/Místnosti/${key}.xlsx`,
      overview: `Výsledky ${k}/00 Přehled inventury.xlsx`,
    };
  }

  // ---------- start ----------
  async init() {
    this.settings = { ...CONFIG.defaults, ...((await idb.get('kv', 'settings')) || {}) };
    await this.loadCaches();
    try { await this.refresh(); } catch (e) { this.noteError(e); }
    window.addEventListener('online', () => this.kick(0));
    setInterval(() => this.kick(0), 30000);
    await this.updatePending();
    this.kick(0);
  }

  async loadCaches() {
    const cm = await idb.get('kv', `master|${this.kolo}`);
    this.setMaster(cm?.data || null, cm?.etag || null);
    this.stav = (await idb.get('kv', `stav|${this.kolo}`)) || {};
    this.stavDirty = new Set((await idb.get('kv', `stavDirty|${this.kolo}`)) || []);
    this.recs.clear();
  }

  setMaster(master, etag) {
    this.master = master;
    this.masterEtag = etag;
    this.index = M.buildIndex(master);
  }

  // nastavení, evidence a přehled stavů ze serveru
  async refresh() {
    const s = await this.be.getJson(this.paths.settings);
    const oldKolo = this.kolo;
    if (s) {
      this.settings = { ...CONFIG.defaults, ...s.data };
      await idb.put('kv', this.settings, 'settings');
    }
    if (this.kolo !== oldKolo) await this.loadCaches();
    const m = await this.be.getJson(this.paths.master, this.masterEtag);
    if (m && !m.notModified) {
      this.setMaster(m.data, m.etag);
      await idb.put('kv', { data: m.data, etag: m.etag }, `master|${this.kolo}`);
      this.emit('master');
    } else if (!m && this.master) {
      this.setMaster(null, null);
      await idb.del('kv', `master|${this.kolo}`);
      this.emit('master');
    }
    await this.pullStav();
    this.status.offline = false;
    this.status.error = null;
    this.emit('status');
  }

  async pullStav() {
    const st = await this.be.getJson(this.paths.stav);
    const remote = st?.data?.rooms || {};
    let changed = false;
    for (const [k, v] of Object.entries(remote)) {
      const cur = this.stav[k];
      if (this.stavDirty.has(k)) continue; // moje neodeslaná změna má přednost, sloučí se v pushStav
      if (betterSummary(cur, v) !== cur) { this.stav[k] = v; changed = true; }
    }
    if (changed) { await idb.put('kv', this.stav, `stav|${this.kolo}`); this.emit('stav'); }
  }

  noteError(e) {
    if (e && (e.offline || e.status === 0)) this.status.offline = true;
    else { this.status.error = e?.message || String(e); console.error(e); }
    this.emit('status');
  }

  // ---------- místnosti ----------
  roomItems(key) { return this.index.roomMap.get(key)?.items || []; }
  roomName(key) { return this.index.roomMap.get(key)?.name || key; }

  async getRec(key) {
    if (this.recs.has(key)) return this.recs.get(key);
    let rec = await idb.get('rooms', `${this.kolo}|${key}`);
    if (!rec) rec = { doc: M.emptyRoom(this.roomName(key)), etag: null, rev: 0, synced: 0 };
    this.recs.set(key, rec);
    return rec;
  }
  async saveRec(key, rec) {
    this.recs.set(key, rec);
    await idb.put('rooms', rec, `${this.kolo}|${key}`);
  }

  async room(key) { return (await this.getRec(key)).doc; }

  // stáhne novější stav ze serveru (když v místnosti pracuje i někdo jiný)
  async pullRoom(key) {
    try {
      const remote = await this.be.getJson(this.paths.room(key));
      if (!remote) return;
      await this.locked(async () => {
        const rec = await this.getRec(key);
        const before = JSON.stringify(rec.doc);
        rec.doc = M.mergeRoom(remote.data, rec.doc);
        if (rec.rev === rec.synced) rec.etag = remote.etag;
        await this.saveRec(key, rec);
        if (JSON.stringify(rec.doc) !== before) this.emit('room', key);
      });
      this.status.offline = false;
    } catch (e) { this.noteError(e); }
  }

  stamp() {
    return { t: new Date().toISOString(), by: this.user.email, name: this.user.name };
  }

  // fn(part, stamp) upraví část dokumentu (lepic/ucitel)
  edit(key, role, fn) {
    return this.locked(async () => {
      const rec = await this.getRec(key);
      if (!rec.doc.room) rec.doc.room = this.roomName(key);
      fn(rec.doc[role], () => this.stamp(), rec.doc);
      rec.rev++;
      await this.saveRec(key, rec);
      this.stav[key] = { ...M.summarize(rec.doc, this.roomItems(key)), pub: this.stav[key]?.pub || '' };
      this.stavDirty.add(key);
      await idb.put('kv', this.stav, `stav|${this.kolo}`);
      await idb.put('kv', [...this.stavDirty], `stavDirty|${this.kolo}`);
      this.emit('room', key);
      this.updatePending();
      this.kick();
    });
  }

  // ---------- synchronizace ----------
  kick(ms = 1200) {
    clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => this.sync(), ms);
  }

  async updatePending() {
    const recs = await idb.keys('rooms');
    let dirty = 0;
    for (const k of recs) {
      if (!String(k).startsWith(this.kolo + '|')) continue;
      const key = String(k).slice(this.kolo.length + 1);
      const r = this.recs.get(key) || await idb.get('rooms', k);
      if (r && r.rev !== r.synced) dirty++;
    }
    const out = await idb.count('outbox');
    this.status.pending = dirty + out;
    this.emit('status');
    return this.status.pending;
  }

  async syncNow() {
    while (this.syncing) await this.syncing;
    return this.sync();
  }

  sync() {
    if (this.syncing) { this.syncAgain = true; return this.syncing; }
    this.status.syncing = true;
    this.emit('status');
    this.syncing = (async () => {
      try {
        const keys = (await idb.keys('rooms')).map(String).filter((k) => k.startsWith(this.kolo + '|'));
        for (const k of keys) {
          const key = k.slice(this.kolo.length + 1);
          const rec = await this.getRec(key);
          if (rec.rev !== rec.synced) await this.pushRoom(key);
        }
        if (this.stavDirty.size) await this.pushStav();
        await this.processOutbox();
        await this.autoPublish();
        this.status.offline = false;
        this.status.error = null;
        this.status.lastSync = new Date().toISOString();
      } catch (e) {
        this.noteError(e);
      } finally {
        this.syncing = null;
        this.status.syncing = false;
        await this.updatePending();
        if (this.syncAgain) { this.syncAgain = false; this.kick(200); }
      }
    })();
    return this.syncing;
  }

  async pushRoom(key) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const rec = await this.getRec(key);
      const rev = rec.rev;
      const doc = rec.doc;
      try {
        const etag = await this.be.putJson(this.paths.room(key), doc, rec.etag);
        await this.locked(async () => {
          const cur = await this.getRec(key);
          cur.etag = etag;
          cur.synced = rev;
          await this.saveRec(key, cur);
        });
        return;
      } catch (e) {
        if (e.status !== 412 && e.status !== 409) throw e;
        // někdo zapsal mezitím: stáhnout, sloučit, zkusit znovu
        const remote = await this.be.getJson(this.paths.room(key));
        await this.locked(async () => {
          const cur = await this.getRec(key);
          cur.doc = M.mergeRoom(remote?.data, cur.doc);
          cur.etag = remote?.etag || null;
          await this.saveRec(key, cur);
        });
        this.emit('room', key);
      }
    }
    throw new Error('Místnost se nepodařilo uložit – moc lidí naráz. Zkusí se to znovu.');
  }

  async pushStav() {
    const keys = [...this.stavDirty];
    for (let attempt = 0; attempt < 6; attempt++) {
      const remote = await this.be.getJson(this.paths.stav);
      const data = remote?.data || { rooms: {} };
      for (const k of keys) {
        const best = betterSummary(data.rooms[k], this.stav[k]);
        if (best) { data.rooms[k] = best; this.stav[k] = best; }
      }
      for (const [k, v] of Object.entries(data.rooms)) {
        if (!keys.includes(k)) this.stav[k] = betterSummary(this.stav[k], v);
      }
      try {
        await this.be.putJson(this.paths.stav, data, remote?.etag || null);
        for (const k of keys) this.stavDirty.delete(k);
        await idb.put('kv', [...this.stavDirty], `stavDirty|${this.kolo}`);
        await idb.put('kv', this.stav, `stav|${this.kolo}`);
        this.emit('stav');
        return;
      } catch (e) {
        if (e.status !== 412 && e.status !== 409) throw e;
      }
    }
  }

  // Odchod z místnosti nebo zavření aplikace: zapsat Excel hned, nečekat na 20 s
  flush(key) {
    if (key) this.pubAttempt.delete(key);
    this.kick(0);
  }

  // Věci, které někdo našel v jiné místnosti, než uvádí evidence: Map(inv → { room })
  foundElsewhere() { return M.foundFromStav(this.stav, this.index); }

  // ---------- Excely na SharePointu se aktualizují samy ----------
  async autoPublish() {
    if (!this.index.rooms.length) return;
    await this.pullStav();
    const now = Date.now();
    const stale = Object.entries(this.stav).filter(([k, st]) => st && st.t && this.index.roomMap.has(k) && (!st.pub || String(st.t) > String(st.pub)));
    let published = 0;
    for (const [key, st] of stale.slice(0, 8)) {
      // uzavření místnosti se zapíše hned, jinak nejvýš jednou za 20 s (ať se neposílá každé pípnutí)
      const closed = [st.ucitel?.kdy, st.lepic?.kdy, st.ucitel?.odeslano].some((x) => x && String(x) > String(st.pub || ''));
      if (!closed && now - (this.pubAttempt.get(key) || 0) < 20000) continue;
      this.pubAttempt.set(key, now);
      const remote = await this.be.getJson(this.paths.room(key));
      const rec = await this.getRec(key);
      const doc = M.mergeRoom(remote?.data, rec.doc);
      const last = M.lastChange(doc);
      if (!last) continue;
      const { blob } = R.roomWorkbook(doc, this.roomItems(key), this.index, this.kolo, this.foundElsewhere());
      await this.be.putFile(this.paths.roomXlsx(key), blob);
      this.stav[key] = { ...M.summarize(doc, this.roomItems(key)), pub: last };
      this.stavDirty.add(key);
      published++;
    }
    if (published) {
      await idb.put('kv', this.stav, `stav|${this.kolo}`);
      await idb.put('kv', [...this.stavDirty], `stavDirty|${this.kolo}`);
      await this.pushStav();
    }
    await this.maybeOverview();
  }

  // Přehled všech místností: při uzavření místnosti hned, jinak nejvýš jednou za 3 minuty
  async maybeOverview() {
    const now = Date.now();
    const vals = Object.values(this.stav).filter(Boolean);
    const maxT = vals.reduce((m, st) => (String(st.t) > m ? String(st.t) : m), '');
    if (!maxT) return;
    if (now - this.ovCheck < 30000) return;
    this.ovCheck = now;
    const meta = await this.be.getJson(this.paths.prehled);
    const upTo = meta?.data?.upTo || '';
    if (upTo && maxT <= upTo) return;
    const closed = vals.some((st) => [st.ucitel?.kdy, st.lepic?.kdy, st.ucitel?.odeslano].some((x) => x && String(x) > upTo));
    const at = meta?.data?.at ? Date.parse(meta.data.at) : 0;
    if (!closed && now - at < 3 * 60000) return;
    const docs = await this.allDocs();
    await this.writeOverview(docs, maxT, meta?.etag || null);
  }

  async writeOverview(docs, upTo, etag) {
    const blob = R.overviewWorkbook(this.index, docs, this.kolo);
    await this.be.putFile(this.paths.overview, blob);
    if (!upTo) upTo = [...docs.values()].reduce((m, d) => { const t = M.lastChange(d); return t > m ? t : m; }, '');
    try {
      if (etag === undefined) etag = (await this.be.getJson(this.paths.prehled))?.etag || null;
      await this.be.putJson(this.paths.prehled, { at: new Date().toISOString(), upTo }, etag, { overwrite: !etag });
    } catch { /* jiné zařízení zapsalo souběžně – nevadí */ }
    return blob;
  }

  // ---------- všechny místnosti (pro přehled a Excel) ----------
  async allDocs({ remote = true } = {}) {
    const docs = new Map();
    if (remote) {
      const list = await this.be.listJson(this.paths.roomsDir);
      for (const f of list) docs.set(f.name.replace(/\.json$/, ''), f.data);
    }
    const keys = (await idb.keys('rooms')).map(String).filter((k) => k.startsWith(this.kolo + '|'));
    for (const k of keys) {
      const key = k.slice(this.kolo.length + 1);
      const rec = await this.getRec(key);
      docs.set(key, M.mergeRoom(docs.get(key), rec.doc));
    }
    return docs;
  }

  // ---------- odeslání hospodářce ----------
  // role: 'ucitel' (rooms = [místnost]) nebo 'lepic' (všechny místnosti s hotovým lepením)
  async send(role, rooms = []) {
    const seq = await idb.put('outbox', { type: 'send', role, rooms, t: new Date().toISOString(), by: this.user.email, name: this.user.name });
    await this.updatePending();
    await this.syncNow();
    const still = await idb.get('outbox', seq);
    if (still) return { queued: true, offline: this.status.offline, error: this.status.error };
    return this.results.get(seq) || { ok: true };
  }

  async processOutbox() {
    const items = await idb.all('outbox');
    for (const a of items) {
      if (a.type !== 'send') { await idb.del('outbox', a.seq); continue; }
      const res = await this.doSend(a);
      this.results.set(a.seq, res);
      await idb.del('outbox', a.seq);
      this.emit('sent', res);
    }
  }

  async doSend(a) {
    const P = this.paths;
    const docs = await this.allDocs();
    const user = { name: a.name, email: a.by };
    let rooms = a.rooms;
    if (a.role === 'lepic') rooms = [...docs.entries()].filter(([, d]) => d.lepic?.hotovo?.v).map(([k]) => k);
    // čas odeslání patří už do odesílaného Excelu
    const sentStamp = { t: a.t, by: a.by, name: a.name };
    for (const key of rooms) { const d = docs.get(key); if (d) d[a.role].odeslano = sentStamp; }

    // Excely na SharePoint
    const found = M.foundFromDocs(docs, this.index);
    let fileUrl = null;
    let analysis = null;
    let roomBlob = null;
    for (const key of rooms) {
      const doc = docs.get(key) || M.emptyRoom(this.roomName(key));
      const { blob, analysis: an } = R.roomWorkbook(doc, this.roomItems(key), this.index, this.kolo, found);
      const up = await this.be.putFile(P.roomXlsx(key), blob);
      if (a.role === 'ucitel') { fileUrl = up.webUrl; analysis = an; roomBlob = blob; }
    }
    const overview = await this.writeOverview(docs);
    let folderUrl = null;
    try { folderUrl = await this.be.folderUrl(P.results); } catch { /* odkaz není nutný */ }

    // e-mail
    let mailed = false, mailError = null;
    if (this.settings.posilatEmail && this.settings.prijemceEmail) {
      try {
        let msg, attachments;
        if (a.role === 'ucitel') {
          const key = rooms[0];
          const doc = docs.get(key);
          msg = R.roomMail({ doc, analysis, user, folderUrl, fileUrl, kolo: this.kolo });
          attachments = [{ name: `${key}.xlsx`, blob: roomBlob }];
        } else {
          msg = R.lepeniMail({ index: this.index, docs, user, folderUrl, kolo: this.kolo });
          attachments = [{ name: '00 Přehled inventury.xlsx', blob: overview }];
        }
        await this.be.sendMail({ to: this.settings.prijemceEmail, subject: msg.subject, html: msg.html, attachments });
        mailed = true;
      } catch (e) {
        if (e.offline || e.status === 0) throw e;
        mailError = e.message;
      }
    }

    // poznamenat odeslání
    for (const key of rooms) {
      await this.edit(key, a.role, (p) => { p.odeslano = sentStamp; });
    }
    return { ok: true, mailed, mailError, folderUrl, fileUrl, rooms: rooms.length };
  }

  // Přegenerovat všechny Excely pro hospodářku (bez e-mailu) – tlačítko ve Správě
  async publish(onProgress = () => {}) {
    await this.syncNow();
    if (this.status.offline) { const e = new Error('Bez připojení k internetu'); e.offline = true; throw e; }
    const docs = await this.allDocs();
    const found = M.foundFromDocs(docs, this.index);
    const keys = this.index.rooms.filter((r) => docs.get(r.key) && M.lastChange(docs.get(r.key))).map((r) => r.key);
    let i = 0;
    for (const key of keys) {
      onProgress(++i, keys.length + 1);
      const doc = docs.get(key);
      const { blob } = R.roomWorkbook(doc, this.roomItems(key), this.index, this.kolo, found);
      await this.be.putFile(this.paths.roomXlsx(key), blob);
      this.stav[key] = { ...M.summarize(doc, this.roomItems(key)), pub: M.lastChange(doc) };
      this.stavDirty.add(key);
    }
    onProgress(keys.length + 1, keys.length + 1);
    await this.writeOverview(docs);
    await this.pushStav();
    let folderUrl = null;
    try { folderUrl = await this.be.folderUrl(this.paths.results); } catch { /* nic */ }
    return { rooms: keys.length, folderUrl };
  }

  async resultsUrl() {
    try { return await this.be.folderUrl(this.paths.results); } catch { return null; }
  }

  // ---------- Excel ke stažení (funguje i bez sítě z toho, co je v zařízení) ----------
  async roomXlsx(key) {
    const doc = await this.room(key);
    return R.roomWorkbook(doc, this.roomItems(key), this.index, this.kolo, this.foundElsewhere()).blob;
  }
  async overviewXlsx() {
    let docs;
    try { docs = await this.allDocs(); } catch { docs = await this.allDocs({ remote: false }); }
    return R.overviewWorkbook(this.index, docs, this.kolo);
  }

  // ---------- správa ----------
  async saveMaster(master) {
    const etag = await this.be.putJson(this.paths.master, master, null, { overwrite: true });
    this.setMaster(master, etag);
    await idb.put('kv', { data: master, etag }, `master|${this.kolo}`);
    // přepočítat stavy (počty položek se mohly změnit)
    for (const r of this.index.rooms) {
      if (this.stav[r.key]) {
        const doc = await this.room(r.key);
        if (M.lastChange(doc)) { this.stav[r.key] = { ...M.summarize(doc, r.items), t: new Date().toISOString() }; this.stavDirty.add(r.key); }
      }
    }
    await idb.put('kv', this.stav, `stav|${this.kolo}`);
    this.emit('master');
    this.kick(0);
  }

  async saveSettings(patch) {
    const prev = this.settings;
    const next = { ...this.settings, ...patch };
    const remote = await this.be.getJson(this.paths.settings);
    await this.be.putJson(this.paths.settings, next, remote?.etag || null, { overwrite: !remote });
    if (next.kolo !== prev.kolo && this.master) {
      // nové kolo převezme evidenci z minulého, dokud správce nenahraje novou
      const target = `_data/${next.kolo}/majetek.json`;
      const exists = await this.be.getJson(target);
      if (!exists) await this.be.putJson(target, { ...this.master, kolo: next.kolo }, null, { overwrite: true });
    }
    this.settings = next;
    await idb.put('kv', next, 'settings');
    if (next.kolo !== prev.kolo) { await this.loadCaches(); await this.refresh(); }
    this.emit('settings');
  }
}
