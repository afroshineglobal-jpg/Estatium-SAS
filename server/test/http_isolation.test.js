'use strict';
/**
 * HTTP-level tests of the REAL middleware + tenant scope + routes + realtime layer, running on an
 * in-memory Prisma stand-in (helpers/fakePrisma.js). They prove the isolation / lifecycle / authz
 * LOGIC; they do not exercise PostgreSQL (that is test/db_isolation.test.sql).
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'tenant-secret-tenant-secret-tenant-secret-0001';
process.env.PLATFORM_JWT_SECRET = 'platform-secret-platform-secret-platform-0002';
process.env.CORS_ORIGINS = 'http://localhost:3000';

const Module = require('node:module');
const fake = require('./helpers/fakePrisma');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@prisma/client') return fake;
  if (request === 'firebase-admin') return { apps: [], messaging: () => ({ send: async () => '' }) };
  return origLoad.call(this, request, ...rest);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
let ioClient = null; try { ioClient = require('socket.io-client'); } catch { /* socket test is skipped without the client lib */ }

const prisma = require('../src/config/prisma');
const { buildApp } = require('../src/app');
const { attachRealtime } = require('../src/realtime');
const { invalidateTenant } = require('../src/middleware/auth.middleware');

const PW = 'Passw0rd!Admin1';
const db = prisma.system;                        // fake client (shared store)
const hash = bcrypt.hashSync(PW, 4);
let base, server, io;

const T = { A: 'tenant-a', B: 'tenant-b', S: 'tenant-s', X: 'tenant-x', D: 'tenant-d' };
const future = new Date(Date.now() + 30 * 86400000);

async function seed() {
  const st = db.store;
  const tenants = [[T.A, 'alpha', 'ACTIVE'], [T.B, 'beta', 'ACTIVE'], [T.S, 'sus', 'SUSPENDED'], [T.X, 'exp', 'EXPIRED'], [T.D, 'del', 'DELETED']];
  st.Tenant = tenants.map(([id, slug, status]) => ({ id, slug, name: slug.toUpperCase(), status, currency: 'USD', timezone: 'UTC', trialEndsAt: null, createdAt: new Date() }));
  const user = (id, tenantId, email, role) => ({ id, tenantId, email, role, name: id, password: hash, isActive: true, tokenVersion: 0, failedLogins: 0, lockedUntil: null, mustChangePassword: false });
  st.User = [
    user('uA-admin', T.A, 'admin@a.test', 'ADMIN'), user('uA-res', T.A, 'res@a.test', 'RESIDENT'), user('uA-guard', T.A, 'guard@a.test', 'GUARD'), user('uA-res2', T.A, 'res2@a.test', 'RESIDENT'),
    user('uB-admin', T.B, 'admin@b.test', 'ADMIN'), user('uB-res', T.B, 'res@b.test', 'RESIDENT'),
    user('uS-admin', T.S, 'admin@s.test', 'ADMIN'), user('uS-res', T.S, 'res@s.test', 'RESIDENT'), user('uX-admin', T.X, 'admin@x.test', 'ADMIN'), user('uD-admin', T.D, 'admin@d.test', 'ADMIN'),
  ];
  st.Unit = [{ id: 'a0000000-0000-4000-8000-0000000000a1', tenantId: T.A, blockId: 'bA', unitNumber: '001', isActive: true }, { id: 'b0000000-0000-4000-8000-0000000000a1', tenantId: T.B, blockId: 'bB', unitNumber: '001', isActive: true }];
  st.Resident = [
    { id: 'a0000000-0000-4000-8000-000000000001', tenantId: T.A, userId: 'uA-res', unitId: 'a0000000-0000-4000-8000-0000000000a1', isActive: true, residentType: 'OWNER' }, { id: 'a0000000-0000-4000-8000-000000000002', tenantId: T.A, userId: 'uA-res2', unitId: 'a0000000-0000-4000-8000-0000000000a1', isActive: true, residentType: 'TENANT' },
    { id: 'b0000000-0000-4000-8000-000000000001', tenantId: T.B, userId: 'uB-res', unitId: 'b0000000-0000-4000-8000-0000000000a1', isActive: true, residentType: 'OWNER' },
  ];
  st.Bill = [{ id: 'a0000000-0000-4000-8000-0000000000b1', tenantId: T.A, residentId: 'a0000000-0000-4000-8000-000000000001', title: 'Dues', amount: 100, amountPaid: 0, currency: 'USD', status: 'UNPAID' }, { id: 'b0000000-0000-4000-8000-0000000000b1', tenantId: T.B, residentId: 'b0000000-0000-4000-8000-000000000001', title: 'B dues', amount: 50, amountPaid: 0, currency: 'USD', status: 'UNPAID' }];
  st.Visitor = [{ id: 'visA', tenantId: T.A, residentId: 'a0000000-0000-4000-8000-000000000001', name: 'Guest', status: 'APPROVED', entryCode: '123456' }];
  const sub = (tenantId, status) => ({ id: `sub-${tenantId}`, tenantId, planId: 'plan-1', status, currency: 'USD', billingInterval: 'MONTHLY', currentPeriodStart: new Date(), currentPeriodEnd: future, paymentTermsDays: 14, graceDays: 7, creditBalance: 0 });
  st.Subscription = [sub(T.A, 'ACTIVE'), sub(T.B, 'ACTIVE'), sub(T.S, 'SUSPENDED')];
  st.Plan = [{ id: 'plan-1', code: 'standard', name: 'Standard', pricingModel: 'PER_UNIT', minBillableUnits: 0, isActive: true, prices: [] }];
  st.PlatformUser = [
    { id: 'p-owner', email: 'owner@p.test', name: 'Owner', role: 'SUPER_OWNER', password: hash, isActive: true, tokenVersion: 0, failedLogins: 0, lockedUntil: null },
    { id: 'p-support', email: 'support@p.test', name: 'Support', role: 'SUPPORT', password: hash, isActive: true, tokenVersion: 0, failedLogins: 0, lockedUntil: null },
  ];
}

const call = async (method, path, { token, body, headers } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
};
const login = async (tenant, email, password = PW) => (await call('POST', '/api/auth/login', { body: { tenant, email, password } }));
const tokenFor = async (tenant, email) => { const r = await login(tenant, email); assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.body)}`); return r.body.token; };
const platformToken = async (email) => { const r = await call('POST', '/api/platform/auth/login', { body: { email, password: PW } }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.token; };

test.before(async () => {
  await seed();
  const app = buildApp(); server = http.createServer(app); io = attachRealtime(server, app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { io?.close(); await new Promise((r) => server.close(r)); });

// ─── authentication ───────────────────────────────────────────────────────────
test('login: success returns token + tenant, password never leaks', async () => {
  const r = await login('alpha', 'admin@a.test');
  assert.equal(r.status, 200); assert.equal(r.body.tenant.slug, 'alpha'); assert.equal(r.body.user.password, undefined); assert.ok(r.body.token);
});

test('login: wrong password, unknown user and unknown estate are indistinguishable', async () => {
  const a = await login('alpha', 'admin@a.test', 'nope'); const b = await login('alpha', 'ghost@a.test'); const c = await login('no-such-estate', 'admin@a.test');
  for (const r of [a, b, c]) { assert.equal(r.status, 401); assert.equal(r.body.error, 'Invalid credentials'); }
});

test('login: the same email in another estate is a different account (tenant is part of the identity)', async () => {
  const r = await login('beta', 'admin@a.test'); assert.equal(r.status, 401);
});

test('login: account locks after 5 failures, then even the right password is refused', async () => {
  for (let i = 0; i < 5; i++) await login('alpha', 'guard@a.test', 'bad');
  const r = await login('alpha', 'guard@a.test'); assert.equal(r.status, 423);
  db.store.User.find((u) => u.id === 'uA-guard').lockedUntil = null; db.store.User.find((u) => u.id === 'uA-guard').failedLogins = 0;
});

test('login: deleted estate cannot log in; suspended/expired can (to see why)', async () => {
  assert.equal((await login('del', 'admin@d.test')).status, 401);
  assert.equal((await login('sus', 'admin@s.test')).status, 200);
  assert.equal((await login('exp', 'admin@x.test')).status, 200);
});

test('no token / garbage token / removed unauthenticated push route', async () => {
  assert.equal((await call('GET', '/api/residents')).status, 401);
  assert.equal((await call('GET', '/api/residents', { token: 'abc.def.ghi' })).status, 401);
  assert.equal((await call('POST', '/api/send-notification', { body: { token: 'x', title: 't', body: 'b' } })).status, 404);
});

// ─── tenant isolation ─────────────────────────────────────────────────────────
test('ISOLATION: each estate sees only its own residents', async () => {
  const a = await call('GET', '/api/residents', { token: await tokenFor('alpha', 'admin@a.test') });
  const b = await call('GET', '/api/residents', { token: await tokenFor('beta', 'admin@b.test') });
  assert.deepEqual(a.body.map((r) => r.id).sort(), ['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002']); assert.deepEqual(b.body.map((r) => r.id), ['b0000000-0000-4000-8000-000000000001']);
});

test('ISOLATION: a tenant-A admin cannot read a tenant-B resident or bill by id (404, not 403)', async () => {
  const tA = await tokenFor('alpha', 'admin@a.test');
  assert.equal((await call('GET', '/api/residents/b0000000-0000-4000-8000-000000000001', { token: tA })).status, 404);
  assert.equal((await call('GET', '/api/residents/a0000000-0000-4000-8000-000000000001', { token: tA })).status, 200);
  assert.equal((await call('PUT', '/api/billing/b0000000-0000-4000-8000-0000000000b1', { token: tA, body: { status: 'WAIVED' } })).status, 404);
  assert.equal(db.store.Bill.find((b) => b.id === 'b0000000-0000-4000-8000-0000000000b1').status, 'UNPAID');
});

test('ISOLATION: client-supplied tenantId / foreign unit is ignored or rejected', async () => {
  const tA = await tokenFor('alpha', 'admin@a.test');
  const forged = await call('POST', '/api/residents', { token: tA, body: { name: 'X', email: 'x@a.test', unitId: '11111111-1111-4111-8111-111111111111', tenantId: T.B } });
  assert.equal(forged.status, 404);                                                    // unit of another estate = not found
  const q = await call('GET', `/api/residents?tenantId=${T.B}`, { token: tA });         // query-string tenant is never read
  assert.deepEqual(q.body.map((r) => r.id).sort(), ['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002']);
  assert.equal((await call('GET', '/api/residents', { token: tA, headers: { 'x-tenant': 'beta' } })).body.length, 2);   // header is only used by /login
});

test('ISOLATION: queries made without a tenant context throw instead of leaking', async () => {
  await assert.rejects(() => prisma.user.findMany(), /Tenant context required/);
  await assert.rejects(() => prisma.bill.findMany(), /Tenant context required/);
});

// ─── authorization inside a tenant (the audit's critical findings) ────────────
test('AUTHZ: a resident cannot record a payment (legacy "free bills" hole) nor list residents', async () => {
  const t = await tokenFor('alpha', 'res@a.test');
  assert.equal((await call('POST', '/api/billing/a0000000-0000-4000-8000-0000000000b1/pay', { token: t, body: { amount: '100', method: 'CASH' } })).status, 403);
  assert.equal((await call('GET', '/api/residents', { token: t })).status, 403);
  assert.equal(db.store.Bill.find((b) => b.id === 'a0000000-0000-4000-8000-0000000000b1').amountPaid, 0);
});

test('AUTHZ: resident cannot read a neighbour\'s record; can read their own', async () => {
  const t = await tokenFor('alpha', 'res@a.test');
  assert.equal((await call('GET', '/api/residents/a0000000-0000-4000-8000-000000000002', { token: t })).status, 403);
  assert.equal((await call('GET', '/api/residents/a0000000-0000-4000-8000-000000000001', { token: t })).status, 200);
  assert.equal((await call('DELETE', '/api/residents/a0000000-0000-4000-8000-000000000002/members/22222222-2222-4222-8222-222222222222', { token: t })).status, 403);
});

test('AUTHZ: resident cannot use the gate (visitor entry-code verification)', async () => {
  assert.equal((await call('POST', '/api/visitors/verify-code', { token: await tokenFor('alpha', 'res@a.test'), body: { entryCode: '123456' } })).status, 403);
  assert.equal((await call('POST', '/api/visitors/verify-code', { token: await tokenFor('alpha', 'guard@a.test'), body: { entryCode: '123456' } })).status, 200);
});

test('AUTHZ: invalid input is a clean 400, never a 500 with internals', async () => {
  const t = await tokenFor('alpha', 'admin@a.test');
  const r = await call('POST', '/api/billing', { token: t, body: { residentId: 'a0000000-0000-4000-8000-000000000001', title: 'x', amount: '-5', dueDate: 'tomorrow' } });
  assert.equal(r.status, 400); assert.ok(!/prisma|stack/i.test(JSON.stringify(r.body)));
  assert.equal((await call('PUT', '/api/billing/not-a-uuid', { token: t, body: {} })).status, 400);
});

// ─── tenant lifecycle gate ────────────────────────────────────────────────────
test('LIFECYCLE: SUSPENDED = read-only (SOS and auth still work)', async () => {
  const t = await tokenFor('sus', 'admin@s.test'); const res = await tokenFor('sus', 'res@s.test');
  assert.equal((await call('GET', '/api/residents', { token: t })).status, 200);
  const w = await call('POST', '/api/billing', { token: t, body: {} }); assert.equal(w.status, 403); assert.equal(w.body.code, 'TENANT_SUSPENDED');
  assert.equal((await call('POST', '/api/emergency', { token: res, body: { type: 'FIRE' } })).status, 201);
  assert.equal((await call('GET', '/api/auth/me', { token: t })).status, 200);
});

test('LIFECYCLE: EXPIRED blocks the app (402) but /auth/me works', async () => {
  const t = await tokenFor('exp', 'admin@x.test');
  const r = await call('GET', '/api/residents', { token: t }); assert.equal(r.status, 402); assert.equal(r.body.code, 'TENANT_EXPIRED');
  assert.equal((await call('GET', '/api/auth/me', { token: t })).status, 200);
});

test('LIFECYCLE: an in-flight token of a deleted estate stops working immediately', async () => {
  const t = await tokenFor('alpha', 'admin@a.test');
  assert.equal((await call('GET', '/api/residents', { token: t })).status, 200);
  const A = db.store.Tenant.find((x) => x.id === T.A); A.status = 'DELETED'; invalidateTenant(T.A);
  const r = await call('GET', '/api/residents', { token: t }); assert.equal(r.status, 410);
  A.status = 'ACTIVE'; invalidateTenant(T.A);
});

// ─── token handling ───────────────────────────────────────────────────────────
test('TOKENS: changing the password revokes every older token and enforces the policy', async () => {
  const old = await tokenFor('beta', 'res@b.test');
  const weak = await call('PUT', '/api/auth/password', { token: old, body: { currentPassword: PW, newPassword: 'short' } }); assert.equal(weak.status, 400);
  const ok = await call('PUT', '/api/auth/password', { token: old, body: { currentPassword: PW, newPassword: 'N3wStrongPassw0rd' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/auth/me', { token: old })).status, 401);          // old token revoked
  assert.equal((await call('GET', '/api/auth/me', { token: ok.body.token })).status, 200); // new one works
});

test('TOKENS: a platform (Super Owner) token is useless on tenant routes and vice-versa', async () => {
  const pt = await platformToken('owner@p.test'); const tt = await tokenFor('alpha', 'admin@a.test');
  assert.equal((await call('GET', '/api/residents', { token: pt })).status, 401);
  assert.equal((await call('GET', '/api/platform/tenants', { token: tt })).status, 401);
});

// ─── Super Owner portal ───────────────────────────────────────────────────────
test('PLATFORM: needs a platform login; permissions are enforced per role', async () => {
  assert.equal((await call('GET', '/api/platform/tenants')).status, 401);
  const owner = await platformToken('owner@p.test'); const support = await platformToken('support@p.test');
  const list = await call('GET', '/api/platform/tenants', { token: support }); assert.equal(list.status, 200);
  assert.equal((await call('POST', `/api/platform/tenants/${T.B}/suspend`, { token: support, body: {} })).status, 403);   // SUPPORT cannot suspend
  assert.equal((await call('GET', '/api/platform/users', { token: support })).status, 403);                                  // nor manage platform users
  assert.equal((await call('GET', '/api/platform/users', { token: owner })).status, 200);
});

test('PLATFORM: suspending a tenant takes effect on its very next request, is audited, and can be reversed', async () => {
  const owner = await platformToken('owner@p.test'); const tB = await tokenFor('beta', 'admin@b.test');
  assert.equal((await call('POST', '/api/billing', { token: tB, body: {} })).status, 400);                       // active: validation error (not blocked)
  const s = await call('POST', `/api/platform/tenants/${T.B}/suspend`, { token: owner, body: { reason: 'test' } }); assert.equal(s.status, 200); assert.equal(s.body.status, 'SUSPENDED');
  const blocked = await call('POST', '/api/billing', { token: tB, body: {} }); assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'TENANT_SUSPENDED');
  assert.ok(db.store.AuditLog.some((a) => a.action === 'TENANT_SUSPENDED' && a.tenantId === T.B && a.actorType === 'PLATFORM_USER'));
  assert.equal((await call('POST', `/api/platform/tenants/${T.B}/suspend`, { token: owner, body: {} })).status, 409);   // already suspended
  const back = await call('POST', `/api/platform/tenants/${T.B}/activate`, { token: owner }); assert.equal(back.status, 200);
  assert.equal((await call('POST', '/api/billing', { token: tB, body: {} })).status, 400);
});

test('PLATFORM: deleting a tenant requires typing its slug', async () => {
  const owner = await platformToken('owner@p.test');
  assert.equal((await call('DELETE', `/api/platform/tenants/${T.B}`, { token: owner, body: { confirmSlug: 'wrong' } })).status, 400);
  assert.equal(db.store.Tenant.find((t) => t.id === T.B).status, 'ACTIVE');
});

// ─── realtime ─────────────────────────────────────────────────────────────────
test('REALTIME: sockets need a valid token; an SOS in estate A reaches A\'s staff and NEVER estate B', { skip: !ioClient }, async () => {
  const connect = (token) => new Promise((resolve) => { const s = ioClient(base, { auth: { token }, transports: ['websocket'], reconnection: false }); s.on('connect', () => resolve(s)); s.on('connect_error', () => resolve(null)); });
  assert.equal(await connect('garbage'), null);                                   // anonymous clients are rejected
  const adminA = await connect(await tokenFor('alpha', 'admin@a.test')); const adminB = await connect(await tokenFor('beta', 'admin@b.test'));
  assert.ok(adminA && adminB);
  const gotA = [], gotB = []; adminA.on('emergency-alert', (p) => gotA.push(p)); adminB.on('emergency-alert', (p) => gotB.push(p));
  const r = await call('POST', '/api/emergency', { token: await tokenFor('alpha', 'res@a.test'), body: { type: 'FIRE', location: 'Block A' } }); assert.equal(r.status, 201);
  await new Promise((res) => setTimeout(res, 400));
  assert.equal(gotA.length, 1, 'estate A admin must receive the alert'); assert.equal(gotB.length, 0, 'estate B must never receive it');
  adminA.close(); adminB.close();
});

test('REALTIME: the client can no longer fake an SOS or join a foreign unit room', { skip: !ioClient }, async () => {
  const connect = (token) => new Promise((resolve) => { const s = ioClient(base, { auth: { token }, transports: ['websocket'], reconnection: false }); s.on('connect', () => resolve(s)); });
  const attacker = await connect(await tokenFor('alpha', 'res@a.test')); const victim = await connect(await tokenFor('alpha', 'admin@a.test'));
  const got = []; victim.on('emergency-alert', (p) => got.push(p)); victim.on('new-message', (p) => got.push(p));
  attacker.emit('emergency-sos', { fake: true }); attacker.emit('send-message', { roomId: 'general', content: 'x' }); attacker.emit('join-room', 'unit-33333333-3333-4333-8333-333333333333');
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(got.length, 0); attacker.close(); victim.close();
});
