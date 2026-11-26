'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const EC = require('../src/utils/estateCode');

test('estate code is exactly 6 capital letters', () => {
  assert.equal(EC.normalize(' ab-c d3ef '), 'ABCDEF');
  assert.equal(EC.isValid('ABCDEF'), true);
  for (const bad of ['ABCDE', 'ABCDEFG', 'ABC1EF', 'abcdef', '']) assert.equal(EC.isValid(bad), false);
});

test('suggested codes start from the estate initials, are valid, and skip codes that are taken', async () => {
  const first = await EC.suggest('Test Estate Lagos', async () => false);
  assert.match(first, /^[A-Z]{6}$/); assert.equal(first.slice(0, 3), 'TEL');
  const seen = new Set(); let calls = 0;
  const code = await EC.suggest('Palm Grove', async (c) => { calls++; if (calls < 5) { seen.add(c); return true; } return false; });
  assert.ok(calls >= 5); assert.ok(!seen.has(code)); assert.match(code, /^[A-Z]{6}$/);
  await assert.rejects(EC.suggest('X', async () => true), /free estate code/);
});

test('migration 011 adds a unique, format-checked code and the location columns, idempotently', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/011_estate_code_location.sql'), 'utf8');
  assert.match(sql, /"estateCode" CHAR\(6\)/); assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_estateCode_key"/);
  assert.match(sql, /\^\[A-Z\]\{6\}\$/);
  for (const c of ['area', 'locality', 'city', 'district', 'state', 'postalCode']) assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS "${c}"`));
  assert.doesNotMatch(sql, /DROP|TRUNCATE/i);
});

test('Nigeria list: 37 states (36 + FCT) and the official 774 local governments', () => {
  const ng = require('../../client/src/data/nigeria.json');
  assert.equal(ng.states.length, 37);
  assert.equal(ng.states.reduce((s, x) => s + x.lgas.length, 0), 774);
  assert.ok(ng.states.find((s) => s.state === 'Lagos').lgas.includes('Ikeja'));
  assert.ok(ng.states.find((s) => s.state === 'Katsina') && ng.states.find((s) => s.state === 'Nasarawa'));
});
