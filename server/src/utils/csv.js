'use strict';
/** Minimal RFC-4180 CSV reader (no dependencies). Handles BOM, quoted fields with "" escapes and embedded newlines,
 *  and picks the delimiter (comma, semicolon or tab) from the header line - Excel in Germany, Turkey and Brazil exports ';'. */
class CsvError extends Error { constructor(message) { super(message); this.status = 400; this.code = 'BAD_CSV'; this.expose = true; } }

function detectDelimiter(text) {
  const firstLine = (() => { let q = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '"') q = !q; else if (!q && (c === '\n' || c === '\r')) return text.slice(0, i); } return text; })();
  let best = ','; let bestN = -1;
  for (const d of [',', ';', '\t']) {
    let n = 0; let q = false;
    for (const c of firstLine) { if (c === '"') q = !q; else if (!q && c === d) n++; }
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

/** @returns {string[][]} rows of trimmed cells; blank lines are dropped. */
function parseCsv(input, { maxRows = 5000, maxCols = 50 } = {}) {
  if (typeof input !== 'string') throw new CsvError('CSV must be text');
  const text = input.replace(/^﻿/, '');
  const d = detectDelimiter(text);
  const rows = []; let row = []; let cell = ''; let inQ = false; let wasQuoted = false;
  const endCell = () => { row.push(wasQuoted ? cell : cell.trim()); cell = ''; wasQuoted = false; };
  const endRow = () => {
    endCell();
    if (row.length > maxCols) throw new CsvError(`Too many columns (max ${maxCols})`);
    if (row.some((c) => c !== '')) rows.push(row);
    if (rows.length > maxRows + 1) throw new CsvError(`Too many rows (max ${maxRows})`);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"' && cell.trim() === '') { inQ = true; wasQuoted = true; cell = ''; }
    else if (c === d) endCell();
    else if (c === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else if (c === '\n') endRow();
    else cell += c;
  }
  if (inQ) throw new CsvError('The file has an opening quote (") that is never closed');
  if (cell !== '' || row.length) endRow();
  return rows.map((r) => r.map((c) => c.trim()));
}

/** Rows (arrays) -> objects keyed by canonical column names via an alias table; unknown columns are ignored. */
function toObjects(rows, aliases) {
  if (!rows.length) throw new CsvError('The file is empty');
  const norm = (s) => String(s).toLowerCase().replace(/\u0131/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const lookup = new Map();
  for (const [canon, list] of Object.entries(aliases)) for (const a of [canon, ...list]) lookup.set(norm(a), canon);
  const header = rows[0].map((h) => lookup.get(norm(h)) || null);
  return { header, objects: rows.slice(1).map((r, i) => { const o = { _line: i + 2 }; header.forEach((k, j) => { if (k) o[k] = r[j] ?? ''; }); return o; }) };
}

/** Neutralise spreadsheet formula injection when WRITING a CSV that someone will open in Excel. */
const csvCell = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

module.exports = { parseCsv, toObjects, csvCell, CsvError };
