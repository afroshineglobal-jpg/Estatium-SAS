'use strict';
/**
 * Invoice pricing + estate billing configuration.
 *   config = { taxes: { MAINTENANCE:[{name,rate}], AMENITY:[...], REPAIR:[...], OTHER:[...] },
 *              monthly: { auto:boolean, amount:number, day:1-28, dueDays:1-60 },
 *              invoice: { footer, payTo } }
 * Taxes are added on top of the price (tax-exclusive): total = subtotal + sum(subtotal * rate%). Each tax line is rounded to 2 dp.
 */
const { Prisma } = require('@prisma/client');
const D = Prisma.Decimal;

const CATEGORIES = ['MAINTENANCE', 'AMENITY', 'REPAIR', 'OTHER'];
const CATEGORY_OF_TYPE = { MAINTENANCE: 'MAINTENANCE', AMENITY: 'AMENITY', UTILITY: 'OTHER', PENALTY: 'OTHER', ONE_TIME: 'OTHER' };
const DEFAULTS = () => ({ taxes: { MAINTENANCE: [], AMENITY: [], REPAIR: [], OTHER: [] }, monthly: { auto: false, amount: 0, day: 1, dueDays: 14 }, invoice: { footer: '', payTo: '' } });

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
function cleanTaxes(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error('taxes must be a list');
  if (list.length > 5) throw new Error('At most 5 taxes per category');
  return list.map((t) => {
    const name = clip(t?.name, 40); const rate = Number(t?.rate);
    if (!name) throw new Error('Every tax needs a name');
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error(`Tax "${name}" must be between 0 and 100 percent`);
    return { name, rate: Math.round(rate * 100) / 100 };
  }).filter((t) => t.rate > 0);
}

/** Validates an admin-submitted config (throws Error with a readable message) and returns the clean copy. */
function sanitize(input) {
  const d = DEFAULTS(); const b = input && typeof input === 'object' ? input : {};
  for (const c of CATEGORIES) d.taxes[c] = cleanTaxes(b.taxes?.[c]);
  const m = b.monthly || {};
  d.monthly.auto = m.auto === true;
  d.monthly.amount = m.amount === '' || m.amount == null ? 0 : Number(m.amount);
  if (!Number.isFinite(d.monthly.amount) || d.monthly.amount < 0 || d.monthly.amount > 1e9) throw new Error('Monthly maintenance amount is not valid');
  const num = (v, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt; };
  d.monthly.day = Math.min(28, Math.max(1, num(m.day, 1)));
  d.monthly.dueDays = Math.min(60, Math.max(1, num(m.dueDays, 14)));
  if (d.monthly.auto && !(d.monthly.amount > 0)) throw new Error('Set the monthly maintenance amount before turning on automatic billing');
  d.invoice.footer = clip(b.invoice?.footer, 300); d.invoice.payTo = clip(b.invoice?.payTo, 300);
  return d;
}

/** Reads the stored JSON (or an empty default) without ever throwing. */
function parse(raw) { try { return sanitize(JSON.parse(raw)); } catch { return DEFAULTS(); } }

/** Price one bill. Returns plain strings/numbers ready for Prisma. */
function price(config, category, base) {
  const sub = new D(base).toDecimalPlaces(2);
  const lines = (config?.taxes?.[category] || []).map((t) => ({ name: t.name, rate: t.rate, amount: sub.mul(t.rate).div(100).toDecimalPlaces(2).toString() }));
  const taxTotal = lines.reduce((s, l) => s.plus(l.amount), new D(0));
  return { subtotal: sub.toString(), taxTotal: taxTotal.toString(), taxLines: lines.length ? lines : undefined, amount: sub.plus(taxTotal).toString() };
}

async function loadConfig(prisma) {
  const row = await prisma.setting.findFirst({ where: { key: 'billing_config' } });
  const cfg = parse(row?.value);
  if (!row) { const legacy = await prisma.setting.findFirst({ where: { key: 'maintenance_charge' } }); if (legacy && Number(legacy.value) > 0) cfg.monthly.amount = Number(legacy.value); }
  return cfg;
}

module.exports = { CATEGORIES, CATEGORY_OF_TYPE, DEFAULTS, sanitize, parse, price, loadConfig };
