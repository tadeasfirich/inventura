// Čtení a zápis Excelu (.xlsx) bez knihoven.
// Čtení: všechny listy jako pole řádků. Zápis: přehledné listy s tučnou hlavičkou,
// ukotveným prvním řádkem, filtrem a tiskem na šířku stránky.

import { unzip, zip } from './zip.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ---------------------------------------------------------------- čtení

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}
const all = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
const first = (node, tag) => node.getElementsByTagNameNS('*', tag)[0] || null;

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function isDateFormat(id, code) {
  if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return true;
  if (!code) return false;
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(c) && !/^general$/i.test(c);
}

function serialToIso(v) {
  const ms = Math.round((v - 25569) * 86400000);
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

// → [{ name, rows: [[hodnota, …], …] }]
export async function readWorkbook(arrayBuffer) {
  const z = unzip(arrayBuffer);
  const wbText = await z.text('xl/workbook.xml');
  if (!wbText) throw new Error('V souboru chybí list Excelu. Je to opravdu .xlsx?');
  const wb = parseXml(wbText);
  const rels = parseXml((await z.text('xl/_rels/workbook.xml.rels')) || '<Relationships/>');
  const relMap = new Map(all(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));

  const shared = [];
  const ssText = await z.text('xl/sharedStrings.xml');
  if (ssText) {
    for (const si of all(parseXml(ssText), 'si')) {
      // text z <t>, ale ne z fonetických nápověd <rPh>
      shared.push(all(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
    }
  }

  const dateStyles = new Set();
  const stText = await z.text('xl/styles.xml');
  if (stText) {
    const st = parseXml(stText);
    const custom = new Map(all(st, 'numFmt').map((n) => [Number(n.getAttribute('numFmtId')), n.getAttribute('formatCode')]));
    const xfs = first(st, 'cellXfs');
    if (xfs) {
      [...xfs.children].forEach((xf, i) => {
        const id = Number(xf.getAttribute('numFmtId') || 0);
        if (isDateFormat(id, custom.get(id))) dateStyles.add(i);
      });
    }
  }

  const sheets = [];
  for (const s of all(wb, 'sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap.get(rid);
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const text = await z.text(target);
    if (!text) continue;
    const doc = parseXml(text);
    const rows = [];
    for (const row of all(doc, 'row')) {
      const rIdx = Number(row.getAttribute('r') || rows.length + 1) - 1;
      const out = [];
      let autoCol = 0;
      for (const c of [...row.children].filter((x) => x.localName === 'c')) {
        const ref = c.getAttribute('r');
        const ci = ref ? colIndex(ref) : autoCol;
        autoCol = ci + 1;
        const t = c.getAttribute('t');
        const vEl = first(c, 'v');
        let v = vEl ? vEl.textContent : null;
        if (t === 's') v = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') v = all(c, 't').map((x) => x.textContent).join('');
        else if (t === 'b') v = v === '1';
        else if (t === 'str' || t === 'e') v = v ?? '';
        else if (v !== null) {
          const num = Number(v);
          v = dateStyles.has(Number(c.getAttribute('s') || 0)) ? serialToIso(num) : num;
        }
        out[ci] = v;
      }
      rows[rIdx] = out;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name: s.getAttribute('name'), rows });
  }
  return sheets;
}

// ---------------------------------------------------------------- zápis

const esc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// styly buněk (index do cellXfs)
export const S = { normal: 0, head: 1, bold: 2, title: 3, money: 4, muted: 5, wrap: 6, int: 7 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;Kč&quot;"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="15"/><color rgb="FF14171F"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF5A6172"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDFE5F3"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FF14171F"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="left"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetName(name, used) {
  let n = String(name).replace(/[\[\]:*?/\\]/g, '-').slice(0, 31) || 'List';
  let k = 2;
  while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${k++}`;
  used.add(n.toLowerCase());
  return n;
}

// Buňka: hodnota, nebo { v, s } se stylem z S.
function cellXml(ref, cell) {
  let v = cell, s = 0;
  if (cell && typeof cell === 'object' && !(cell instanceof Date)) { v = cell.v; s = cell.s || 0; }
  if (v === null || v === undefined || v === '') return s ? `<c r="${ref}" s="${s}"/>` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"${s ? ` s="${s}"` : ''}><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

// sheets: [{ name, widths: [číslo,…], rows: [[buňka,…],…], headerRow?: index řádku s hlavičkou tabulky }]
export function writeWorkbook(sheets) {
  const used = new Set();
  const names = sheets.map((s) => sheetName(s.name, used));
  const files = [];
  const defined = [];

  sheets.forEach((sh, i) => {
    const rows = sh.rows || [];
    const maxCols = Math.max(1, sh.widths ? sh.widths.length : 0, ...rows.map((r) => r.length));
    const hr = sh.headerRow;
    const lastRow = Math.max(1, rows.length);
    const pane = hr !== undefined && hr !== null
      ? `<pane ySplit="${hr + 1}" topLeftCell="A${hr + 2}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${hr + 2}" sqref="A${hr + 2}"/>`
      : '';
    const cols = (sh.widths || []).map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join('');
    const data = rows.map((r, ri) => {
      const cells = (r || []).map((c, ci) => cellXml(`${colName(ci)}${ri + 1}`, c)).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    let filter = '';
    if (hr !== undefined && hr !== null && rows.length > hr + 1) {
      const ref = `A${hr + 1}:${colName(maxCols - 1)}${lastRow}`;
      filter = `<autoFilter ref="${ref}"/>`;
      defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${names[i].replace(/'/g, "''")}'!$A$${hr + 1}:$${colName(maxCols - 1)}$${lastRow}</definedName>`);
    }
    files.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${colName(maxCols - 1)}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"${i === 0 ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${data}</sheetData>
${filter}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`,
    });
  });

  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${defined.length ? `<definedNames>${defined.join('')}</definedNames>` : ''}
</workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>Inventura</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>
</cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Inventura</Application></Properties>`;

  return zip([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: STYLES },
    ...files,
  ], XLSX_MIME);
}
