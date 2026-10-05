'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { injectTenant } = require('../src/config/tenantScope');
const MODELS = require('../src/config/tenantModels');

const T = 'tenant-A';
test('scope: reads/updates/deletes get tenantId AND-ed in, caller-supplied tenantId is overwritten', () => {
  assert.deepEqual(injectTenant('findMany', { where: { status: 'PAID' } }, T).where, { status: 'PAID', tenantId: T });
  assert.deepEqual(injectTenant('findMany', undefined, T).where, { tenantId: T });
  assert.deepEqual(injectTenant('findMany', { where: { tenantId: 'tenant-B' } }, T).where, { tenantId: T });   // attack: ?tenantId=B
  assert.deepEqual(injectTenant('findUnique', { where: { id: '1' } }, T).where, { id: '1', tenantId: T });
  assert.deepEqual(injectTenant('delete', { where: { id: '1' } }, T).where, { id: '1', tenantId: T });
  assert.deepEqual(injectTenant('count', {}, T).where, { tenantId: T });
  assert.deepEqual(injectTenant('groupBy', { by: ['type'] }, T).where, { tenantId: T });
  assert.deepEqual(injectTenant('updateMany', { where: { a: 1 }, data: { x: 1 } }, T).where, { a: 1, tenantId: T });
});

test('scope: OR conditions cannot escape the tenant', () => {
  const w = injectTenant('findMany', { where: { OR: [{ id: 'x' }, { tenantId: 'tenant-B' }] } }, T).where;
  assert.equal(w.tenantId, T); assert.ok(w.OR);     // top-level AND with tenantId => the OR can only match inside tenant A
});

test('scope: create stamps tenantId and refuses to be overridden; relation key is dropped', () => {
  assert.equal(injectTenant('create', { data: { name: 'x' } }, T).data.tenantId, T);
  assert.equal(injectTenant('create', { data: { name: 'x', tenantId: 'tenant-B' } }, T).data.tenantId, T);
  assert.equal('tenant' in injectTenant('create', { data: { name: 'x', tenant: { connect: { id: 'B' } } } }, T).data, false);
  const many = injectTenant('createMany', { data: [{ a: 1 }, { a: 2, tenantId: 'B' }] }, T).data;
  assert.deepEqual(many.map((d) => d.tenantId), [T, T]);
});

test('scope: update can never move a row to another tenant', () => {
  const a = injectTenant('update', { where: { id: '1' }, data: { name: 'n', tenantId: 'tenant-B', tenant: { connect: { id: 'B' } } } }, T);
  assert.deepEqual(a.data, { name: 'n' }); assert.equal(a.where.tenantId, T);
  const u = injectTenant('upsert', { where: { id: '1' }, create: { k: 1, tenantId: 'B' }, update: { k: 2, tenantId: 'B' } }, T);
  assert.equal(u.create.tenantId, T); assert.equal('tenantId' in u.update, false); assert.equal(u.where.tenantId, T);
});

test('scope: no tenant => hard failure; raw/unknown operations are refused', () => {
  assert.throws(() => injectTenant('findMany', {}, undefined), /Tenant context missing/);
  assert.throws(() => injectTenant('findMany', {}, ''), /Tenant context missing/);
  assert.throws(() => injectTenant('$queryRaw', {}, T), /not allowed/);
  assert.throws(() => injectTenant('findRaw', {}, T), /not allowed/);
});

test('scope: input args are not mutated', () => {
  const args = { where: { id: '1' }, data: { a: 1 } }; const copy = JSON.stringify(args);
  injectTenant('update', args, T); assert.equal(JSON.stringify(args), copy);
});

test('tenantModels list == every Prisma model with tenantId + RLS in 002_rls (no drift)', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  const platform = new Set(['Subscription', 'Invoice', 'UsageRecord', 'SubscriptionEvent', 'PlatformPayment', 'AuditLog']);   // carry tenantId but are platform tables
  const scoped = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].filter(([, n, b]) => /^\s+tenantId\s+String\b/m.test(b) && !platform.has(n)).map(([, n]) => n).sort();
  assert.deepEqual([...MODELS].sort(), scoped);
  const sql = fs.readFileSync(path.join(__dirname, '../sql/002_rls_and_constraints.sql'), 'utf8');
  for (const m of scoped) assert.ok(sql.includes(`'${m}'`), `RLS list in sql/002 is missing ${m}`);
});
