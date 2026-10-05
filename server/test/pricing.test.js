'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toMinor, fromMinor, mulDiv, format, convertMinor, SUPPORTED } = require('../src/billing/money');
const { addMonths, resolveRates, computeCharges, periodAmountMinor, monthlyMinor, prorate } = require('../src/billing/pricing');

const std = { code: 'standard', name: 'Standard', pricingModel: 'PER_UNIT', minBillableUnits: 0 };
const sub = (o = {}) => ({ currency: 'USD', billingInterval: 'MONTHLY', committedUnits: null, customUnitAmount: null, customOverageAmount: null, customFlatAmount: null, ...o });
const price = { unitAmount: '2.00', overageAmount: null, flatAmount: null };

test('money: minor-unit conversions are exact and half-up', () => {
  assert.equal(toMinor('2', 'USD'), 200);
  assert.equal(toMinor('1.005', 'USD'), 101);
  assert.equal(toMinor('0.1', 'USD') + toMinor('0.2', 'USD'), 30);           // no 0.30000000000000004
  assert.equal(fromMinor(20000, 'USD'), '200.00');
  assert.equal(fromMinor(-5, 'USD'), '-0.05');
  assert.equal(mulDiv(100, 1, 3), 33); assert.equal(mulDiv(100, 2, 3), 67);
  assert.throws(() => toMinor('abc', 'USD')); assert.throws(() => toMinor('1', 'JPY'));
  assert.equal(SUPPORTED.length, 8);
});

test('money: formatting per currency/locale', () => {
  assert.equal(format('1234.5', 'USD', 'en-US'), '$1,234.50');
  assert.match(format('1234.5', 'EUR', 'en-IE'), /€1,234\.50/);
  assert.match(format('1234.5', 'INR', 'en-IN'), /₹1,234\.50/);
  assert.equal(convertMinor(10000, 'USD', 'EUR', 0.92), 9200);
});

test('PRICING: 100 units x $2 = $200 / month (the brief\'s example)', () => {
  const s = sub(); const rates = resolveRates({ subscription: s, planPrice: price, plan: std });
  const r = computeCharges({ plan: std, subscription: s, rates, actualUnits: 100 });
  assert.equal(r.totalMinor, 20000); assert.equal(r.billedUnits, 100); assert.equal(r.lines.length, 1);
});

test('pricing: custom/contract price overrides plan price', () => {
  const s = sub({ customUnitAmount: '1.50' }); const rates = resolveRates({ subscription: s, planPrice: price, plan: std });
  assert.equal(computeCharges({ plan: std, subscription: s, rates, actualUnits: 100 }).totalMinor, 15000);
});

test('pricing: plan minimum billable units', () => {
  const ent = { ...std, code: 'enterprise', name: 'Enterprise', minBillableUnits: 500 };
  const s = sub(); const rates = resolveRates({ subscription: s, planPrice: { unitAmount: '1.50' }, plan: ent });
  assert.equal(computeCharges({ plan: ent, subscription: s, rates, actualUnits: 120 }).totalMinor, 500 * 150);
  assert.equal(computeCharges({ plan: ent, subscription: s, rates, actualUnits: 800 }).totalMinor, 800 * 150);
});

test('pricing: committed units + overage at the overage rate', () => {
  const s = sub({ committedUnits: 100, customOverageAmount: '2.50' }); const rates = resolveRates({ subscription: s, planPrice: price, plan: std });
  const r = computeCharges({ plan: std, subscription: s, rates, actualUnits: 112 });
  assert.equal(r.lines.find((l) => l.kind === 'SUBSCRIPTION').amountMinor, 20000);
  assert.equal(r.lines.find((l) => l.kind === 'OVERAGE').amountMinor, 12 * 250);
  assert.equal(r.totalMinor, 20000 + 3000);
  // below commitment you still pay the commitment
  assert.equal(computeCharges({ plan: std, subscription: s, rates, actualUnits: 80 }).totalMinor, 20000);
});

test('pricing: overage defaults to the unit price when none is set', () => {
  const s = sub({ committedUnits: 10 }); const rates = resolveRates({ subscription: s, planPrice: price, plan: std });
  assert.equal(computeCharges({ plan: std, subscription: s, rates, actualUnits: 15 }).totalMinor, 15 * 200);
});

test('pricing: annual billing = 12 months', () => {
  const s = sub({ billingInterval: 'ANNUAL' }); const rates = resolveRates({ subscription: s, planPrice: price, plan: std });
  assert.equal(computeCharges({ plan: std, subscription: s, rates, actualUnits: 100 }).totalMinor, 100 * 200 * 12);
  assert.equal(monthlyMinor({ plan: std, subscription: s, rates, units: 100 }), 20000);
});

test('pricing: flat contract plan', () => {
  const flat = { ...std, pricingModel: 'FLAT' }; const s = sub({ customFlatAmount: '999.00' });
  const rates = resolveRates({ subscription: s, planPrice: null, plan: flat });
  assert.equal(computeCharges({ plan: flat, subscription: s, rates, actualUnits: 5000 }).totalMinor, 99900);
});

test('pricing: missing price for the currency is an error, not a silent zero', () => {
  assert.throws(() => resolveRates({ subscription: sub({ currency: 'AUD' }), planPrice: null, plan: std }), /No AUD unit price/);
});

test('discounts: percent first, then fixed; never below zero; fixed only in its own currency', () => {
  const s = sub(); const rates = resolveRates({ subscription: s, planPrice: price, plan: std });
  const pct = { id: 'c1', type: 'PERCENT', percentOff: '10.00', code: 'LAUNCH10' };
  const fix = { id: 'c2', type: 'FIXED_AMOUNT', amountOff: '15.00', currency: 'USD', code: 'OFF15' };
  const r = computeCharges({ plan: std, subscription: s, rates, actualUnits: 100, coupons: [fix, pct] });
  assert.equal(r.discountMinor, 2000 + 1500); assert.equal(r.totalMinor, 20000 - 3500);
  assert.deepEqual(r.appliedCouponIds, ['c1', 'c2']);
  const eur = { type: 'FIXED_AMOUNT', amountOff: '15.00', currency: 'EUR' };
  assert.equal(computeCharges({ plan: std, subscription: s, rates, actualUnits: 100, coupons: [eur] }).totalMinor, 20000);
  const huge = { type: 'FIXED_AMOUNT', amountOff: '99999.00', currency: 'USD' };
  assert.equal(computeCharges({ plan: std, subscription: s, rates, actualUnits: 100, coupons: [huge] }).totalMinor, 0);
  assert.equal(computeCharges({ plan: std, subscription: s, rates, actualUnits: 100, coupons: [{ type: 'PERCENT', percentOff: '100' }] }).totalMinor, 0);
});

test('credit balance is applied but never makes an invoice negative', () => {
  const s = sub(); const rates = resolveRates({ subscription: s, planPrice: price, plan: std });
  const r = computeCharges({ plan: std, subscription: s, rates, actualUnits: 100, creditMinor: 5000 });
  assert.equal(r.totalMinor, 15000); assert.equal(r.creditUsedMinor, 5000);
  const r2 = computeCharges({ plan: std, subscription: s, rates, actualUnits: 100, creditMinor: 90000 });
  assert.equal(r2.totalMinor, 0); assert.equal(r2.creditUsedMinor, 20000);
});

test('tax is calculated on the discounted amount', () => {
  const s = sub(); const rates = resolveRates({ subscription: s, planPrice: price, plan: std });
  const r = computeCharges({ plan: std, subscription: s, rates, actualUnits: 100, taxPercent: 7.5 });
  assert.equal(r.taxMinor, 1500); assert.equal(r.totalMinor, 21500);
});

test('proration: upgrade halfway through the period', () => {
  const ps = new Date('2026-10-01T00:00:00Z'), pe = new Date('2026-11-01T00:00:00Z'), at = new Date('2026-10-16T12:00:00Z');
  const p = prorate({ periodStart: ps, periodEnd: pe, changeAt: at, oldAmountMinor: 20000, newAmountMinor: 30000 });
  assert.equal(p.creditMinor, 10000); assert.equal(p.chargeMinor, 15000); assert.equal(p.netMinor, 5000);
});

test('proration: downgrade yields a credit; change on day 1 = full difference; after period end = nothing', () => {
  const ps = new Date('2026-10-01T00:00:00Z'), pe = new Date('2026-11-01T00:00:00Z');
  assert.equal(prorate({ periodStart: ps, periodEnd: pe, changeAt: new Date('2026-10-16T12:00:00Z'), oldAmountMinor: 30000, newAmountMinor: 20000 }).netMinor, -5000);
  assert.equal(prorate({ periodStart: ps, periodEnd: pe, changeAt: ps, oldAmountMinor: 20000, newAmountMinor: 30000 }).netMinor, 10000);
  assert.equal(prorate({ periodStart: ps, periodEnd: pe, changeAt: new Date('2026-12-01T00:00:00Z'), oldAmountMinor: 20000, newAmountMinor: 30000 }).netMinor, 0);
});

test('periods: addMonths keeps UTC and clamps month-end', () => {
  assert.equal(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString(), '2028-02-29T00:00:00.000Z');
  assert.equal(addMonths(new Date('2026-10-04T10:00:00Z'), 12).toISOString(), '2027-10-04T10:00:00.000Z');
  assert.equal(periodAmountMinor({ plan: std, subscription: sub({ committedUnits: 100 }), rates: { unitMinor: 200, overageMinor: 300, flatMinor: 0 }, units: 110 }), 100 * 200 + 10 * 300);
});
