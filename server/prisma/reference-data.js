'use strict';
// Reference data shared by seed.js (Prisma flows). sql/003_seed_reference.sql holds the same data for psql flows.
module.exports.CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', defaultLocale: 'en-US' }, { code: 'EUR', name: 'Euro', symbol: '€', defaultLocale: 'en-IE' },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', defaultLocale: 'en-GB' }, { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', defaultLocale: 'en-AE' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', defaultLocale: 'en-SA' }, { code: 'INR', name: 'Indian Rupee', symbol: '₹', defaultLocale: 'en-IN' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', defaultLocale: 'en-CA' }, { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', defaultLocale: 'en-AU' },
  // not one of the 8 supported currencies: inactive, exists only so legacy ₦ data can be migrated faithfully
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', defaultLocale: 'en-NG', isActive: false },
];
module.exports.PLANS = [
  { code: 'standard', name: 'Standard', description: 'Per-unit, per-month pricing for estates of any size', minBillableUnits: 0, trialDays: 14, prices: { USD: '2.00', EUR: '1.85', GBP: '1.60', AED: '7.35', SAR: '7.50', INR: '165.00', CAD: '2.70', AUD: '3.00' } },
  { code: 'enterprise', name: 'Enterprise', description: 'Volume pricing, 500-unit minimum', minBillableUnits: 500, trialDays: 30, prices: { USD: '1.50', EUR: '1.40', GBP: '1.20', AED: '5.50', SAR: '5.60', INR: '125.00', CAD: '2.00', AUD: '2.25' } },
];
module.exports.FX_USD = { USD: 1, EUR: 0.92, GBP: 0.79, AED: 3.6725, SAR: 3.75, INR: 83.0, CAD: 1.36, AUD: 1.52 };
