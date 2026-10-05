'use strict';
/**
 * SaaS billing: invoicing, renewals, trials, dunning, proration, coupons, usage, revenue.
 * All pricing math is delegated to the pure, unit-tested billing/pricing.js (integer minor units).
 * Everything here runs on the UN-scoped client (platform tables) — it never touches tenant data directly.
 */
const prisma = require('../../config/prisma');
const { toMinor, fromMinor, convertMinor } = require('../../billing/money');
const P = require('../../billing/pricing');
const { setStatus } = require('./tenants.service');
const { audit } = require('../../utils/audit');
const { bad, notFound, conflict } = require('../../utils/http');

const db = prisma.system;
const DAY = 86400000;
const SUSPEND_GRACE_DEFAULT = 7;       // days after due date (overridable per subscription: graceDays)
const EXPIRE_AFTER_SUSPENDED_DAYS = 30;

const actorFields = (a) => ({ actorType: a?.type || 'SYSTEM', actorId: a?.id || null, actorEmail: a?.email || null });
const dec = (v) => (v === null || v === undefined ? null : v.toString());

const SUB_INCLUDE = { plan: { include: { prices: true } }, coupons: { include: { coupon: true } } };
async function loadSub(tenantId) {
  const sub = await db.subscription.findUnique({ where: { tenantId }, include: SUB_INCLUDE });
  if (!sub) throw notFound('Subscription'); return sub;
}

/** Plain-number view of a subscription for the pricing engine. */
function pricingView(sub, overrides = {}) {
  const s = { ...sub, ...overrides };
  const planPrice = s.plan.prices.find((p) => p.currency === s.currency) || null;
  const subscription = {
    currency: s.currency, billingInterval: s.billingInterval, committedUnits: s.committedUnits ?? null,
    customUnitAmount: dec(s.customUnitAmount), customOverageAmount: dec(s.customOverageAmount), customFlatAmount: dec(s.customFlatAmount),
  };
  const plan = { code: s.plan.code, name: s.plan.name, pricingModel: s.plan.pricingModel, minBillableUnits: s.plan.minBillableUnits };
  const rates = P.resolveRates({ subscription, planPrice: planPrice && { unitAmount: dec(planPrice.unitAmount), overageAmount: dec(planPrice.overageAmount), flatAmount: dec(planPrice.flatAmount) }, plan });
  return { subscription, plan, rates };
}

const activeCoupons = (sub) => sub.coupons
  .filter((r) => !r.endedAt && r.coupon.isActive && (r.coupon.duration === 'FOREVER' || (r.coupon.duration === 'ONCE' && r.monthsApplied < 1) || (r.coupon.duration === 'REPEATING' && r.monthsApplied < (r.coupon.durationMonths || 0))))
  .map((r) => ({ id: r.couponId, code: r.coupon.code, name: r.coupon.name, type: r.coupon.type, percentOff: dec(r.coupon.percentOff), amountOff: dec(r.coupon.amountOff), currency: r.coupon.currency }));

const unitCount = async (tenantId) => (await db.$queryRaw`SELECT platform_billable_units(${tenantId}) AS n`)[0].n;
async function peakUnits(tenantId, from, to) {
  const r = await db.$queryRaw`SELECT COALESCE(max(quantity), 0)::int AS n FROM "UsageRecord" WHERE "tenantId" = ${tenantId} AND metric = 'units' AND "recordedOn" >= ${from.toISOString().slice(0, 10)}::date AND "recordedOn" < ${to.toISOString().slice(0, 10)}::date`;
  return r[0].n;
}
async function billableUnits(sub, closingFrom, closingTo) {
  const now = await unitCount(sub.tenantId);
  if (sub.usageBasis === 'PEAK' && closingFrom && closingTo) return Math.max(now, await peakUnits(sub.tenantId, closingFrom, closingTo));
  return now;
}

async function nextInvoiceNumber(now) {
  const n = (await db.$queryRaw`SELECT nextval('invoice_number_seq')::int AS n`)[0].n;
  return `INV-${now.getUTCFullYear()}-${String(n).padStart(6, '0')}`;
}

/** Persist an invoice from computed lines (also used for proration invoices). */
async function persistInvoice({ sub, lines, subtotalMinor, discountMinor = 0, taxMinor = 0, totalMinor, periodStart, periodEnd, units, unitMinor, now, usedCoupons = [], creditUsedMinor = 0, notes = null }) {
  const cur = sub.currency;
  const status = totalMinor === 0 ? 'PAID' : 'OPEN';
  const number = await nextInvoiceNumber(now);
  const creditLeft = toMinor(dec(sub.creditBalance) ?? '0', cur) - creditUsedMinor;
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({ data: {
      number, tenantId: sub.tenantId, subscriptionId: sub.id, status, currency: cur, periodStart, periodEnd, units, unitAmount: fromMinor(unitMinor || 0, cur),
      subtotal: fromMinor(subtotalMinor, cur), discountTotal: fromMinor(discountMinor, cur), taxTotal: fromMinor(taxMinor, cur), total: fromMinor(totalMinor, cur),
      amountPaid: status === 'PAID' ? fromMinor(totalMinor, cur) : '0', issuedAt: now, dueDate: new Date(now.getTime() + sub.paymentTermsDays * DAY), paidAt: status === 'PAID' ? now : null, notes,
      lines: { create: lines.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitAmount: fromMinor(l.unitMinor, cur), amount: fromMinor(l.amountMinor, cur) })) },
    }, include: { lines: true } });
    await tx.subscription.update({ where: { id: sub.id }, data: { billedUnits: units, creditBalance: fromMinor(Math.max(creditLeft, 0), cur) } });
    for (const c of usedCoupons) {
      const redemption = await tx.subscriptionCoupon.update({ where: { subscriptionId_couponId: { subscriptionId: sub.id, couponId: c.id } }, data: { monthsApplied: { increment: 1 } }, include: { coupon: true } });
      const done = redemption.coupon.duration === 'ONCE' || (redemption.coupon.duration === 'REPEATING' && redemption.monthsApplied >= (redemption.coupon.durationMonths || 0));
      if (done) await tx.subscriptionCoupon.update({ where: { id: redemption.id }, data: { endedAt: now } });
    }
    await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, tenantId: sub.tenantId, type: 'INVOICE_ISSUED', data: { number, total: invoice.total.toString(), currency: cur, units }, actorType: 'SYSTEM' } });
    return invoice;
  });
}

/** Recurring invoice for [periodStart, periodEnd). */
async function generateInvoice(sub, { periodStart, periodEnd, now = new Date(), closing = null }) {
  const units = await billableUnits(sub, closing?.from, closing?.to);
  const view = pricingView(sub);
  const credit = toMinor(dec(sub.creditBalance) ?? '0', sub.currency);
  const coupons = activeCoupons(sub);
  const r = P.computeCharges({ plan: view.plan, subscription: view.subscription, rates: view.rates, actualUnits: units, coupons, creditMinor: credit });
  const usedCoupons = coupons.filter((c) => r.appliedCouponIds.includes(c.id));      // only coupons that actually reduced this invoice consume a month
  return persistInvoice({ sub, lines: r.lines, subtotalMinor: r.subtotalMinor, discountMinor: r.discountMinor, taxMinor: r.taxMinor, totalMinor: r.totalMinor, periodStart, periodEnd, units: r.billedUnits, unitMinor: view.rates.unitMinor, now, usedCoupons, creditUsedMinor: r.creditUsedMinor });
}

/** What the next invoice would be (tenant billing page + Super Owner preview). */
async function estimateNext(tenantId) {
  const sub = await loadSub(tenantId); const units = await unitCount(tenantId);
  const view = pricingView(sub);
  const r = P.computeCharges({ plan: view.plan, subscription: view.subscription, rates: view.rates, actualUnits: units, coupons: activeCoupons(sub), creditMinor: toMinor(dec(sub.creditBalance) ?? '0', sub.currency) });
  const cur = sub.currency;
  return { currency: cur, units, billedUnits: r.billedUnits, unitPrice: fromMinor(view.rates.unitMinor, cur), subtotal: fromMinor(r.subtotalMinor, cur), discount: fromMinor(r.discountMinor, cur), total: fromMinor(r.totalMinor, cur), lines: r.lines.map((l) => ({ ...l, unitAmount: fromMinor(l.unitMinor, cur), amount: fromMinor(l.amountMinor, cur) })), periodEnd: sub.currentPeriodEnd };
}

// ─── payments ────────────────────────────────────────────────────────────────
/** Record money received for an invoice (manual / bank transfer today; the gateway webhook will call this too). */
async function recordInvoicePayment(invoiceId, { amount, method = 'MANUAL', reference = null, provider = null, providerRef = null, actor, req }) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw notFound('Invoice');
  if (!['OPEN', 'DRAFT'].includes(inv.status)) throw conflict(`Invoice is ${inv.status}`, 'INVOICE_CLOSED');
  const cur = inv.currency;
  const amt = toMinor(amount, cur); if (amt <= 0) throw bad('amount must be greater than 0');
  const outstanding = toMinor(inv.total.toString(), cur) - toMinor(inv.amountPaid.toString(), cur);
  if (amt > outstanding) throw conflict(`Payment exceeds the outstanding balance (${fromMinor(outstanding, cur)} ${cur})`, 'OVERPAYMENT');

  const [, updated] = await db.$transaction([
    db.platformPayment.create({ data: { invoiceId, tenantId: inv.tenantId, amount: fromMinor(amt, cur), currency: cur, method, status: 'SUCCEEDED', provider, providerRef, reference, recordedById: actor?.id || null } }),
    db.invoice.update({ where: { id: invoiceId }, data: { amountPaid: { increment: fromMinor(amt, cur) } } }),
  ]);
  let result = updated;
  if (toMinor(updated.amountPaid.toString(), cur) >= toMinor(updated.total.toString(), cur)) result = await db.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date() } });
  await audit({ req, tenantId: inv.tenantId, ...actorFields(actor), action: 'INVOICE_PAYMENT_RECORDED', entity: 'Invoice', entityId: invoiceId, after: { amount: fromMinor(amt, cur), currency: cur, method, reference } });
  if (result.status === 'PAID') await reactivateIfSettled(inv.tenantId, actor, req);
  return result;
}

/** A tenant suspended for NON-PAYMENT comes back automatically once nothing overdue remains. */
async function reactivateIfSettled(tenantId, actor, req) {
  const t = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!t || t.status !== 'SUSPENDED' || t.suspendedReason !== 'NONPAYMENT') return false;
  const overdue = await db.invoice.count({ where: { tenantId, status: 'OPEN', dueDate: { lt: new Date() } } });
  if (overdue) return false;
  await setStatus(tenantId, 'ACTIVE', { reason: 'PAYMENT_RECEIVED', actor: actor || { type: 'SYSTEM' }, req });
  return true;
}

async function voidInvoice(invoiceId, { actor, req }) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw notFound('Invoice');
  if (inv.status !== 'OPEN' || inv.amountPaid.gt(0)) throw conflict('Only unpaid OPEN invoices can be voided', 'CANNOT_VOID');
  const out = await db.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID', voidedAt: new Date() } });
  await audit({ req, tenantId: inv.tenantId, ...actorFields(actor), action: 'INVOICE_VOIDED', entity: 'Invoice', entityId: invoiceId });
  return out;
}

// ─── plan / price / currency changes (with proration) ────────────────────────
async function applyMidPeriodChange(sub, oldView, newView, now, label, actor) {
  const units = await unitCount(sub.tenantId);
  const oldAmt = P.periodAmountMinor({ ...oldView, units }); const newAmt = P.periodAmountMinor({ ...newView, units });
  const pr = P.prorate({ periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, changeAt: now, oldAmountMinor: oldAmt, newAmountMinor: newAmt });
  const cur = sub.currency; let invoice = null;
  if (pr.netMinor > 0) {
    invoice = await persistInvoice({ sub, now, periodStart: now, periodEnd: sub.currentPeriodEnd, units, unitMinor: newView.rates.unitMinor, subtotalMinor: pr.netMinor, totalMinor: pr.netMinor, notes: `Proration: ${label}`,
      lines: [{ kind: 'PRORATION_CREDIT', description: `Unused time on previous price (${label})`, quantity: 1, unitMinor: -pr.creditMinor, amountMinor: -pr.creditMinor }, { kind: 'PRORATION_CHARGE', description: `Remaining period at new price (${label})`, quantity: 1, unitMinor: pr.chargeMinor, amountMinor: pr.chargeMinor }] });
    // persistInvoice subtracts "creditUsedMinor" (0 here) from the balance, so the balance is unchanged
  } else if (pr.netMinor < 0) {
    const bal = toMinor(dec(sub.creditBalance) ?? '0', cur) + -pr.netMinor;
    await db.subscription.update({ where: { id: sub.id }, data: { creditBalance: fromMinor(bal, cur) } });
  }
  return { proration: pr, invoice };
}

async function changePlan(tenantId, input, actor, req, now = new Date()) {
  const sub = await loadSub(tenantId);
  if (!['TRIAL', 'ACTIVE'].includes(sub.status)) throw conflict(`Cannot change plan while ${sub.status}`, 'BAD_STATE');
  const plan = await db.plan.findFirst({ where: { OR: [{ id: String(input.planId || '') }, { code: String(input.planCode || '') }], isActive: true }, include: { prices: true } });
  if (!plan) throw notFound('Plan');
  if (plan.id === sub.planId && input.committedUnits === undefined) throw bad('Tenant is already on that plan');
  const next = { ...sub, plan, planId: plan.id, customUnitAmount: input.customUnitAmount ?? null, customOverageAmount: input.customOverageAmount ?? null, customFlatAmount: input.customFlatAmount ?? null, committedUnits: input.committedUnits === undefined ? sub.committedUnits : input.committedUnits };
  const newView = pricingView(next);                      // throws a clear error if no price exists in the tenant's currency
  const oldView = pricingView(sub);
  let result = { proration: null, invoice: null };
  if (sub.status === 'ACTIVE') result = await applyMidPeriodChange(sub, oldView, newView, now, `${sub.plan.code} → ${plan.code}`, actor);
  await db.$transaction([
    db.subscription.update({ where: { id: sub.id }, data: { planId: plan.id, customUnitAmount: next.customUnitAmount, customOverageAmount: next.customOverageAmount, customFlatAmount: next.customFlatAmount, committedUnits: next.committedUnits } }),
    db.subscriptionEvent.create({ data: { subscriptionId: sub.id, tenantId, type: 'PLAN_CHANGED', data: { from: sub.plan.code, to: plan.code, netMinor: result.proration?.netMinor ?? 0 }, ...actorFields(actor) } }),
  ]);
  await audit({ req, tenantId, ...actorFields(actor), action: 'PLAN_CHANGED', entity: 'Subscription', entityId: sub.id, before: { plan: sub.plan.code }, after: { plan: plan.code, net: result.proration ? fromMinor(result.proration.netMinor, sub.currency) : '0' } });
  return { subscription: await loadSub(tenantId), ...result };
}

const PRICING_FIELDS = ['customUnitAmount', 'customOverageAmount', 'customFlatAmount', 'committedUnits', 'maxUnits', 'paymentTermsDays', 'graceDays', 'contractReference', 'contractStart', 'contractEnd', 'billingInterval', 'usageBasis', 'autoConvert'];
/** Contract / custom pricing. `null` clears an override. applyNow=true prorates the current period. */
async function setPricing(tenantId, input, actor, req, now = new Date()) {
  const sub = await loadSub(tenantId);
  const data = {};
  for (const k of PRICING_FIELDS) if (input[k] !== undefined) data[k] = input[k];
  for (const k of ['customUnitAmount', 'customOverageAmount', 'customFlatAmount']) if (data[k] !== undefined && data[k] !== null) { toMinor(data[k], sub.currency); if (Number(data[k]) < 0) throw bad(`${k} cannot be negative`); }
  if (data.billingInterval && !['MONTHLY', 'ANNUAL'].includes(data.billingInterval)) throw bad('billingInterval must be MONTHLY or ANNUAL');
  if (data.usageBasis && !['SNAPSHOT', 'PEAK'].includes(data.usageBasis)) throw bad('usageBasis must be SNAPSHOT or PEAK');
  for (const k of ['contractStart', 'contractEnd']) if (data[k]) data[k] = new Date(data[k]);
  if (!Object.keys(data).length) throw bad('Nothing to update');
  const next = { ...sub, ...data };
  const newView = pricingView(next);
  let result = { proration: null, invoice: null };
  if (input.applyNow && sub.status === 'ACTIVE') result = await applyMidPeriodChange(sub, pricingView(sub), newView, now, 'price change', actor);
  await db.$transaction([
    db.subscription.update({ where: { id: sub.id }, data }),
    db.subscriptionEvent.create({ data: { subscriptionId: sub.id, tenantId, type: 'PRICE_CHANGED', data: JSON.parse(JSON.stringify(data)), ...actorFields(actor) } }),
  ]);
  await audit({ req, tenantId, ...actorFields(actor), action: 'PRICING_CHANGED', entity: 'Subscription', entityId: sub.id, before: Object.fromEntries(Object.keys(data).map((k) => [k, sub[k]?.toString?.() ?? sub[k] ?? null])), after: JSON.parse(JSON.stringify(data)) });
  return { subscription: await loadSub(tenantId), ...result };
}

/** Switch the tenant's billing currency. Allowed only with no open invoices; past resident bills keep their own currency. */
async function changeCurrency(tenantId, code, actor, req) {
  const cur = String(code || '').toUpperCase();
  const [currency, sub, open] = await Promise.all([db.currency.findUnique({ where: { code: cur } }), loadSub(tenantId), db.invoice.count({ where: { tenantId, status: 'OPEN' } })]);
  if (!currency || !currency.isActive) throw bad('Unsupported or inactive currency');
  if (sub.currency === cur) throw bad('Tenant already uses that currency');
  if (open) throw conflict('Settle or void open invoices before changing currency', 'OPEN_INVOICES');
  pricingView({ ...sub, currency: cur, customUnitAmount: null, customOverageAmount: null, customFlatAmount: null });   // plan must have a price in the new currency
  await db.$transaction([
    db.tenant.update({ where: { id: tenantId }, data: { currency: cur } }),
    db.subscription.update({ where: { id: sub.id }, data: { currency: cur, customUnitAmount: null, customOverageAmount: null, customFlatAmount: null, creditBalance: '0' } }),
    db.subscriptionEvent.create({ data: { subscriptionId: sub.id, tenantId, type: 'CURRENCY_CHANGED', data: { from: sub.currency, to: cur, note: 'custom prices reset; credit balance cleared' }, ...actorFields(actor) } }),
  ]);
  require('../../middleware/auth.middleware').invalidateTenant(tenantId);
  await audit({ req, tenantId, ...actorFields(actor), action: 'CURRENCY_CHANGED', entity: 'Tenant', entityId: tenantId, before: { currency: sub.currency }, after: { currency: cur } });
  return loadSub(tenantId);
}

async function applyCoupon(tenantId, code, actor, req, now = new Date()) {
  const [sub, coupon] = await Promise.all([loadSub(tenantId), db.coupon.findUnique({ where: { code: String(code || '').trim().toUpperCase() } })]);
  if (!coupon || !coupon.isActive) throw notFound('Coupon');
  if (coupon.validFrom > now || (coupon.validUntil && coupon.validUntil < now)) throw conflict('Coupon is not valid right now', 'COUPON_EXPIRED');
  if (coupon.maxRedemptions !== null && coupon.timesRedeemed >= coupon.maxRedemptions) throw conflict('Coupon has been fully redeemed', 'COUPON_EXHAUSTED');
  if (coupon.type === 'FIXED_AMOUNT' && coupon.currency !== sub.currency) throw conflict(`Coupon is in ${coupon.currency}; tenant is billed in ${sub.currency}`, 'COUPON_CURRENCY');
  await db.$transaction([
    db.subscriptionCoupon.create({ data: { subscriptionId: sub.id, couponId: coupon.id } }),     // unique(subscriptionId, couponId) => one redemption per tenant
    db.coupon.update({ where: { id: coupon.id }, data: { timesRedeemed: { increment: 1 } } }),
  ]);
  await audit({ req, tenantId, ...actorFields(actor), action: 'COUPON_APPLIED', entity: 'Coupon', entityId: coupon.id, after: { code: coupon.code } });
  return loadSub(tenantId);
}

// ─── scheduled jobs ──────────────────────────────────────────────────────────
/** Trial ended: convert to a paid subscription (first invoice) or expire. */
async function convertTrial(tenantId, { actor = { type: 'SYSTEM' }, now = new Date(), req } = {}) {
  const sub = await loadSub(tenantId);
  const months = P.monthsIn(sub.billingInterval);
  const periodStart = now, periodEnd = P.addMonths(now, months);
  await setStatus(tenantId, 'ACTIVE', { reason: 'TRIAL_CONVERTED', actor, req, now });
  await db.subscription.update({ where: { id: sub.id }, data: { trialEndsAt: null, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd } });
  return generateInvoice(await loadSub(tenantId), { periodStart, periodEnd, now });
}

async function processTrials(now) {
  const due = await db.subscription.findMany({ where: { status: 'TRIAL', trialEndsAt: { lte: now } }, include: { plan: true } });
  let converted = 0, expired = 0;
  for (const s of due) {
    try {
      if (s.autoConvert) { await convertTrial(s.tenantId, { now }); converted++; }
      else { await setStatus(s.tenantId, 'EXPIRED', { reason: 'TRIAL_ENDED', actor: { type: 'SYSTEM' }, now }); expired++; }
    } catch (e) {
      console.error(`[billing] trial ${s.tenantId}:`, e.message);
      try { await setStatus(s.tenantId, 'EXPIRED', { reason: 'TRIAL_ENDED_NO_PRICE', actor: { type: 'SYSTEM' }, now }); expired++; } catch { /* already handled */ }
    }
  }
  return { converted, expired };
}

async function processRenewals(now) {
  const due = await db.subscription.findMany({ where: { status: 'ACTIVE', currentPeriodEnd: { lte: now } }, include: SUB_INCLUDE });
  let renewed = 0, ended = 0;
  for (const sub of due) {
    try {
      if (sub.cancelAtPeriodEnd) { await setStatus(sub.tenantId, 'EXPIRED', { reason: 'CANCELLED_AT_PERIOD_END', actor: { type: 'SYSTEM' }, now }); ended++; continue; }
      const periodStart = sub.currentPeriodEnd, periodEnd = P.addMonths(periodStart, P.monthsIn(sub.billingInterval));
      await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd } });   // advance first => a crash can never double-bill
      await generateInvoice({ ...sub, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd }, { periodStart, periodEnd, now, closing: { from: sub.currentPeriodStart, to: sub.currentPeriodEnd } });
      renewed++;
    } catch (e) { console.error(`[billing] renewal ${sub.tenantId}:`, e.message); }
  }
  return { renewed, ended };
}

/** Unpaid past due + grace -> SUSPENDED (read-only); suspended too long -> EXPIRED. */
async function processDunning(now) {
  let suspended = 0, expired = 0;
  const overdue = await db.invoice.findMany({ where: { status: 'OPEN', dueDate: { lt: now } }, include: { tenant: { select: { id: true, status: true } }, subscription: { select: { graceDays: true } } } });
  const seen = new Set();
  for (const inv of overdue) {
    if (seen.has(inv.tenantId) || inv.tenant.status !== 'ACTIVE') continue;
    const grace = inv.subscription?.graceDays ?? SUSPEND_GRACE_DEFAULT;
    if (now.getTime() > inv.dueDate.getTime() + grace * DAY) {
      seen.add(inv.tenantId);
      try { await setStatus(inv.tenantId, 'SUSPENDED', { reason: 'NONPAYMENT', actor: { type: 'SYSTEM' }, now }); suspended++; } catch (e) { console.error('[billing] suspend:', e.message); }
    }
  }
  const long = await db.tenant.findMany({ where: { status: 'SUSPENDED', suspendedReason: 'NONPAYMENT', suspendedAt: { lt: new Date(now.getTime() - EXPIRE_AFTER_SUSPENDED_DAYS * DAY) } } });
  for (const t of long) { try { await setStatus(t.id, 'EXPIRED', { reason: 'NONPAYMENT_TIMEOUT', actor: { type: 'SYSTEM' }, now }); expired++; } catch (e) { console.error('[billing] expire:', e.message); } }
  return { suspended, expired };
}

async function snapshotUsage(now) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const stats = await db.$queryRaw`SELECT * FROM platform_tenant_stats()`;
  for (const s of stats) {
    await db.usageRecord.upsert({ where: { tenantId_metric_recordedOn: { tenantId: s.tenantId, metric: 'units', recordedOn: day } }, create: { tenantId: s.tenantId, metric: 'units', quantity: s.units, recordedOn: day }, update: { quantity: s.units } });
  }
  return stats.length;
}

async function purgeDeleted(now) {
  const due = await db.tenant.findMany({ where: { status: 'DELETED', purgedAt: null, purgeAfter: { lte: now } }, select: { id: true, slug: true } });
  for (const t of due) { await db.$queryRaw`SELECT platform_purge_tenant(${t.id}, false)`; await audit({ tenantId: t.id, actorType: 'SYSTEM', action: 'TENANT_PURGED', entity: 'Tenant', entityId: t.id, after: { slug: t.slug } }); }
  return due.length;
}

async function runBillingCycle(now = new Date()) {
  const out = {};
  out.usage = await snapshotUsage(now);                    // first, so PEAK billing sees today
  out.trials = await processTrials(now);
  out.renewals = await processRenewals(now);
  out.dunning = await processDunning(now);
  out.purged = await purgeDeleted(now);
  return out;
}

// ─── reporting ───────────────────────────────────────────────────────────────
async function latestRates(base = 'USD') {
  const rows = await db.$queryRaw`SELECT DISTINCT ON (quote) quote, rate::text AS rate FROM "ExchangeRate" WHERE base = ${base} ORDER BY quote, "asOf" DESC`;
  return Object.fromEntries(rows.map((r) => [r.quote, Number(r.rate)]));
}

async function revenueSummary(reportCurrency = 'USD', now = new Date()) {
  const rates = await latestRates('USD');
  const toReport = (minor, from) => { if (from === reportCurrency) return minor; const usd = from === 'USD' ? minor : Math.round(minor / (rates[from] || NaN)); return reportCurrency === 'USD' ? usd : convertMinor(usd, 'USD', reportCurrency, rates[reportCurrency] || NaN); };
  const subs = await db.subscription.findMany({ where: { status: { in: ['ACTIVE', 'SUSPENDED'] } }, include: SUB_INCLUDE });
  const stats = new Map((await db.$queryRaw`SELECT * FROM platform_tenant_stats()`).map((s) => [s.tenantId, s]));
  const mrrByCur = {}; let mrrReport = 0; let unitsTotal = 0;
  for (const s of subs) {
    try {
      const units = stats.get(s.tenantId)?.units ?? 0; const view = pricingView(s);
      const m = P.monthlyMinor({ ...view, units }); mrrByCur[s.currency] = (mrrByCur[s.currency] || 0) + m; mrrReport += toReport(m, s.currency); unitsTotal += units;
    } catch { /* subscription without a price: excluded from MRR */ }
  }
  const [byStatus, collected, outstanding, trialsEnding] = await Promise.all([
    db.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
    db.$queryRaw`SELECT to_char(date_trunc('month', "paidAt"), 'YYYY-MM') AS month, currency, sum(amount)::text AS amount FROM "PlatformPayment" WHERE status = 'SUCCEEDED' AND "paidAt" > now() - interval '12 months' GROUP BY 1, 2 ORDER BY 1 DESC, 2`,
    db.$queryRaw`SELECT currency, sum(total - "amountPaid")::text AS amount, count(*)::int AS invoices FROM "Invoice" WHERE status = 'OPEN' GROUP BY 1`,
    db.subscription.count({ where: { status: 'TRIAL', trialEndsAt: { lte: new Date(now.getTime() + 7 * DAY) } } }),
  ]);
  return {
    reportCurrency, ratesNote: 'Converted with the latest platform exchange rates — indicative, for reporting only',
    mrr: { byCurrency: Object.fromEntries(Object.entries(mrrByCur).map(([c, v]) => [c, fromMinor(v, c)])), total: fromMinor(mrrReport, reportCurrency), arr: fromMinor(mrrReport * 12, reportCurrency) },
    billableUnits: unitsTotal, tenantsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])), trialsEndingIn7Days: trialsEnding,
    collectedLast12Months: collected, outstanding,
  };
}

async function usageHistory(tenantId, days = 90) {
  const from = new Date(Date.now() - Math.min(Math.max(Number(days) || 90, 1), 400) * DAY);
  return db.usageRecord.findMany({ where: { tenantId, metric: 'units', recordedOn: { gte: from } }, orderBy: { recordedOn: 'asc' }, select: { recordedOn: true, quantity: true } });
}

module.exports = { loadSub, pricingView, generateInvoice, estimateNext, recordInvoicePayment, voidInvoice, changePlan, setPricing, changeCurrency, applyCoupon, convertTrial, runBillingCycle, processTrials, processRenewals, processDunning, snapshotUsage, purgeDeleted, revenueSummary, usageHistory, reactivateIfSettled, unitCount };
