-- 004_pilot_currencies.sql — pilot launch: 16 billing currencies (8 original + NGN, ZAR, TRY, BRL, UAH, AZN, IQD, + USD/EUR already present).
-- Idempotent and safe to re-run. Prices and FX are STARTING POINTS ONLY: confirm them before
-- the first invoice, then edit in the Super Owner portal. Never edit 003 (already applied).

INSERT INTO "Currency" (code, name, symbol, decimals, "defaultLocale", "isActive") VALUES
  ('NGN','Nigerian Naira','₦',2,'en-NG',true),
  ('ZAR','South African Rand','R',2,'en-ZA',true),
  ('TRY','Turkish Lira','₺',2,'tr-TR',true),
  ('BRL','Brazilian Real','R$',2,'pt-BR',true),
  ('UAH','Ukrainian Hryvnia','₴',2,'uk-UA',true),
  ('AZN','Azerbaijani Manat','₼',2,'az-AZ',true),
  ('IQD','Iraqi Dinar','د.ع',2,'ar-IQ',true)
ON CONFLICT (code) DO UPDATE SET "isActive" = true;

INSERT INTO "PlanPrice" (id, "planId", currency, "unitAmount")
SELECT gen_random_uuid()::text, p.id, v.cur, v.amt
FROM "Plan" p
JOIN (VALUES
  ('standard','NGN',3000.00),('standard','ZAR',36.00),('standard','TRY',80.00),('standard','BRL',11.00),
  ('standard','UAH',80.00),('standard','AZN',3.40),('standard','IQD',2600.00),
  ('enterprise','NGN',2250.00),('enterprise','ZAR',27.00),('enterprise','TRY',60.00),('enterprise','BRL',8.25),
  ('enterprise','UAH',60.00),('enterprise','AZN',2.55),('enterprise','IQD',1950.00)
) AS v(code, cur, amt) ON v.code = p.code
ON CONFLICT ("planId", currency) DO NOTHING;

-- indicative FX (USD base) for platform revenue reporting only; refresh from a real FX source.
INSERT INTO "ExchangeRate" (id, base, quote, rate, source)
SELECT gen_random_uuid()::text, 'USD', v.q, v.r, 'seed-004'
FROM (VALUES ('NGN',1500.0),('ZAR',18.0),('TRY',40.0),('BRL',5.5),('UAH',41.0),('AZN',1.7),('IQD',1310.0)) AS v(q, r)
WHERE NOT EXISTS (SELECT 1 FROM "ExchangeRate" e WHERE e.base = 'USD' AND e.quote = v.q);
