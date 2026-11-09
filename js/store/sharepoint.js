// Úložiště ve školním SharePointu přes Microsoft Graph.
// Všechno je v jedné složce knihovny Dokumenty (CONFIG.sharepoint.folder):
//   _data/…                 – data aplikace (JSON), nikdo je nemusí otevírat
//   Výsledky <kolo>/…        – Excely pro hospodářku
// Zápis dokumentu místnosti hlídá eTag: když mezitím zapsal někdo jiný, server vrátí 412
// a vrstva nad tím (data.js) oba stavy sloučí a zkusí to znovu.

import { CONFIG } from '../config.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SIMPLE_UPLOAD_LIMIT = 3.5 * 1024 * 1024;

const encPath = (p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');

export class SharePointBackend {
  constructor(getToken) {
    this.getToken = getToken;
    this.driveId = null;
    this.mode = 'sharepoint';
  }

  async graph(path, { method = 'GET', body, headers = {}, raw = false, allow404 = false } = {}) {
    const token = await this.getToken();
    const url = path.startsWith('http') ? path : GRAPH + path;
    for (let attempt = 0; attempt < 5; attempt++) {
      let res;
      try {
        const isBin = body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array;
        res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body && !isBin && !headers['Content-Type'] ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
          body: body ? (isBin || typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        });
      } catch {
        const err = new Error('Bez připojení k internetu'); err.status = 0; err.offline = true; throw err;
      }
      if (res.status === 429 || res.status === 503 || res.status === 504) {
        const wait = Number(res.headers.get('Retry-After') || 2) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (res.status === 404 && allow404) return null;
      if (!res.ok) {
        let msg = `${res.status}`;
        try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* nic */ }
        const err = new Error(friendly(res.status, msg)); err.status = res.status; throw err;
      }
      if (raw) return res;
      if (res.status === 204 || res.status === 202) return null;
      const ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : null;
    }
    const err = new Error('SharePoint je přetížený, zkus to za chvíli'); err.status = 429; throw err;
  }

  async init() {
    const cacheKey = `drive|${CONFIG.sharepoint.hostname}|${CONFIG.sharepoint.sitePath}`;
    try { this.driveId = localStorage.getItem(cacheKey); } catch { /* nic */ }
    try {
      const site = await this.graph(`/sites/${CONFIG.sharepoint.hostname}:${CONFIG.sharepoint.sitePath}?$select=id`);
      const drive = await this.graph(`/sites/${site.id}/drive?$select=id`);
      this.driveId = drive.id;
      try { localStorage.setItem(cacheKey, drive.id); } catch { /* nic */ }
    } catch (e) {
      if (!this.driveId) throw e;
    }
  }

  item(path) {
    return `/drives/${this.driveId}/root:/${encPath(`${CONFIG.sharepoint.folder}/${path}`)}`;
  }

  // → { data, etag } nebo null, když soubor neexistuje
  async getJson(path, knownEtag) {
    const meta = await this.graph(this.item(path), { allow404: true });
    if (!meta) return null;
    if (knownEtag && meta.eTag === knownEtag) return { notModified: true, etag: meta.eTag };
    const url = meta['@microsoft.graph.downloadUrl'];
    let res;
    try { res = await fetch(url, { cache: 'no-store' }); } catch {
      const err = new Error('Bez připojení k internetu'); err.status = 0; err.offline = true; throw err;
    }
    if (!res.ok) { const err = new Error(`Soubor se nepodařilo stáhnout (${res.status})`); err.status = res.status; throw err; }
    return { data: await res.json(), etag: meta.eTag };
  }

  // etag: musí sedět, jinak chyba 412. Bez etagu: soubor má být nový (jinak 409), pokud není overwrite.
  async putJson(path, data, etag, { overwrite = false } = {}) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const headers = etag ? { 'If-Match': etag } : {};
    const meta = await this.upload(path, blob, headers, etag || overwrite ? 'replace' : 'fail');
    return meta.eTag;
  }

  async upload(path, blob, headers = {}, conflict = 'replace') {
    if (blob.size <= SIMPLE_UPLOAD_LIMIT) {
      return this.graph(`${this.item(path)}:/content?@microsoft.graph.conflictBehavior=${conflict}`, {
        method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream', ...headers },
      });
    }
    // velký soubor (evidence s tisíci položkami) po částech
    const session = await this.graph(`${this.item(path)}:/createUploadSession`, {
      method: 'POST', body: { item: { '@microsoft.graph.conflictBehavior': conflict } }, headers,
    });
    const chunk = 5 * 1024 * 1024 - (5 * 1024 * 1024) % (320 * 1024);
    let meta = null;
    for (let start = 0; start < blob.size; start += chunk) {
      const end = Math.min(start + chunk, blob.size);
      const res = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${blob.size}` },
        body: blob.slice(start, end),
      });
      if (!res.ok && res.status !== 202) { const err = new Error(`Nahrávání selhalo (${res.status})`); err.status = res.status; throw err; }
      if (res.status === 200 || res.status === 201) meta = await res.json();
    }
    return meta;
  }

  // všechny JSONy ve složce → [{ name, data, etag }]
  async listJson(folder) {
    const out = [];
    let url = `${this.item(folder)}:/children?$top=999`;
    const files = [];
    while (url) {
      const r = await this.graph(url, { allow404: true });
      if (!r) return [];
      files.push(...r.value.filter((x) => x.file && x.name.endsWith('.json')));
      url = r['@odata.nextLink'];
    }
    let i = 0;
    const worker = async () => {
      while (i < files.length) {
        const f = files[i++];
        const res = await fetch(f['@microsoft.graph.downloadUrl'], { cache: 'no-store' });
        if (res.ok) out.push({ name: f.name, data: await res.json(), etag: f.eTag });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return out;
  }

  async putFile(path, blob) {
    const meta = await this.upload(path, blob);
    return { webUrl: meta?.webUrl || null };
  }

  async folderUrl(path) {
    const meta = await this.graph(this.item(path), { allow404: true });
    if (meta) return meta.webUrl;
    // složka ještě není – založíme ji, ať odkaz v e-mailu funguje
    const parts = `${CONFIG.sharepoint.folder}/${path}`.split('/').filter(Boolean);
    const name = parts.pop();
    const parent = `/drives/${this.driveId}/root:/${encPath(parts.join('/'))}:/children`;
    const created = await this.graph(parent, { method: 'POST', body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'replace' } });
    return created.webUrl;
  }

  async sendMail({ to, subject, html, attachments = [] }) {
    const att = [];
    for (const a of attachments) {
      att.push({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.name,
        contentType: a.blob.type || 'application/octet-stream',
        contentBytes: await blobToBase64(a.blob),
      });
    }
    await this.graph('/me/sendMail', {
      method: 'POST',
      body: {
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: to } }],
          attachments: att,
        },
        saveToSentItems: true,
      },
    });
  }
}

function friendly(status, msg) {
  if (status === 401) return 'Přihlášení vypršelo. Obnov stránku a přihlas se znovu.';
  if (status === 403) return 'Nemáš oprávnění zapisovat do SharePointu. Napiš správci (Tadeášovi).';
  if (status === 412) return 'Mezitím to upravil někdo jiný';
  if (status === 404) return 'Na SharePointu chybí složka nebo web – zkontroluj nastavení.';
  return `SharePoint: ${msg}`;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
