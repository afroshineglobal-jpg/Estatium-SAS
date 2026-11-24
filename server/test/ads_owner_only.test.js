'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { can } = require('../src/modules/platform/permissions');

test('estate users cannot create or change ads; only count views and taps', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/modules/advertisements/advertisements.routes.js'), 'utf8');
  assert.doesNotMatch(src, /router\.(put|patch|delete)\(/);
  assert.doesNotMatch(src, /router\.post\('\/'/);
  assert.match(src, /router\.get\('\/'/);
  assert.match(src, /'\/:id\/impression'/); assert.match(src, /'\/:id\/click'/);
});

test('only the platform SUPER_OWNER holds ads:manage', () => {
  assert.equal(can('SUPER_OWNER', 'ads:manage'), true);
  for (const r of ['BILLING_ADMIN', 'SUPPORT', 'READ_ONLY']) assert.equal(can(r, 'ads:manage'), false);
});

test('every platform ad route is permission-checked', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/modules/platform/ads.routes.js'), 'utf8');
  const routes = src.match(/router\.(get|post|put|delete)\(/g) || [];
  const guarded = src.match(/router\.(get|post|put|delete)\('[^']*', need\('ads:manage'\)/g) || [];
  assert.equal(routes.length, guarded.length); assert.ok(routes.length >= 4);
});

test('migration 010 only adds the nullable pages column, idempotently', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/010_ads_pages.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "pages" TEXT;/);
  assert.doesNotMatch(sql, /DROP|TRUNCATE|NOT NULL/i);
});
