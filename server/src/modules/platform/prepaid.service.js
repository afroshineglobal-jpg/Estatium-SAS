'use strict';
/**
 * Manual prepaid payments (pilot). One entry point for recording a payment, so a future gateway webhook
 * calls the same function (provider/providerRef are already on the row). Entries are never edited or deleted:
 * a mistake is VOIDED (with a reason) and re-entered. paidThrough is always recomputed from the ledger.
 */
const crypto = require('crypto');
const prisma = require('../../config/prisma');
const { bad, notFound, conflict, str, oneOf, money } = require('../../utils/http');
const { audit } = require('../../utils/audit');
const { prepaidState, paidThroughFromLedger, DEFAULT_GRACE_DAYS } = require('../../billing/prepaid');
const { tenantPatchFor, subscriptionStatusFor } = require('../../lifecycle/lifecycle');
const { invalidateTenant } = require('../../middleware/auth.middleware');

const db = prisma.system;
const METHODS = ['BANK_TRANSFER', 'CASH', 'CARD', 'MOBILE_MONEY', 'OTHER'];
const DAY = 86400000;

const actorFields = (a) => ({ actorType: a?.type || 'SYSTEM', actorId: a?.id || null, actorEmail: a?.email || null });
const eventActor = (a) => { const { actorEmail, ...rest } = actorFields(a); return rest; };   // SubscriptionEvent has no actorEmail column

/** Strict YYYY-MM-DD -> UTC midnight Date (no time zones, no surprises). */
function day(v, name) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${name} must be a date like 2026-12-31`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad(`${name} is not a real date`);
  return d;
}

async function loadTenant(tenantId) {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, include: { subscription: true } });
  if (!t || !t.subscription) throw notFound('Estate');
  return t;
}

function view(t, now = new Date()) {
  const s = t.subscription;
  return {
    billingMode: s.billingMode, currency: s.currency, paidThrough: s.paidThrough, graceDays: s.prepaidGraceDays, trialEndsAt: s.trialEndsAt ?? t.trialEndsAt,
    ...prepaidState({ paidThrough: s.paidThrough, trialEndsAt: s.trialEndsAt ?? t.trialEndsAt, now, graceDays: s.prepaidGraceDays ?? DEFAULT_GRACE_DAYS }),
  };
}

async function getPrepaid(tenantId, now = new Date()) {
  const t = await loadTenant(tenantId);
  const payments = await db.prepaidPayment.findMany({ where: { tenantId }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }], take: 200 });
  return { ...view(t, now), payments };
}

async function recordPayment(tenantId, input, actor, req, now = new Date()) {
  const t = await loadTenant(tenantId);
  if (t.status === 'DELETED') throw conflict('This estate is deleted', 'TENANT_DELETED');
  if (t.subscription.billingMode !== 'MANUAL_PREPAID') throw conflict('This estate is not on manual prepaid billing', 'NOT_PREPAID');
  const amount = money(input.amount, { name: 'amount' });
  const currency = String(input.currency || t.subscription.currency).toUpperCase();
  if (currency !== t.subscription.currency) throw bad(`This estate is billed in ${t.subscription.currency}; a ${currency} payment cannot be recorded against it`, 'CURRENCY_MISMATCH');
  const periodFrom = day(input.periodFrom, 'periodFrom'); const periodTo = day(input.periodTo, 'periodTo');
  if (periodTo < periodFrom) throw bad('periodTo must be on or after periodFrom');
  if (periodTo.getTime() - periodFrom.getTime() > 3 * 366 * DAY) throw bad('A single payment cannot cover more than 3 years');
  if (periodTo.getTime() > now.getTime() + 5 * 366 * DAY) throw bad('periodTo is too far in the future');
  const method = oneOf(input.method || 'BANK_TRANSFER', METHODS, 'method');
  const reference = str(input.reference, { max: 120, name: 'reference' });
  const note = str(input.note, { max: 500, name: 'note' });
  const paidAt = input.paidAt ? new Date(input.paidAt) : now;
  if (Number.isNaN(paidAt.getTime())) throw bad('paidAt is not a valid date');
  const provider = str(input.provider, { max: 40, name: 'provider' }); const providerRef = str(input.providerRef, { max: 120, name: 'providerRef' });

  const overlapping = await db.prepaidPayment.count({ where: { tenantId, status: 'RECORDED', periodFrom: { lte: periodTo }, periodTo: { gte: periodFrom } } });
  const before = t.subscription.paidThrough;

  let result;
  try {
    result = await db.$transaction(async (tx) => {
      const payment = await tx.prepaidPayment.create({ data: { id: crypto.randomUUID(), tenantId, amount, currency, periodFrom, periodTo, method, reference, note, provider, providerRef, paidAt, recordedById: actor?.id || null } });
      const all = await tx.prepaidPayment.findMany({ where: { tenantId }, select: { status: true, periodTo: true } });
      const paidThrough = paidThroughFromLedger(all);
      await tx.subscription.update({ where: { tenantId }, data: { paidThrough } });
      let statusChange = null;
      if (['TRIAL', 'EXPIRED'].includes(t.status)) {          // paying activates; SUSPENDED stays a deliberate operator decision
        await tx.tenant.update({ where: { id: tenantId }, data: tenantPatchFor('ACTIVE', { now }) });
        await tx.subscription.update({ where: { tenantId }, data: { status: subscriptionStatusFor('ACTIVE') } });
        statusChange = { from: t.status, to: 'ACTIVE' };
      }
      await tx.subscriptionEvent.create({ data: { subscriptionId: t.subscription.id, tenantId, type: 'PREPAID_PAYMENT_RECORDED', data: { paymentId: payment.id, amount, currency, periodFrom: input.periodFrom, periodTo: input.periodTo, paidThroughBefore: before, paidThroughAfter: paidThrough, statusChange }, ...eventActor(actor) } });
      return { payment, paidThrough, statusChange };
    });
  } catch (e) {
    if (e.code === 'P2002') throw conflict('A payment with this provider reference was already recorded', 'DUPLICATE_PAYMENT');
    throw e;
  }
  invalidateTenant(tenantId);
  await audit({ req, tenantId, ...actorFields(actor), action: 'PREPAID_PAYMENT_RECORDED', entity: 'PrepaidPayment', entityId: result.payment.id, after: { amount, currency, periodFrom: input.periodFrom, periodTo: input.periodTo, paidThrough: result.paidThrough, method, reference } });
  const fresh = await loadTenant(tenantId);
  const warnings = [];
  if (overlapping > 0) warnings.push('This period overlaps an earlier payment. Check that it is not a duplicate; void it if it is.');
  if (t.status === 'SUSPENDED') warnings.push('The estate is still SUSPENDED (a manual decision). Activate it in the portal when ready.');
  return { payment: result.payment, ...view(fresh, now), statusChange: result.statusChange, warnings };
}

async function voidPayment(tenantId, paymentId, reason, actor, req, now = new Date()) {
  const why = str(reason, { max: 300, min: 3, name: 'reason', required: true });
  const t = await loadTenant(tenantId);
  const p = await db.prepaidPayment.findFirst({ where: { id: paymentId, tenantId } });
  if (!p) throw notFound('Payment');
  if (p.status === 'VOIDED') throw conflict('This payment is already voided', 'ALREADY_VOIDED');
  const before = t.subscription.paidThrough;
  const out = await db.$transaction(async (tx) => {
    await tx.prepaidPayment.update({ where: { id: paymentId }, data: { status: 'VOIDED', voidedAt: now, voidReason: why, voidedById: actor?.id || null } });
    const all = await tx.prepaidPayment.findMany({ where: { tenantId }, select: { status: true, periodTo: true } });
    const paidThrough = paidThroughFromLedger(all);
    await tx.subscription.update({ where: { tenantId }, data: { paidThrough } });
    await tx.subscriptionEvent.create({ data: { subscriptionId: t.subscription.id, tenantId, type: 'PREPAID_PAYMENT_VOIDED', data: { paymentId, reason: why, paidThroughBefore: before, paidThroughAfter: paidThrough }, ...eventActor(actor) } });
    return { paidThrough };
  });
  invalidateTenant(tenantId);
  await audit({ req, tenantId, ...actorFields(actor), action: 'PREPAID_PAYMENT_VOIDED', entity: 'PrepaidPayment', entityId: paymentId, before: { paidThrough: before }, after: { paidThrough: out.paidThrough, reason: why } });
  return view(await loadTenant(tenantId), now);
}

async function setGraceDays(tenantId, graceDays, actor, req) {
  const n = Number(graceDays);
  if (!Number.isInteger(n) || n < 0 || n > 365) throw bad('graceDays must be a whole number from 0 to 365');
  const t = await loadTenant(tenantId);
  await db.subscription.update({ where: { tenantId }, data: { prepaidGraceDays: n } });
  await db.subscriptionEvent.create({ data: { subscriptionId: t.subscription.id, tenantId, type: 'PREPAID_GRACE_CHANGED', data: { from: t.subscription.prepaidGraceDays, to: n }, ...eventActor(actor) } });
  invalidateTenant(tenantId);
  await audit({ req, tenantId, ...actorFields(actor), action: 'PREPAID_GRACE_CHANGED', entity: 'Subscription', entityId: t.subscription.id, before: { graceDays: t.subscription.prepaidGraceDays }, after: { graceDays: n } });
  return view(await loadTenant(tenantId));
}

module.exports = { getPrepaid, recordPayment, voidPayment, setGraceDays, view, METHODS };
