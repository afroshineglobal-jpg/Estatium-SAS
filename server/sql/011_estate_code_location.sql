-- 011_estate_code_location.sql — a permanent, globally unique 6-LETTER estate code (used by residents to register) and the estate's
-- full postal location (used to target ads). Idempotent; additive. Existing estates are given a random code at once.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "estateCode" CHAR(6);
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "area"       TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "locality"   TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "city"       TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "district"   TEXT;    -- Local Government Area in Nigeria, District in India, ...
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "state"      TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;

DO $$
DECLARE t RECORD; c TEXT;
BEGIN
  FOR t IN SELECT id FROM "Tenant" WHERE "estateCode" IS NULL LOOP
    LOOP
      c := (SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1), '') FROM generate_series(1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "estateCode" = c);
    END LOOP;
    UPDATE "Tenant" SET "estateCode" = c WHERE id = t.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_estateCode_key" ON "Tenant" ("estateCode");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Tenant_estateCode_format') THEN
    ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_estateCode_format" CHECK ("estateCode" IS NULL OR "estateCode" ~ '^[A-Z]{6}$');
  END IF;
END $$;
