// Currency is a property of the ESTATE (tenant), not of the code. AuthProvider calls setCurrency() after login.
const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', SAR: '﷼', INR: '₹', CAD: 'CA$', AUD: 'A$', NGN: '₦' };
const LOCALES = { USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB', AED: 'en-AE', SAR: 'en-SA', INR: 'en-IN', CAD: 'en-CA', AUD: 'en-AU', NGN: 'en-NG' };
let current = 'USD';

export const setCurrency = (code) => { if (code) current = code; };
export const getCurrency = () => current;
export const symbol = (code = current) => SYMBOLS[code] || code;

/** fmt(1234.5) -> "$1,234.50" / "₹1,234.50" / "€1,234.50" depending on the estate's currency. */
export function fmt(amount, code = current) {
  const n = Number(amount || 0);
  try { return new Intl.NumberFormat(LOCALES[code] || 'en-US', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }
  catch { return `${symbol(code)}${n.toFixed(2)}`; }
}
