'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { prepaidState, paidThroughFromLedger } = require('../src/billing/prepaid');
const { evaluateAccess } = require('../src/lifecycle/lifecycle');

const at = (s) => new Date(`${s}T12:00:00Z`);

test('no paid date and no trial end: UNPAID, full access, no countdown', () => {
  const s = prepaidState({ now: at('2026-12-01') });
  assert.deepStrictEqual([s.state, s.daysLeft, s.readOnly], ['UNPAID', null, false]);
});

test('countdown thresholds 90/60/30 (boundary days)', () => {
  const pt = '2027-03-31';                                   // access runs to the start of 2027-04-01
  const state = (now) => prepaidState({ paidThrough: pt, now: at(now) });
  assert.equal(state('2026-12-01').state, 'ACTIVE');         // 121 days
  assert.equal(state('2026-12-31').daysLeft, 91);
  assert.equal(state('2026-12-31').state, 'ACTIVE');
  assert.equal(state('2027-01-01').state, 'APPROACHING');    // 90 days
  assert.equal(state('2027-01-30').state, 'APPROACHING');    // 61 days: not yet due soon
  assert.equal(state('2027-01-31').state, 'DUE_SOON');       // 60 days
});

test('threshold edges are exact', () => {
  const mk = (daysLeft) => { const now = new Date('2027-01-01T00:00:00Z'); const pt = new Date(now.getTime() + (daysLeft - 1) * 86400000); return prepaidState({ paidThrough: pt, now }); };
  assert.equal(mk(91).state, 'ACTIVE');
  assert.equal(mk(90).state, 'APPROACHING');
  assert.equal(mk(61).state, 'APPROACHING');
  assert.equal(mk(60).state, 'DUE_SOON');
  assert.equal(mk(31).state, 'DUE_SOON');
  assert.equal(mk(30).state, 'URGENT');
  assert.equal(mk(1).state, 'URGENT');
});

test('paid-through day itself is still fully paid; the next day starts grace', () => {
  const lastDay = prepaidState({ paidThrough: '2027-03-31', now: new Date('2027-03-31T23:59:59Z') });
  assert.equal(lastDay.state, 'URGENT'); assert.equal(lastDay.daysLeft, 1);
  const next = prepaidState({ paidThrough: '2027-03-31', now: new Date('2027-04-01T00:00:00Z') });
  assert.equal(next.state, 'GRACE'); assert.equal(next.readOnly, false); assert.equal(next.graceDaysLeft, 30);
});

test('30-day grace then read-only; paying lifts it immediately', () => {
  const pt = '2027-03-31';
  assert.equal(prepaidState({ paidThrough: pt, now: new Date('2027-04-30T23:59:59Z') }).state, 'GRACE');
  assert.equal(prepaidState({ paidThrough: pt, now: new Date('2027-05-01T00:00:00Z') }).state, 'READ_ONLY');
  assert.equal(prepaidState({ paidThrough: '2027-06-30', now: new Date('2027-05-01T00:00:00Z') }).readOnly, false);
});

test('grace days are configurable per estate', () => {
  assert.equal(prepaidState({ paidThrough: '2027-03-31', now: new Date('2027-04-08T00:00:00Z'), graceDays: 7 }).state, 'READ_ONLY');
  assert.equal(prepaidState({ paidThrough: '2027-03-31', now: new Date('2027-04-08T00:00:00Z'), graceDays: 0 }).readOnly, true);
});

test('a trial end acts as the end date when nothing is paid yet; payment takes over', () => {
  const trial = prepaidState({ trialEndsAt: '2026-12-15T00:00:00Z', now: at('2026-12-01') });
  assert.equal(trial.source, 'TRIAL'); assert.equal(trial.readOnly, false);
  assert.equal(prepaidState({ trialEndsAt: '2026-12-15T00:00:00Z', now: at('2027-02-01') }).state, 'READ_ONLY');
  assert.equal(prepaidState({ paidThrough: '2027-12-31', trialEndsAt: '2026-12-15T00:00:00Z', now: at('2027-02-01') }).source, 'PAID');
});

test('ledger: latest periodTo of non-voided payments wins; voiding recomputes; none -> null', () => {
  const P = (to, status = 'RECORDED') => ({ periodTo: to, status });
  assert.equal(paidThroughFromLedger([]), null);
  assert.equal(paidThroughFromLedger([P('2027-01-31'), P('2027-02-28')]).toISOString().slice(0, 10), '2027-02-28');
  assert.equal(paidThroughFromLedger([P('2027-01-31'), P('2027-02-28', 'VOIDED')]).toISOString().slice(0, 10), '2027-01-31');
  assert.equal(paidThroughFromLedger([P('2027-01-31', 'VOIDED')]), null);
});

test('access gate: prepaid estate keeps full access in grace, then is read-only (view + SOS + auth only)', () => {
  const t = (over) => ({ status: 'ACTIVE', billingMode: 'MANUAL_PREPAID', paidThrough: '2027-03-31', prepaidGraceDays: 30, ...over });
  assert.equal(evaluateAccess(t(), at('2027-04-15'), 'POST', '/api/residents').allow, true);               // grace
  const ro = t(); const late = at('2027-06-01');
  assert.equal(evaluateAccess(ro, late, 'GET', '/api/residents').allow, true);
  assert.equal(evaluateAccess(ro, late, 'POST', '/api/residents').allow, false);
  assert.equal(evaluateAccess(ro, late, 'POST', '/api/residents').status, 403);
  assert.equal(evaluateAccess(ro, late, 'POST', '/api/residents').code, 'PAYMENT_OVERDUE_READ_ONLY');
  assert.equal(evaluateAccess(ro, late, 'PUT', '/api/billing/1').allow, false);
  assert.equal(evaluateAccess(ro, late, 'POST', '/api/emergency').allow, true);                             // SOS always works
  assert.equal(evaluateAccess(ro, late, 'POST', '/api/auth/login').allow, true);
  assert.equal(evaluateAccess(ro, late, 'GET', '/api/subscription').allow, true);
  assert.equal(evaluateAccess(t({ paidThrough: '2027-12-31' }), late, 'POST', '/api/residents').allow, true);   // paying lifts it
});

test('access gate: prepaid trial that ran out is read-only, never the old hard 402 lock-out', () => {
  const t = { status: 'TRIAL', billingMode: 'MANUAL_PREPAID', paidThrough: null, trialEndsAt: '2026-01-01T00:00:00Z', prepaidGraceDays: 30 };
  const r = evaluateAccess(t, at('2026-06-01'), 'GET', '/api/residents');
  assert.equal(r.allow, true); assert.equal(r.readOnly, true);
  assert.notEqual(evaluateAccess(t, at('2026-06-01'), 'POST', '/api/residents').status, 402);
  assert.equal(evaluateAccess({ ...t, status: 'EXPIRED' }, at('2026-06-01'), 'GET', '/api/residents').allow, true);   // expired + prepaid = read-only too
});

test('non-prepaid estates behave exactly as before (402 on expiry)', () => {
  assert.equal(evaluateAccess({ status: 'EXPIRED' }, at('2026-06-01'), 'GET', '/api/residents').status, 402);
  assert.equal(evaluateAccess({ status: 'TRIAL', trialEndsAt: '2026-01-01T00:00:00Z' }, at('2026-06-01'), 'GET', '/api/residents').status, 402);
});

test('migration 005 and schema.prisma agree on the new columns and table', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/005_pilot_prepaid.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  for (const col of ['billingMode', 'paidThrough', 'prepaidGraceDays']) { assert.ok(sql.includes(`"${col}"`), `sql lacks ${col}`); assert.ok(schema.includes(col), `schema lacks ${col}`); }
  const model = schema.match(/model PrepaidPayment \{[\s\S]*?\n\}/)[0];
  const fields = [...model.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1]).filter((f) => !['@@unique', '@@index'].includes(f));
  const relationFields = new Set(['tenant', 'currencyRef']);
  for (const f of fields.filter((x) => !relationFields.has(x))) assert.ok(sql.includes(`"${f}"`), `sql table lacks column ${f}`);
});
