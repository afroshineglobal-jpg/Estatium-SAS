-- 013: tax breakdown + sequential invoice numbers on resident bills.
-- Every Bill is an invoice: INV-<year>-<5 digit counter per estate>, assigned by a trigger so every creator (manual, bulk, amenity, repair, monthly job) gets one race-free.
BEGIN;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "subtotal"  DECIMAL(14,2);
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "taxTotal"  DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "taxLines"  JSONB;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "invoiceNo" TEXT;
UPDATE "Bill" SET "subtotal" = "amount" WHERE "subtotal" IS NULL;

CREATE TABLE IF NOT EXISTS "InvoiceCounter" (
  "tenantId" TEXT PRIMARY KEY REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "last"     INTEGER NOT NULL DEFAULT 0
);

-- number the bills that already exist, oldest first, per estate
WITH n AS (SELECT "id", "tenantId", ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", "id") AS rn FROM "Bill" WHERE "invoiceNo" IS NULL)
UPDATE "Bill" b SET "invoiceNo" = 'INV-' || to_char(b."createdAt", 'YYYY') || '-' || lpad((n.rn + COALESCE((SELECT "last" FROM "InvoiceCounter" c WHERE c."tenantId" = b."tenantId"), 0))::text, 5, '0')
FROM n WHERE b."id" = n."id";
INSERT INTO "InvoiceCounter" ("tenantId", "last") SELECT "tenantId", COUNT(*) FROM "Bill" GROUP BY "tenantId"
ON CONFLICT ("tenantId") DO UPDATE SET "last" = GREATEST("InvoiceCounter"."last", EXCLUDED."last");

CREATE UNIQUE INDEX IF NOT EXISTS "Bill_tenantId_invoiceNo_key" ON "Bill" ("tenantId", "invoiceNo");

CREATE OR REPLACE FUNCTION bill_assign_invoice_no() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  IF NEW."invoiceNo" IS NULL THEN
    INSERT INTO "InvoiceCounter" ("tenantId", "last") VALUES (NEW."tenantId", 1)
    ON CONFLICT ("tenantId") DO UPDATE SET "last" = "InvoiceCounter"."last" + 1 RETURNING "last" INTO n;
    NEW."invoiceNo" := 'INV-' || to_char(COALESCE(NEW."createdAt", now()), 'YYYY') || '-' || lpad(n::text, 5, '0');
  END IF;
  IF NEW."subtotal" IS NULL THEN NEW."subtotal" := NEW."amount"; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bill_invoice_no ON "Bill";
CREATE TRIGGER bill_invoice_no BEFORE INSERT ON "Bill" FOR EACH ROW EXECUTE FUNCTION bill_assign_invoice_no();

REVOKE ALL ON "InvoiceCounter" FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estatium_app') THEN
  REVOKE ALL ON FUNCTION bill_assign_invoice_no() FROM PUBLIC;
END IF; END $$;
COMMIT;
