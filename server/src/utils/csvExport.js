'use strict';
/** CSV writer for data exports. UTF-8 with BOM so Excel shows names with accents correctly; ';'-free, RFC-4180 quoting;
 *  cells starting with = + - @ are prefixed so a spreadsheet can never run them as a formula. */
const cell = (v) => {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** @param {Array<[string, (row:any)=>any]>} columns */
function toCsv(rows, columns) {
  const head = columns.map(([h]) => cell(h)).join(',');
  const body = rows.map((r) => columns.map(([, f]) => cell(f(r))).join(','));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}
module.exports = { toCsv, cell };
