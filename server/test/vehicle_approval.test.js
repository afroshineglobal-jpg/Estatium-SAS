'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('migration 007 keeps existing vehicles APPROVED and is idempotent', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/007_vehicle_approval.sql'), 'utf8');
  assert.match(sql, /"status"\s+TEXT NOT NULL DEFAULT 'APPROVED'/);
  assert.equal((sql.match(/ADD COLUMN/g) || []).length, (sql.match(/ADD COLUMN IF NOT EXISTS/g) || []).length);
});
test('schema and migration agree on the vehicle approval columns', () => {
  const prisma = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  const sql = fs.readFileSync(path.join(__dirname, '../sql/007_vehicle_approval.sql'), 'utf8');
  for (const c of ['status', 'reviewNote', 'reviewedById', 'reviewedAt', 'requestedAt']) { assert.ok(sql.includes(`"${c}"`), c); assert.match(prisma, new RegExp(`model Vehicle \\{[\\s\\S]*?\\b${c}\\b[\\s\\S]*?\\n\\}`)); }
});
