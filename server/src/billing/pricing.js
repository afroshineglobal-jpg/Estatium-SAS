'use strict';
/**
 * Subscription pricing engine — pure functions, integer minor units, unit-tested.
 *
 *   monthly charge = billable units x unit price           (e.g. 100 units x $2 = $200)
 *   billable units = max(plan minimum, committed units ?? actual units)  [+ overage on units above commitment]
 *   price          = subscription custom/contract price  >  plan price in the subscription's currency
 */
const { toMinor, mulDiv } = require('./money');

const monthsIn = (interval) => (interval === 'ANNUAL' ? 12 : 1);

function addMonths(date, n) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target;
}

/** Resolve effective rates (strings/Decimals) -> minor units. Subscription overrides beat plan prices. */
function resolveRates({ subscription, planPrice, plan }) {
  const cur = subscription.currency;
  const pick = (...vals) => vals.find((v) => v !== null && v !== undefined);
  const unit = pick(subscription.customUnitAmount, planPrice?.unitAmount);
  const flat = pick(subscription.customFlatAmount, planPrice?.flatAmount);
  const overage = pick(subscription.customOverageAmount, planPrice?.overageAmount, unit);
  const model = plan.pricingModel;
  if (model === 'PER_UNIT' && unit === undefined) throw new Error(`No ${cur} unit price for plan ${plan.code}: add a plan price or a custom price`);
  if (model === 'FLAT' && flat === undefined) throw new Error(`No ${cur} flat price for plan ${plan.code}`);
  return {
    unitMinor: unit === undefined ? 0 : toMinor(unit, cur),
    overageMinor: overage === undefined ? 0 : toMinor(overage, cur),
    flatMinor: flat === undefined ? 0 : toMinor(flat, cur),
  };
}

/**
 * Build the invoice lines for one billing period.
 * @returns {{lines, subtotalMinor, discountMinor, taxMinor, totalMinor, billedUnits, unitMinor}}
 */
function computeCharges({ plan, subscription, rates, actualUnits, coupons = [], taxPercent = 0, creditMinor = 0 }) {
  const cur = subscription.currency;
  const months = monthsIn(subscription.billingInterval);
  const lines = [];
  let billedUnits = 0;

  if (plan.pricingModel === 'FLAT') {
    lines.push({ kind: 'SUBSCRIPTION', description: `${plan.name} — flat fee (${months} mo)`, quantity: 1, unitMinor: rates.flatMinor * months, amountMinor: rates.flatMinor * months });
    billedUnits = actualUnits;
  } else {
    const min = plan.minBillableUnits || 0;
    const committed = subscription.committedUnits ?? null;
    const base = Math.max(min, committed ?? actualUnits);
    billedUnits = Math.max(base, actualUnits);
    lines.push({ kind: 'SUBSCRIPTION', description: `${plan.name} — ${base} unit${base === 1 ? '' : 's'} × ${months} mo`, quantity: base, unitMinor: rates.unitMinor * months, amountMinor: base * rates.unitMinor * months });
    if (committed !== null && actualUnits > base) {
      const over = actualUnits - base;
      lines.push({ kind: 'OVERAGE', description: `Overage — ${over} unit${over === 1 ? '' : 's'} above commitment × ${months} mo`, quantity: over, unitMinor: rates.overageMinor * months, amountMinor: over * rates.overageMinor * months });
    }
  }

  const subtotalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
  let running = subtotalMinor;
  let discountMinor = 0;
  const appliedCouponIds = [];

  // discounts: percentage coupons first (on the subtotal), then fixed amounts, never below zero
  const ordered = [...coupons].sort((a, b) => (a.type === 'PERCENT' ? -1 : 1) - (b.type === 'PERCENT' ? -1 : 1));
  for (const c of ordered) {
    let off = 0;
    if (c.type === 'PERCENT') {
      const hundredths = toMinor(c.percentOff, 'USD');                    // "12.50" -> 1250  (percent x 100)
      off = mulDiv(subtotalMinor, hundredths, 10000);
    } else {
      if (c.currency !== cur) continue;                                  // a fixed coupon only applies in its own currency
      off = toMinor(c.amountOff, cur);
    }
    off = Math.min(off, running);
    if (off <= 0) continue;
    running -= off; discountMinor += off; if (c.id) appliedCouponIds.push(c.id);
    lines.push({ kind: 'DISCOUNT', description: `Discount ${c.code || c.name || ''}`.trim(), quantity: 1, unitMinor: -off, amountMinor: -off });
  }

  if (creditMinor > 0 && running > 0) {
    const used = Math.min(creditMinor, running);
    running -= used;
    lines.push({ kind: 'ADJUSTMENT', description: 'Credit applied from previous plan change', quantity: 1, unitMinor: -used, amountMinor: -used });
  }

  const taxMinor = taxPercent > 0 ? mulDiv(running, Math.round(taxPercent * 100), 10000) : 0;
  if (taxMinor) lines.push({ kind: 'TAX', description: `Tax ${taxPercent}%`, quantity: 1, unitMinor: taxMinor, amountMinor: taxMinor });

  const creditUsed = lines.filter((l) => l.kind === 'ADJUSTMENT').reduce((s, l) => s - l.amountMinor, 0);
  return { lines, subtotalMinor, discountMinor, taxMinor, totalMinor: running + taxMinor, billedUnits, creditUsedMinor: creditUsed, appliedCouponIds };
}

/** Full-period amount (before discounts) — used for proration and MRR. */
function periodAmountMinor({ plan, subscription, rates, units }) {
  const months = monthsIn(subscription.billingInterval);
  if (plan.pricingModel === 'FLAT') return rates.flatMinor * months;
  const committed = subscription.committedUnits ?? null;
  const base = Math.max(plan.minBillableUnits || 0, committed ?? units);
  const over = committed !== null ? Math.max(0, units - base) : 0;
  return (base * rates.unitMinor + over * rates.overageMinor) * months;
}

/** Normalised monthly recurring revenue (for dashboards). */
const monthlyMinor = (args) => mulDiv(periodAmountMinor(args), 1, monthsIn(args.subscription.billingInterval));

/**
 * Mid-period change (plan / price / units): credit the unused part of the old price, charge the unused part of the new.
 * net > 0 -> invoice it now; net < 0 -> add to Subscription.creditBalance.
 */
function prorate({ periodStart, periodEnd, changeAt, oldAmountMinor, newAmountMinor }) {
  const total = periodEnd.getTime() - periodStart.getTime();
  if (total <= 0) throw new Error('Invalid billing period');
  const remaining = Math.min(Math.max(periodEnd.getTime() - changeAt.getTime(), 0), total);
  const creditMinor = mulDiv(oldAmountMinor, remaining, total);
  const chargeMinor = mulDiv(newAmountMinor, remaining, total);
  return { creditMinor, chargeMinor, netMinor: chargeMinor - creditMinor, remainingRatio: remaining / total };
}

module.exports = { monthsIn, addMonths, resolveRates, computeCharges, periodAmountMinor, monthlyMinor, prorate };
