'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../src/modules/maintenance/stages');

test('stages run from received to completed, with friendly labels and a decline exit', () => {
  assert.deepEqual(S.KEYS.slice(0, 7), ['OPEN', 'ACCEPTED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_PARTS', 'FIXED', 'COMPLETED']);
  assert.equal(S.label('ASSIGNED'), 'Person allocated for inspection'); assert.equal(S.label('AWAITING_PARTS'), 'Awaiting parts'); assert.equal(S.label('NOPE'), 'NOPE');
  assert.ok(S.KEYS.includes('REJECTED'));
});
test('timeline appends, keeps order and is capped at 100', () => {
  let t = []; for (let i = 0; i < 105; i++) t = S.append(t, { status: 'OPEN', note: `n${i}`, by: 'Admin' });
  assert.equal(t.length, 100); assert.equal(t[0].note, 'n5'); assert.equal(t[99].note, 'n104'); assert.ok(t[0].at);
  assert.equal(S.append(null, { status: 'ACCEPTED' })[0].note, null);
});
test('every stage exists in the database enum (migration 014 + schema)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/014_maintenance_stages.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  const enumBody = /enum MaintenanceStatus \{([^}]*)\}/.exec(schema)[1];
  for (const k of S.KEYS) assert.match(enumBody, new RegExp(`\\b${k}\\b`));
  for (const k of ['ACCEPTED', 'AWAITING_PARTS', 'FIXED', 'REJECTED']) assert.match(sql, new RegExp(`ADD VALUE IF NOT EXISTS '${k}'`));
  assert.doesNotMatch(sql, /BEGIN|DROP|TRUNCATE/i);
});
test('route order: /stats is not swallowed by /:id, and invoicing is finance-only', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/modules/maintenance/maintenance.routes.js'), 'utf8');
  assert.match(src, /router\.get\('\/:id\(\[0-9a-fA-F-\]\{36\}\)'/);
  assert.match(src, /router\.post\('\/:id\/invoice', authenticate, authorize\('ADMIN', 'FINANCE_ADMIN'\)/);
});
