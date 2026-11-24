-- 007_vehicle_approval.sql — residents request a vehicle, the estate ADMIN approves. Idempotent; additive only.
-- Every vehicle that exists today stays usable: the default for existing rows is APPROVED.
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "status"       TEXT NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "reviewNote"   TEXT;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "reviewedAt"   TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "requestedAt"  TIMESTAMP(3);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Vehicle_status_check') THEN
    ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Vehicle_tenantId_status_idx" ON "Vehicle" ("tenantId","status");
