'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { planStatusChange } = require('../src/modules/staff/staffStatus');
const { toCsv, cell } = require('../src/utils/csvExport');

test('staff status: reason required to leave work; reinstating clears the note and unlocks', () => {
  assert.equal(planStatusChange('ACTIVE', 'SUSPENDED', {}).ok, false);
  const s = planStatusChange('ACTIVE', 'SUSPENDED', { note: 'Investigation' });
  assert.equal(s.patch.isActive, false); assert.equal(s.userPatch.isActive, false); assert.equal(s.userPatch.signOutEverywhere, true);
  const left = planStatusChange('ACTIVE', 'LEFT', { note: 'Resigned', date: '2026-11-20' });
  assert.equal(left.patch.leftAt.toISOString().slice(0, 10), '2026-11-20');
  const back = planStatusChange('SUSPENDED', 'ACTIVE', {});
  assert.equal(back.ok, true); assert.equal(back.patch.statusNote, null); assert.equal(back.userPatch.isActive, true); assert.equal(back.patch.leftAt, null);
  assert.equal(planStatusChange('ACTIVE', 'ACTIVE', {}).ok, false);
  assert.equal(planStatusChange('ACTIVE', 'FIRED', { note: 'abc' }).ok, false);
  assert.equal(planStatusChange('ACTIVE', 'LEFT', { note: 'abc', date: 'nonsense' }).ok, false);
});

test('csv export: quoting, BOM, booleans, dates and formula-injection guard', () => {
  assert.equal(cell('a,b'), '"a,b"'); assert.equal(cell('say "hi"'), '"say ""hi"""'); assert.equal(cell(null), ''); assert.equal(cell(true), 'Yes');
  assert.equal(cell('=SUM(A1)'), "'=SUM(A1)"); assert.equal(cell('@x'), "'@x"); assert.equal(cell('-12.5'), '-12.5'); assert.equal(cell('+234803'), "'+234803");
  assert.equal(cell(new Date('2026-11-24T10:00:00Z')), '2026-11-24T10:00:00.000Z');
  const out = toCsv([{ n: 'Ann', v: 'ABC 1' }, { n: 'Bo,b', v: null }], [['Name', (r) => r.n], ['Plate', (r) => r.v]]);
  assert.ok(out.startsWith('﻿Name,Plate\r\n')); assert.ok(out.includes('"Bo,b",\r\n'));
});

test('migration 008 is idempotent and keeps plate history', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/008_lifecycle.sql'), 'utf8');
  assert.equal((sql.match(/ADD COLUMN/g) || []).length, (sql.match(/ADD COLUMN IF NOT EXISTS/g) || []).length);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_active_plate_key"[\s\S]*WHERE "isActive"/);
  assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE|TRUNCATE/i);
});
