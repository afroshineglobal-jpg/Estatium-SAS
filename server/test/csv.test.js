'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, toObjects, csvCell } = require('../src/utils/csv');

test('comma, semicolon and tab delimiters are detected; BOM stripped; blank lines dropped', () => {
  assert.deepStrictEqual(parseCsv('a,b\n1,2\n\n3,4\n'), [['a', 'b'], ['1', '2'], ['3', '4']]);
  assert.deepStrictEqual(parseCsv('﻿a;b\r\n1;2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});
test('quotes: embedded delimiter, escaped quote, embedded newline', () => {
  assert.deepStrictEqual(parseCsv('n,note\n"Smith, J","He said ""hi"""\n"A","line1\nline2"'), [['n', 'note'], ['Smith, J', 'He said "hi"'], ['A', 'line1\nline2']]);
});
test('unterminated quote and oversize input are rejected', () => {
  assert.throws(() => parseCsv('a,b\n"oops,2'), /never closed/);
  assert.throws(() => parseCsv('a\n1\n2\n3', { maxRows: 2 }), /Too many rows/);
  assert.throws(() => parseCsv('a,b,c', { maxCols: 2 }), /Too many columns/);
});
test('header aliases are accent/case/space insensitive; unknown columns ignored', () => {
  const { objects } = toObjects(parseCsv('Full Name;E-mail;Telefone;Bloco;Unidade;Extra\nAna;ana@x.com;123;A;101;zzz'), { name: ['full name', 'nome'], email: ['e-mail'], phone: ['telefone', 'mobile'], block: ['bloco'], unit: ['unidade', 'flat'] });
  assert.deepStrictEqual(objects[0], { _line: 2, name: 'Ana', email: 'ana@x.com', phone: '123', block: 'A', unit: '101' });
});
test('csvCell blocks spreadsheet formula injection and quotes properly', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`);
  assert.equal(csvCell('+1234'), "'+1234");
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell(null), '');
});

test('Turkish dotless i in headers is matched', () => {
  const { objects } = toObjects(parseCsv('Adı Soyadı;E-posta;Daire\nAli;a@x.com;5'), { name: ['adi soyadi'], email: ['e-posta'], unit: ['daire'] });
  assert.equal(objects[0].name, 'Ali');
});
