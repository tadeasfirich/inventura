// Testovací „SharePoint“: stejné rozhraní jako SharePointBackend, ale všechno je jen v tomto
// prohlížeči (IndexedDB). Více záložek sdílí stejná data, takže jde vyzkoušet i to,
// že lepič a učitel pracují ve stejné místnosti zároveň.

import { CONFIG } from '../config.js';
import { idb } from './idb.js';
import { uid } from '../ui.js';

export class DemoBackend {
  constructor() {
    this.mode = 'demo';
    this.offline = false; // přepínač „Simulovat výpadek sítě“
  }

  // seed se spustí napoprvé a pak vždy, když se změní verze ukázkových dat (odklikaný stav zůstává)
  async init(seed, version = 1) {
    const has = await idb.get('demo', '_seeded');
    if (has !== version && seed) {
      await seed(this);
      await idb.put('demo', version, '_seeded');
    }
  }

  check() {
    if (this.offline) { const e = new Error('Bez připojení k internetu (simulace)'); e.status = 0; e.offline = true; throw e; }
  }
  async delay() { await new Promise((r) => setTimeout(r, 120)); this.check(); }

  async getJson(path, knownEtag) {
    await this.delay();
    const f = await idb.get('demo', path);
    if (!f) return null;
    if (knownEtag && knownEtag === f.etag) return { notModified: true, etag: f.etag };
    return { data: JSON.parse(f.text), etag: f.etag };
  }

  async putJson(path, data, etag, { overwrite = false } = {}) {
    await this.delay();
    const f = await idb.get('demo', path);
    if (etag && f && f.etag !== etag) { const e = new Error('Mezitím to upravil někdo jiný'); e.status = 412; throw e; }
    if (!etag && !overwrite && f) { const e = new Error('Soubor už existuje'); e.status = 409; throw e; }
    const ne = uid();
    await idb.put('demo', { text: JSON.stringify(data), etag: ne, t: new Date().toISOString() }, path);
    return ne;
  }

  async listJson(folder) {
    await this.delay();
    const keys = (await idb.keys('demo')).filter((k) => typeof k === 'string' && k.startsWith(folder + '/') && k.endsWith('.json'));
    const out = [];
    for (const k of keys) {
      const f = await idb.get('demo', k);
      out.push({ name: k.slice(folder.length + 1), data: JSON.parse(f.text), etag: f.etag });
    }
    return out;
  }

  async putFile(path, blob) {
    await this.delay();
    await idb.put('demo', { blob, t: new Date().toISOString(), size: blob.size }, 'file:' + path);
    return { webUrl: null };
  }

  async folderUrl() { return null; }

  async sendMail(msg) {
    await this.delay();
    const mails = (await idb.get('demo', '_mails')) || [];
    mails.unshift({ ...msg, attachments: msg.attachments.map((a) => ({ name: a.name, blob: a.blob })), t: new Date().toISOString() });
    await idb.put('demo', mails.slice(0, 30), '_mails');
  }

  // ---------- jen pro testovací režim (Správa) ----------
  async files() {
    const keys = (await idb.keys('demo')).filter((k) => typeof k === 'string' && k.startsWith('file:'));
    const out = [];
    for (const k of keys) { const f = await idb.get('demo', k); out.push({ path: k.slice(5), ...f }); }
    return out.sort((a, b) => a.path.localeCompare(b.path, 'cs', { numeric: true }));
  }
  async mails() { return (await idb.get('demo', '_mails')) || []; }
  async reset() {
    await idb.clear('demo'); await idb.clear('rooms'); await idb.clear('outbox'); await idb.clear('kv');
  }
  get rootName() { return CONFIG.sharepoint.folder; }
}
