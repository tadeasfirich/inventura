// Čtečka čárových kódů.
//
// 1) Kamera telefonu. Na Androidu (Chrome) má prohlížeč čtečku vestavěnou (BarcodeDetector) – rychlá,
//    nic se nestahuje. Na iPhonu a jinde se jednou stáhne čtečka ZXing (WebAssembly, ~1 MB),
//    service worker si ji uloží, takže pak funguje i bez sítě.
// 2) Bluetooth/USB čtečka (tvoří se jako klávesnice). Kód „napíše“ a odešle Enterem.
//    Funguje na telefonu, tabletu i počítači. Opravuje českou klávesnici (+ěščř… → 12345…).
// 3) Ruční zadání čísla.

import { CONFIG } from './config.js';

const FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e', 'qr_code'];

let detectorPromise = null;
export function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ('BarcodeDetector' in window) {
        try {
          const sup = await window.BarcodeDetector.getSupportedFormats();
          const f = FORMATS.filter((x) => sup.includes(x));
          if (f.includes('code_128')) return { det: new window.BarcodeDetector({ formats: f }), native: true };
        } catch { /* použijeme ZXing */ }
      }
      const mod = await import(CONFIG.cdn.barcode);
      if (mod.prepareZXingModule) {
        const p = mod.prepareZXingModule({
          overrides: {
            locateFile: (path, prefix) => (path.endsWith('.wasm') ? CONFIG.cdn.zxingWasm(mod.ZXING_WASM_VERSION) : prefix + path),
          },
          fireImmediately: true,
        });
        if (p && p.then) await p;
      }
      return { det: new mod.BarcodeDetector({ formats: FORMATS }), native: false };
    })().catch((e) => { detectorPromise = null; throw e; });
  }
  return detectorPromise;
}

// Předem stáhnout čtečku, ať je k dispozici i bez sítě (volá se po přihlášení učitele).
export function prewarm() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  getDetector().catch(() => {});
}

export function cameraSupported() {
  return !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

// ---------------------------------------------------------------- kamera

export class CameraScanner {
  constructor(video, { onCode, isKnown }) {
    this.video = video;
    this.onCode = onCode;
    this.isKnown = isKnown || (() => true);
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.running = false;
    this.paused = false;
    this.last = new Map();
    this.cand = null;
    this.track = null;
    this.caps = {};
    this.torchOn = false;
    this.zoomed = false;
  }

  async start() {
    const { det } = await getDetector();
    this.det = det;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
    try {
      if (this.caps.focusMode && this.caps.focusMode.includes('continuous')) {
        await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
    } catch { /* nevadí */ }
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    this.video.srcObject = stream;
    await this.video.play();
    this.running = true;
    this.loop();
  }

  get hasTorch() { return !!this.caps.torch; }
  get hasZoom() { return !!(this.caps.zoom && this.caps.zoom.max >= 1.5); }

  async toggleTorch() {
    if (!this.hasTorch) return false;
    this.torchOn = !this.torchOn;
    try { await this.track.applyConstraints({ advanced: [{ torch: this.torchOn }] }); } catch { this.torchOn = false; }
    return this.torchOn;
  }

  async toggleZoom() {
    if (!this.hasZoom) return false;
    this.zoomed = !this.zoomed;
    const z = this.zoomed ? Math.min(this.caps.zoom.max, 2) : this.caps.zoom.min || 1;
    try { await this.track.applyConstraints({ advanced: [{ zoom: z }] }); } catch { this.zoomed = false; }
    return this.zoomed;
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; this.cand = null; }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  async loop() {
    if (!this.running) return;
    const v = this.video;
    if (!this.paused && v.readyState >= 2 && v.videoWidth) {
      // čteme jen střed obrazu (rámeček), je to rychlejší a nechytí to sousední štítek
      const vw = v.videoWidth, vh = v.videoHeight;
      const cw = Math.round(vw * 0.9), ch = Math.round(vh * (vw > vh ? 0.6 : 0.45));
      const sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
      if (this.canvas.width !== cw) this.canvas.width = cw;
      if (this.canvas.height !== ch) this.canvas.height = ch;
      this.ctx.drawImage(v, sx, sy, cw, ch, 0, 0, cw, ch);
      try {
        const res = await this.det.detect(this.canvas);
        for (const r of res) this.handle(r.rawValue);
      } catch { /* snímek se nepovedl, další */ }
    }
    this.timer = setTimeout(() => this.loop(), 80);
  }

  handle(raw) {
    const code = String(raw || '').trim();
    if (!code || this.paused) return;
    const now = Date.now();
    const prev = this.last.get(code);
    if (prev && now - prev < 2500) { this.last.set(code, now); return; } // pořád ho držím před kamerou
    // neznámý kód musí přijít dvakrát stejně (čárové kódy se občas přečtou špatně)
    if (!this.isKnown(code)) {
      if (!this.cand || this.cand.code !== code || now - this.cand.t > 1500) { this.cand = { code, t: now }; return; }
    }
    this.cand = null;
    this.last.set(code, now);
    this.onCode(code, 'kamera');
  }
}

// ---------------------------------------------------------------- čtečka jako klávesnice

const CZ_DIGITS = { '+': '1', 'ě': '2', 'š': '3', 'č': '4', 'ř': '5', 'ž': '6', 'ý': '7', 'á': '8', 'í': '9', 'é': '0' };
export function fixKeyboard(s) {
  return String(s || '').replace(/[+ěščřžýáíé]/g, (c) => CZ_DIGITS[c]).trim();
}

function keyChar(e) {
  let m = /^(?:Digit|Numpad)(\d)$/.exec(e.code || '');
  if (m) return m[1];
  m = /^Key([A-Z])$/.exec(e.code || '');
  if (m) return m[1];
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') return '-';
  if (e.code === 'Period' || e.code === 'NumpadDecimal') return '.';
  if (e.code === 'Slash' || e.code === 'NumpadDivide') return '/';
  return e.key && e.key.length === 1 ? e.key : '';
}

// Zachytí rychlé „psaní“ čtečky kdekoli na stránce (mimo textová pole). Vrací funkci na odpojení.
export function listenKeyboardScanner(onCode) {
  let buf = '', lastT = 0, fast = 0;
  const onKey = (e) => {
    const tg = e.target;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
    if (document.querySelector('.overlay')) return;
    const t = performance.now();
    if (t - lastT > 100) { buf = ''; fast = 0; } else fast++;
    lastT = t;
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (buf.length >= 3 && fast >= buf.length - 1) { e.preventDefault(); onCode(buf, 'ctecka'); }
      buf = ''; fast = 0;
      return;
    }
    const ch = keyChar(e);
    if (ch) buf += ch;
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

// ---------------------------------------------------------------- zvuk a vibrace

let ac = null;
function tone(freq, dur, at = 0) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.05;
    o.connect(g).connect(ac.destination);
    o.start(ac.currentTime + at);
    o.stop(ac.currentTime + at + dur);
  } catch { /* bez zvuku */ }
}

export function soundOn() {
  try { return localStorage.getItem('zvuk') !== '0'; } catch { return true; }
}
export function setSound(on) {
  try { localStorage.setItem('zvuk', on ? '1' : '0'); } catch { /* nic */ }
}

export function feedback(kind) {
  const snd = soundOn();
  if (kind === 'ok') { if (snd) tone(1400, 0.08); navigator.vibrate?.(60); }
  else if (kind === 'again') { if (snd) { tone(900, 0.05); tone(900, 0.05, 0.1); } navigator.vibrate?.([30, 60, 30]); }
  else { if (snd) tone(320, 0.28); navigator.vibrate?.([120, 80, 120]); }
}

// odemknout zvuk na iPhonu (musí se to stát při ťuknutí)
export function unlockAudio() { tone(1, 0.001); }
