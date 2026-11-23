'use strict';
process.env.DATABASE_URL ||= 'postgresql://x:y@127.0.0.1:5432/x'; process.env.JWT_SECRET ||= 'a'.repeat(40); process.env.PLATFORM_JWT_SECRET ||= 'b'.repeat(40);
const test = require('node:test');
const assert = require('node:assert');
const { evaluate, readRows } = require('../src/modules/residents/import.service');

const ctx = (blocks = [{ id: 'b1', name: 'Block A' }], units = [{ id: 'u1', blockId: 'b1', unitNumber: '101', isActive: true }, { id: 'u2', blockId: 'b1', unitNumber: '102', isActive: false }], taken = []) => ({
  blocks, blockByName: new Map(blocks.map((b) => [b.name.toLowerCase().replace(/[^a-z0-9]/g, ''), b])),
  unitByKey: new Map(units.map((u) => [`${u.blockId}\u0000${u.unitNumber.toLowerCase()}`, u])), taken: new Set(taken),
});
const row = (o) => ({ _line: 2, name: 'Ana Silva', email: 'ANA@Example.com', phone: '', block: 'Block A', unit: '101', type: '', ...o });

test('valid row: email lower-cased, default TENANT, unit resolved', () => {
  const [e] = evaluate([row({})], ctx(), { createMissing: false });
  assert.equal(e.error, null); assert.equal(e.email, 'ana@example.com'); assert.equal(e.residentType, 'TENANT'); assert.equal(e.unitId, 'u1');
});
test('type accepts English, Portuguese, German and Turkish words; rejects nonsense', () => {
  for (const [t, want] of [['owner', 'OWNER'], ['Proprietário', 'OWNER'], ['Mieter', 'TENANT'], ['kiracı', 'TENANT'], ['INQUILINO', 'TENANT']]) assert.equal(evaluate([row({ type: t })], ctx(), {})[0].residentType, want, t);
  assert.match(evaluate([row({ type: 'visitor' })], ctx(), {})[0].error, /OWNER or TENANT/);
});
test('row errors: name, email, unit, duplicates in file, existing account, unknown/inactive unit', () => {
  const rows = [row({ name: '' }), row({ email: 'not-an-email' }), row({ unit: '' }), row({ email: 'dup@x.com' }), row({ email: 'DUP@x.com', _line: 6 }), row({ email: 'old@x.com' }), row({ unit: '999', email: 'n1@x.com' }), row({ unit: '102', email: 'n2@x.com' }), row({ block: 'Nope', email: 'n3@x.com' })];
  const r = evaluate(rows, ctx(undefined, undefined, ['old@x.com']), { createMissing: false });
  assert.match(r[0].error, /Name/); assert.match(r[1].error, /Email/); assert.match(r[2].error, /Unit is required/);
  assert.equal(r[3].error, null); assert.match(r[4].error, /twice/); assert.match(r[5].error, /already has an account/);
  assert.match(r[6].error, /does not exist/); assert.match(r[7].error, /deactivated/); assert.match(r[8].error, /Block "Nope"/);
});
test('createMissing: new units/blocks are planned, not errors', () => {
  const r = evaluate([row({ unit: '300', email: 'a@x.com' }), row({ block: 'Block Z', unit: '1', email: 'b@x.com' })], ctx(), { createMissing: true });
  assert.equal(r[0].error, null); assert.equal(r[0].willCreateUnit, true); assert.equal(r[0].willCreateBlock, false);
  assert.equal(r[1].error, null); assert.equal(r[1].willCreateBlock, true);
});
test('a single-block estate lets the block column be empty; several blocks require it', () => {
  assert.equal(evaluate([row({ block: '' })], ctx(), {})[0].error, null);
  const two = ctx([{ id: 'b1', name: 'A' }, { id: 'b2', name: 'B' }], []);
  assert.match(evaluate([row({ block: '' })], two, {})[0].error, /Block is required/);
});
test('empty estate with createMissing and no block column creates a "Main" block', () => {
  const r = evaluate([row({ block: '' })], ctx([], []), { createMissing: true })[0];
  assert.equal(r.error, null); assert.equal(r.willCreateBlock, true); assert.equal(r.block, 'Main');
});
test('readRows: required columns, row cap, empty file, template-style semicolon file', () => {
  assert.throws(() => readRows('name,email\nA,a@x.com'), /"unit" column/);
  assert.throws(() => readRows(''), /Choose a CSV/);
  assert.throws(() => readRows('name,email,unit\n'), /no residents/);
  const big = 'name,email,unit\n' + Array.from({ length: 151 }, (_, i) => `N${i},n${i}@x.com,${i}`).join('\n');
  assert.throws(() => readRows(big), /at most 150/);
  const ok = readRows('Nome;E-mail;Bloco;Unidade;Tipo\nAna;a@x.com;A;101;Proprietário');
  assert.equal(ok.length, 1); assert.equal(ok[0].unit, '101'); assert.equal(ok[0].type, 'Proprietário');
});
