-- 004_pilot_currencies.sql — pilot launch: 12 billing currencies (8 original + NGN, ZAR, TRY, BRL).
-- Idempotent and safe to re-run. Prices and FX are STARTING POINTS ONLY: confirm them before
-- the first invoice, then edit in the Super Owner portal. Never edit 003 (already applied).

INSERT INTO "Currency" (code, name, symbol, decimals, "defaultLocale", "isActive") VALUES
  ('NGN','Nigerian Naira','₦',2,'en-NG',true),
  ('ZAR','South African Rand','R',2,'en-ZA',true),
  ('TRY','Turkish Lira','₺',2,'tr-TR',true),
  ('BRL','Brazilian Real','R$',2,'pt-BR',true)
ON CONFLICT (code) DO UPDATE SET "isActive" = true;

INSERT INTO "PlanPrice" (id, "planId", currency, "unitAmount")
SELECT gen_random_uuid()::text, p.id, v.cur, v.amt
FROM "Plan" p
JOIN (VALUES
  ('standard','NGN',3000.00),('standard','ZAR',36.00),('standard','TRY',80.00),('standard','BRL',11.00),
  ('enterprise','NGN',2250.00),('enterprise','ZAR',27.00),('enterprise','TRY',60.00),('enterprise','BRL',8.25)
) AS v(code, cur, amt) ON v.code = p.code
ON CONFLICT ("planId", currency) DO NOTHING;

-- indicative FX (USD base) for platform revenue reporting only; refresh from a real FX source.
INSERT INTO "ExchangeRate" (id, base, quote, rate, source)
SELECT gen_random_uuid()::text, 'USD', v.q, v.r, 'seed-004'
FROM (VALUES ('NGN',1500.0),('ZAR',18.0),('TRY',40.0),('BRL',5.5)) AS v(q, r)
WHERE NOT EXISTS (SELECT 1 FROM "ExchangeRate" e WHERE e.base = 'USD' AND e.quote = v.q);
