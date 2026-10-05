'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertTransition, tenantPatchFor, subscriptionStatusFor, evaluateAccess, TRANSITIONS } = require('../src/lifecycle/lifecycle');

test('lifecycle: legal and illegal transitions', () => {
  for (const [from, tos] of Object.entries(TRANSITIONS)) for (const to of tos) assert.ok(assertTransition(from, to));
  assert.throws(() => assertTransition('ACTIVE', 'TRIAL'), /Cannot go/);
  assert.throws(() => assertTransition('DELETED', 'ACTIVE'), /Cannot go/);
  assert.throws(() => assertTransition('ACTIVE', 'ACTIVE'), /already/);
  assert.throws(() => assertTransition('DELETED', 'SUSPENDED', { purged: true }), /erased/);
  assert.throws(() => assertTransition('ACTIVE', 'BOGUS'), /Unknown/);
});

test('lifecycle: patches and subscription mirror', () => {
  const now = new Date('2026-10-04T00:00:00Z');
  assert.equal(tenantPatchFor('DELETED', { now, retentionDays: 30 }).purgeAfter.toISOString(), '2026-11-03T00:00:00.000Z');
  assert.equal(tenantPatchFor('SUSPENDED', { now, reason: 'NONPAYMENT' }).suspendedReason, 'NONPAYMENT');
  assert.equal(tenantPatchFor('ACTIVE', { now }).suspendedAt, null);
  assert.equal(subscriptionStatusFor('DELETED'), 'CANCELLED'); assert.equal(subscriptionStatusFor('EXPIRED'), 'EXPIRED');
});

test('access gate: TRIAL/ACTIVE full access; trial that ran out is treated as EXPIRED immediately', () => {
  const now = new Date('2026-10-04T00:00:00Z');
  assert.equal(evaluateAccess({ status: 'ACTIVE' }, now, 'POST', '/api/billing').allow, true);
  assert.equal(evaluateAccess({ status: 'TRIAL', trialEndsAt: '2026-10-10T00:00:00Z' }, now, 'POST', '/api/billing').allow, true);
  const r = evaluateAccess({ status: 'TRIAL', trialEndsAt: '2026-10-01T00:00:00Z' }, now, 'GET', '/api/billing');
  assert.equal(r.allow, false); assert.equal(r.status, 402); assert.equal(r.code, 'TENANT_EXPIRED');
});

test('access gate: SUSPENDED = read-only, but SOS and auth/subscription still work', () => {
  const now = new Date(); const t = { status: 'SUSPENDED' };
  assert.equal(evaluateAccess(t, now, 'GET', '/api/residents').allow, true);
  assert.equal(evaluateAccess(t, now, 'POST', '/api/billing').status, 403);
  assert.equal(evaluateAccess(t, now, 'PUT', '/api/billing/abc').code, 'TENANT_SUSPENDED');
  assert.equal(evaluateAccess(t, now, 'POST', '/api/emergency').allow, true);
  assert.equal(evaluateAccess(t, now, 'POST', '/api/auth/login').allow, true);
});

test('access gate: EXPIRED blocks everything except auth + subscription; DELETED is gone', () => {
  const now = new Date(); const t = { status: 'EXPIRED' };
  assert.equal(evaluateAccess(t, now, 'GET', '/api/residents').status, 402);
  assert.equal(evaluateAccess(t, now, 'POST', '/api/emergency').status, 402);
  assert.equal(evaluateAccess(t, now, 'GET', '/api/subscription').allow, true);
  assert.equal(evaluateAccess(t, now, 'GET', '/api/auth/me').allow, true);
  assert.equal(evaluateAccess({ status: 'DELETED' }, now, 'GET', '/api/auth/me').status, 410);
});
