'use strict';
/**
 * Runs the prepaid ledger against a REAL PostgreSQL (scratch DB loaded with sql/001..005). Skipped unless set:
 *   TEST_DATABASE_URL=postgresql://owner:pw@127.0.0.1:5432/estatium_scratch node --test test/prepaid.integration.test.js
 * Uses the owner role on a throw-away database; never point it at production.
 */
const test = require('node:test');
const assert = require('node:assert');
const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'TEST_DATABASE_URL not set';
if (URL) { process.env.DATABASE_URL = URL; process.env.NODE_ENV = 'test'; process.env.ENABLE_RLS = 'false'; process.env.JWT_SECRET ||= 'x'.repeat(40); process.env.PLATFORM_JWT_SECRET ||= 'y'.repeat(40); }

test('prepaid ledger: record, activate, overlap warning, currency guard, void recompute, access gate', { skip }, async () => {
  const prisma = require('../src/config/prisma');
  const PP = require('../src/modules/platform/prepaid.service');
  const { evaluateAccess } = require('../src/lifecycle/lifecycle');
  const db = prisma.system;
  const id = require('crypto').randomUUID();
  const actor = { type: 'PLATFORM_USER', id: 'it-user', email: 'it@example.com' };
  const trialEnd = new Date('2026-12-01T00:00:00Z');
  const plan = await db.plan.findFirst({ where: { code: 'standard' } });
  await db.tenant.create({ data: { id, slug: `it-${id.slice(0, 8)}`, name: 'IT Estate', status: 'TRIAL', currency: 'NGN', trialEndsAt: trialEnd } });
  const sub = await db.subscription.create({ data: { tenantId: id, planId: plan.id, status: 'TRIAL', currency: 'NGN', trialEndsAt: trialEnd, currentPeriodStart: new Date(), currentPeriodEnd: trialEnd } });
  assert.equal(sub.billingMode, 'MANUAL_PREPAID');                       // pilot default
  try {
    await assert.rejects(PP.recordPayment(id, { amount: '100', currency: 'USD', periodFrom: '2026-12-01', periodTo: '2026-12-31' }, actor), /CURRENCY_MISMATCH|billed in NGN/);
    await assert.rejects(PP.recordPayment(id, { amount: '-5', periodFrom: '2026-12-01', periodTo: '2026-12-31' }, actor));
    await assert.rejects(PP.recordPayment(id, { amount: '100', periodFrom: '2026-12-31', periodTo: '2026-12-01' }, actor));
    await assert.rejects(PP.recordPayment(id, { amount: '100', periodFrom: '2026-02-30', periodTo: '2026-03-01' }, actor));

    const now = new Date('2026-12-02T10:00:00Z');
    const r1 = await PP.recordPayment(id, { amount: '90000', periodFrom: '2026-12-01', periodTo: '2027-02-28', method: 'BANK_TRANSFER', reference: 'TXN-1' }, actor, null, now);
    assert.equal(r1.paidThrough.toISOString().slice(0, 10), '2027-02-28');
    assert.deepEqual(r1.statusChange, { from: 'TRIAL', to: 'ACTIVE' });
    assert.equal((await db.tenant.findUnique({ where: { id } })).status, 'ACTIVE');
    assert.equal(r1.warnings.length, 0);

    const r2 = await PP.recordPayment(id, { amount: '30000', periodFrom: '2027-03-01', periodTo: '2027-03-31' }, actor, null, now);
    assert.equal(r2.paidThrough.toISOString().slice(0, 10), '2027-03-31');
    const dup = await PP.recordPayment(id, { amount: '1', periodFrom: '2027-03-15', periodTo: '2027-03-20' }, actor, null, now);
    assert.ok(dup.warnings.some((w) => /overlaps/.test(w)));

    // Voiding the latest payment moves paidThrough back (computed from the ledger, never stale)
    const v = await PP.voidPayment(id, r2.payment.id, 'Entered the wrong amount', actor, null, now);
    assert.equal(v.paidThrough.toISOString().slice(0, 10), '2027-02-28');
    await assert.rejects(PP.voidPayment(id, r2.payment.id, 'again', actor, null, now), /already voided/);
    await assert.rejects(PP.voidPayment(id, r1.payment.id, 'x', actor, null, now), /3-300/);       // reason must be meaningful

    // Access gate with the real row: inside paid period = full; 40 days past paidThrough = read-only
    const t = await db.tenant.findUnique({ where: { id }, include: { subscription: true } });
    const gateTenant = { status: t.status, trialEndsAt: t.trialEndsAt, billingMode: t.subscription.billingMode, paidThrough: t.subscription.paidThrough, prepaidGraceDays: t.subscription.prepaidGraceDays };
    assert.equal(evaluateAccess(gateTenant, new Date('2027-01-15T00:00:00Z'), 'POST', '/api/residents').allow, true);
    assert.equal(evaluateAccess(gateTenant, new Date('2027-04-10T00:00:00Z'), 'POST', '/api/residents').allow, false);
    assert.equal(evaluateAccess(gateTenant, new Date('2027-04-10T00:00:00Z'), 'GET', '/api/residents').allow, true);

    // The hourly engine must leave prepaid estates alone
    const B = require('../src/modules/platform/billing.service');
    const out = await B.runBillingCycle(new Date('2027-06-01T00:00:00Z'));
    assert.equal((await db.invoice.count({ where: { tenantId: id } })), 0);
    assert.equal((await db.tenant.findUnique({ where: { id } })).status, 'ACTIVE');
    assert.ok(out);
    const ledger = await db.prepaidPayment.findMany({ where: { tenantId: id } });
    assert.equal(ledger.length, 3);                                                          // nothing deleted; one voided
    assert.equal(ledger.filter((p) => p.status === 'VOIDED').length, 1);
  } finally {
    await db.auditLog.deleteMany({ where: { tenantId: id } }).catch(() => {});
    await db.subscriptionEvent.deleteMany({ where: { tenantId: id } }).catch(() => {});
    await db.prepaidPayment.deleteMany({ where: { tenantId: id } }).catch(() => {});
    await db.subscription.deleteMany({ where: { tenantId: id } }).catch(() => {});
    await db.tenant.delete({ where: { id } }).catch(() => {});
    await db.$disconnect();
  }
});
