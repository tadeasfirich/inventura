// Společné kousky obrazovek lepení a inventury.

import { h, mount, mark, toast, formDialog, confirmDialog, fmt, downloadBlob, uid } from '../ui.js';
import * as M from '../model.js';

export const roomHref = (role, key) => `#/${role === 'lepic' ? 'lepeni' : 'inventura'}/${encodeURIComponent(key)}`;
export const listHref = (role) => (role === 'lepic' ? '#/lepeni' : '#/inventura');

export function statusMark(stav) {
  if (stav === 'hotovo') return mark('ok');
  if (stav === 'rozpr') return mark('wait');
  return mark('opt');
}

export function progress(done, total, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('div', { class: 'progress' },
    h('div', { class: 'progress-top' }, h('b', null, label), h('span', { class: 'num' }, `${done} z ${total}`)),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('i', { style: { width: `${pct}%` } })));
}

export function emptyMaster(ctx) {
  return h('div', { class: 'box dashed empty' },
    h('h2', null, 'Evidence ještě není nahraná'),
    h('p', null, 'Aplikace zatím neví, co má v které místnosti být. Správce nahraje Excel s majetkem v části Správa.'),
    ctx.isAdmin() ? h('a', { class: 'btn primary', href: '#/sprava/evidence' }, 'Nahrát Excel') : null);
}

// Sekce „Navíc“: věci, které ve třídě jsou, ale v seznamu nejsou
export function navicSection(ctx, key, role, part, { readOnly = false } = {}) {
  const list = M.navicList(part);
  const index = ctx.data.index;
  const add = async () => {
    const r = await addNavicDialog(index, key);
    if (!r) return;
    await ctx.data.edit(key, role, (p, stamp) => { p.navic[uid()] = { ...r, ...stamp() }; });
    toast('Zapsáno jako navíc');
  };
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' },
      h('h2', null, 'Navíc ve třídě'),
      h('span', { class: 'muted small' }, list.length ? fmt.ks(list.length) : 'nic')),
    list.length ? h('ul', { class: 'navic' }, list.map((n) => h('li', null,
      mark('bad'),
      h('div', { class: 'grow' },
        h('b', null, n.nazev || '(bez názvu)'),
        h('div', { class: 'small muted' }, [n.cislo ? `č. ${n.cislo}` : 'bez čísla', n.odkud ? `patří do ${n.odkud}` : '', n.pozn].filter(Boolean).join(' – '))),
      readOnly ? null : h('button', {
        class: 'btn ghost small', 'aria-label': `Smazat ${n.nazev}`,
        onclick: async () => {
          if (!(await confirmDialog('Smazat?', `„${n.nazev}“ ze seznamu navíc.`, 'Smazat'))) return;
          await ctx.data.edit(key, role, (p, stamp) => { p.navic[n.id] = { ...p.navic[n.id], del: true, ...stamp() }; });
        },
      }, 'Smazat')))) : null,
    readOnly ? null : h('button', { class: 'btn', onclick: add }, '+ Něco je tu navíc'));
}

export async function addNavicDialog(index, key, preset = {}) {
  const r = await formDialog('Věc navíc', [
    {
      name: 'cislo', label: 'Číslo ze štítku', inputmode: 'numeric', value: preset.cislo || '',
      hint: 'Když štítek nemá, nech prázdné.',
      oninput: (v, inputs) => {
        const it = index.lookup(v);
        if (it && !inputs.nazev.value) inputs.nazev.value = it.nazev;
      },
    },
    { name: 'nazev', label: 'Co to je', required: true, value: preset.nazev || '', placeholder: 'např. židle žákovská' },
    { name: 'pozn', label: 'Poznámka', type: 'textarea', value: preset.pozn || '', placeholder: 'např. stojí u okna' },
  ], { ok: 'Zapsat' });
  if (!r) return null;
  const it = r.cislo ? index.lookup(r.cislo) : null;
  return { cislo: r.cislo, nazev: r.nazev, pozn: r.pozn, odkud: it && M.roomKey(it.room) !== key ? it.room : '' };
}

// Poznámka k místnosti – ukládá se sama
export function noteSection(ctx, key, role, part, { readOnly = false } = {}) {
  const ta = h('textarea', { rows: 3, placeholder: 'Co by měla hospodářka vědět o této místnosti…', disabled: readOnly || undefined });
  ta.value = part.pozn?.v || '';
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    const v = ta.value.trim();
    if (v === (part.pozn?.v || '')) return;
    ctx.data.edit(key, role, (p, stamp) => { p.pozn = { v, ...stamp() }; });
  };
  ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 1500); });
  ta.addEventListener('blur', save);
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, 'Poznámka k místnosti'), h('span', { class: 'muted small' }, 'nepovinné')),
    ta);
}

export async function downloadRoom(ctx, key) {
  const blob = await ctx.data.roomXlsx(key);
  downloadBlob(`${key}.xlsx`, blob);
}

// Výsledek odeslání hospodářce
export function sendResult(ctx, res) {
  const who = ctx.prijemce;
  if (res.queued) {
    toast(res.offline ? `Bez internetu. Odešle se ${who} samo, až bude síť.` : `Zatím neodesláno: ${res.error || 'zkusí se to znovu'}`, { timeout: 7000 });
    return;
  }
  if (res.mailError) toast(`Excel je uložený na SharePointu, ale e-mail neodešel: ${res.mailError}`, { timeout: 9000 });
  else if (res.mailed) toast(`Odesláno ${who}`, { kind: 'ok' });
  else toast('Uloženo na SharePoint');
}

export function readOnlyBanner(part, label, onReopen) {
  if (!part.hotovo?.v) return null;
  return h('div', { class: 'box dark done-banner' },
    h('div', { class: 'grow' },
      h('h4', null, `${label} hotovo`),
      h('p', null, `${part.hotovo.name || ''}, ${fmt.dt(part.hotovo.t)}`),
      part.odeslano ? h('p', { class: 'small' }, `Odesláno ${fmt.dt(part.odeslano.t)}`) : null),
    onReopen ? h('button', { class: 'btn small', onclick: onReopen }, 'Otevřít znovu') : null);
}

export { mount };

// Inventární číslo a pod ním menším písmem evidenční číslo v závorce – to staré, co bývá napsané na nábytku
export function invBlock(it, extra = null) {
  return [
    h('b', { class: 'num' }, it.inv),
    it.evid ? h('small', { class: 'num evid', title: 'Evidenční číslo (původní)' }, `(${it.evid})`) : null,
    extra,
  ];
}

// Věci, které se nelepí ani nečtou čtečkou (poznámka „neoznačeno“) a věci k vyřazení (poznámka „V“, „Vyřadit“).
// Stačí odkliknout, jestli ve třídě jsou.
export function specialSection(ctx, key, role, part, items, { readOnly = false } = {}) {
  const list = items.filter(M.isSpecial);
  if (!list.length) return null;
  const done = list.filter((it) => M.itemState(part, it.inv)).length;
  return h('section', { class: 'section special' },
    h('div', { class: 'section-head' },
      h('h2', null, 'Bez štítku – jen odklikni'),
      h('span', { class: 'muted small num' }, `${done} z ${list.length}`)),
    h('p', { class: 'small muted' }, 'Tyhle věci se nelepí ani nečtou čtečkou. Jen označ, jestli jsou ve třídě. Věci k vyřazení tu už být nemusí.'),
    h('ul', { class: 'items special-list' }, list.map((it) => {
      const cur = M.itemState(part, it.inv);
      const kind = M.itemKind(it);
      const opts = [
        { s: 'ok', label: 'Je tu' },
        { s: 'chybi', label: kind === 'vyradit' ? 'Už tu není' : 'Není tu' },
      ];
      return h('li', { class: `item ${cur ? 'is-' + cur.s : ''}` },
        mark(!cur ? 'opt' : cur.s === 'ok' ? 'ok' : 'bad'),
        h('div', { class: 'item-id' },
          h('span', { class: 'item-title' }, it.nazev, ' ', h('span', { class: `kind kind-${kind}` }, M.KIND_LABEL[kind])),
          h('span', { class: 'ids' }, invBlock(it))),
        h('div', { class: 'seg seg-item seg-2', role: 'group', 'aria-label': `Stav ${it.inv}` }, opts.map((o) => h('button', {
          'aria-pressed': String(cur?.s === o.s),
          disabled: readOnly || undefined,
          onclick: () => ctx.data.edit(key, role, (p, stamp) => { p.items[it.inv] = { s: cur?.s === o.s ? '' : o.s, jak: 'ruka', ...stamp() }; }),
        }, o.label))));
    })));
}
