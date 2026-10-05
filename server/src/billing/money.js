'use strict';
/** Integer minor-unit money arithmetic (no floating point). All 8 supported currencies use 2 decimals. */
const DECIMALS = { USD: 2, EUR: 2, GBP: 2, AED: 2, SAR: 2, INR: 2, CAD: 2, AUD: 2, NGN: 2 };
const SUPPORTED = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'INR', 'CAD', 'AUD'];
const decimals = (cur) => { const d = DECIMALS[cur]; if (d === undefined) throw new Error(`Unsupported currency ${cur}`); return d; };

/** "12.345" -> 1235 (half-up). Accepts string | number | Decimal. */
function toMinor(amount, currency) {
  const d = decimals(currency);
  const s = String(amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount "${amount}"`);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const frac = (f + '0'.repeat(d)).slice(0, d);
  let n = BigInt(i + frac);
  if (f.length > d && f[d] >= '5') n += 1n;
  return Number(neg ? -n : n);
}

/** 1235 -> "12.35" */
function fromMinor(minor, currency) {
  const d = decimals(currency); const neg = minor < 0; const abs = Math.abs(minor); const p = 10 ** d;
  const whole = Math.trunc(abs / p); const frac = String(abs % p).padStart(d, '0');
  return `${neg ? '-' : ''}${whole}${d ? '.' + frac : ''}`;
}

/** round-half-up(minor * num / den) using BigInt (no overflow / float drift). num, den are non-negative integers. */
function mulDiv(minor, num, den) {
  if (den === 0) throw new Error('division by zero');
  const sign = minor < 0 ? -1n : 1n;
  const v = (BigInt(Math.abs(minor)) * BigInt(num) + BigInt(den) / 2n) / BigInt(den);
  return Number(sign * v);
}

/** Locale-aware display, e.g. format("1234.5","EUR","en-IE") -> "€1,234.50". */
function format(amount, currency, locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: decimals(currency), maximumFractionDigits: decimals(currency) }).format(Number(amount));
}

/** Convert minor units between currencies with a quote-per-base rate (e.g. USD->EUR 0.92). Reporting only; never used to bill. */
function convertMinor(minor, from, to, rate) {
  if (from === to) return minor;
  return Math.round((minor / 10 ** decimals(from)) * Number(rate) * 10 ** decimals(to));
}

module.exports = { DECIMALS, SUPPORTED, decimals, toMinor, fromMinor, mulDiv, format, convertMinor };
