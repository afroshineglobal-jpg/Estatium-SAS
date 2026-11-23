-- 005_pilot_prepaid.sql — manual prepaid billing for the pilot. Idempotent; additive only (nothing dropped).
-- billingMode MANUAL_PREPAID: the invoice/dunning engine skips the estate; access is driven by "paidThrough".
-- paidThrough = last day (inclusive, UTC) that is paid for. It is RECOMPUTED from the ledger, never typed in.

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "billingMode"      TEXT        NOT NULL DEFAULT 'MANUAL_PREPAID';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "paidThrough"      TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "prepaidGraceDays" INTEGER     NOT NULL DEFAULT 30;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_billing_mode') THEN
    ALTER TABLE "Subscription" ADD CONSTRAINT chk_subscription_billing_mode CHECK ("billingMode" IN ('MANUAL_PREPAID','INVOICED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_prepaid_grace') THEN
    ALTER TABLE "Subscription" ADD CONSTRAINT chk_subscription_prepaid_grace CHECK ("prepaidGraceDays" BETWEEN 0 AND 365);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PrepaidPayment" (
  "id"           TEXT          PRIMARY KEY,
  "tenantId"     TEXT          NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "amount"       NUMERIC(14,2) NOT NULL CHECK ("amount" > 0),
  "currency"     CHAR(3)       NOT NULL REFERENCES "Currency"("code"),
  "periodFrom"   DATE          NOT NULL,
  "periodTo"     DATE          NOT NULL,
  "method"       TEXT          NOT NULL DEFAULT 'BANK_TRANSFER',
  "reference"    TEXT,
  "note"         TEXT,
  "status"       TEXT          NOT NULL DEFAULT 'RECORDED' CHECK ("status" IN ('RECORDED','VOIDED')),
  "provider"     TEXT,
  "providerRef"  TEXT,
  "voidedAt"     TIMESTAMP(3),
  "voidReason"   TEXT,
  "voidedById"   TEXT,
  "recordedById" TEXT,
  "paidAt"       TIMESTAMP(3)  NOT NULL DEFAULT now(),
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT now(),
  CONSTRAINT chk_prepaid_period CHECK ("periodTo" >= "periodFrom"),
  CONSTRAINT chk_prepaid_void   CHECK (("status" = 'VOIDED') = ("voidedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "PrepaidPayment_provider_providerRef_key" ON "PrepaidPayment" ("provider","providerRef");
CREATE INDEX IF NOT EXISTS "PrepaidPayment_tenantId_paidAt_idx" ON "PrepaidPayment" ("tenantId","paidAt" DESC);

-- the app role has default privileges, but be explicit so a differently-configured server cannot break
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estatium_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PrepaidPayment" TO estatium_app;
  END IF;
END $$;
