-- 003_seed_reference.sql — reference data: currencies and the default plan catalogue.
-- Idempotent. Prices are starting points — edit them in the Super Owner portal.

INSERT INTO "Currency" (code, name, symbol, decimals, "defaultLocale", "isActive") VALUES
  ('USD','US Dollar','$',2,'en-US',true),
  ('EUR','Euro','€',2,'en-IE',true),
  ('GBP','Pound Sterling','£',2,'en-GB',true),
  ('AED','UAE Dirham','د.إ',2,'en-AE',true),
  ('SAR','Saudi Riyal','﷼',2,'en-SA',true),
  ('INR','Indian Rupee','₹',2,'en-IN',true),
  ('CAD','Canadian Dollar','CA$',2,'en-CA',true),
  ('AUD','Australian Dollar','A$',2,'en-AU',true),
  -- NGN is NOT one of the 8 supported currencies. It exists, inactive, only so the legacy GreenVille
  -- data (which is denominated in ₦) can be migrated without silently re-labelling its amounts.
  -- It is hidden from the Super Owner currency picker. Activate it, or convert the tenant, as you decide.
  ('NGN','Nigerian Naira','₦',2,'en-NG',false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "Plan" (id, code, name, description, "pricingModel", "billingInterval", "minBillableUnits", "trialDays", "updatedAt") VALUES
  (gen_random_uuid()::text, 'standard',   'Standard',   'Per-unit, per-month pricing for estates of any size', 'PER_UNIT', 'MONTHLY', 0,   14, now()),
  (gen_random_uuid()::text, 'enterprise', 'Enterprise', 'Volume pricing, 500-unit minimum',                    'PER_UNIT', 'MONTHLY', 500, 30, now())
ON CONFLICT (code) DO NOTHING;

-- unit price per unit per month; overage defaults to the unit price when NULL
INSERT INTO "PlanPrice" (id, "planId", currency, "unitAmount")
SELECT gen_random_uuid()::text, p.id, v.cur, v.amt
FROM "Plan" p
JOIN (VALUES
  ('standard','USD',2.00),('standard','EUR',1.85),('standard','GBP',1.60),('standard','AED',7.35),
  ('standard','SAR',7.50),('standard','INR',165.00),('standard','CAD',2.70),('standard','AUD',3.00),
  ('enterprise','USD',1.50),('enterprise','EUR',1.40),('enterprise','GBP',1.20),('enterprise','AED',5.50),
  ('enterprise','SAR',5.60),('enterprise','INR',125.00),('enterprise','CAD',2.00),('enterprise','AUD',2.25)
) AS v(code, cur, amt) ON v.code = p.code
ON CONFLICT ("planId", currency) DO NOTHING;

-- indicative FX (USD base) for platform revenue reporting only; refresh from your FX source.
INSERT INTO "ExchangeRate" (id, base, quote, rate, source) VALUES
  (gen_random_uuid()::text,'USD','USD',1,'seed'),(gen_random_uuid()::text,'USD','EUR',0.92,'seed'),
  (gen_random_uuid()::text,'USD','GBP',0.79,'seed'),(gen_random_uuid()::text,'USD','AED',3.6725,'seed'),
  (gen_random_uuid()::text,'USD','SAR',3.75,'seed'),(gen_random_uuid()::text,'USD','INR',83.0,'seed'),
  (gen_random_uuid()::text,'USD','CAD',1.36,'seed'),(gen_random_uuid()::text,'USD','AUD',1.52,'seed')
ON CONFLICT DO NOTHING;
