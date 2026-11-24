-- 008_lifecycle.sql — staff status lifecycle + resident move-out + plate reuse after a vehicle leaves. Idempotent; additive.
--   Staff:    ACTIVE | SUSPENDED | DEACTIVATED | LEFT   (nothing is ever deleted: history stays for exports)
--   Resident: moveOutNote / vacatedById beside the existing moveOutDate / isActive
--   Vehicle:  a plate must be unique only among ACTIVE vehicles, so a new owner can register a plate whose old record
--             (kept for history) belongs to a resident who has moved out.

ALTER TABLE "StaffMember" ADD COLUMN IF NOT EXISTS "status"          TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "StaffMember" ADD COLUMN IF NOT EXISTS "statusNote"      TEXT;
ALTER TABLE "StaffMember" ADD COLUMN IF NOT EXISTS "statusChangedAt" TIMESTAMP(3);
ALTER TABLE "StaffMember" ADD COLUMN IF NOT EXISTS "leftAt"          TIMESTAMP(3);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffMember_status_check') THEN
    ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_status_check" CHECK ("status" IN ('ACTIVE','SUSPENDED','DEACTIVATED','LEFT'));
  END IF;
END $$;
UPDATE "StaffMember" SET "status" = 'DEACTIVATED' WHERE "isActive" = false AND "status" = 'ACTIVE';

ALTER TABLE "Resident" ADD COLUMN IF NOT EXISTS "moveOutNote" TEXT;
ALTER TABLE "Resident" ADD COLUMN IF NOT EXISTS "vacatedById" TEXT;

DROP INDEX IF EXISTS "Vehicle_tenantId_plateNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_active_plate_key" ON "Vehicle" ("tenantId", "plateNumber") WHERE "isActive";
CREATE INDEX IF NOT EXISTS "Vehicle_tenantId_plateNumber_idx" ON "Vehicle" ("tenantId", "plateNumber");
CREATE INDEX IF NOT EXISTS "VehicleLog_vehicleId_timestamp_idx" ON "VehicleLog" ("vehicleId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "Visitor_tenantId_vehicle_idx" ON "Visitor" ("tenantId", "vehicleNumber") WHERE "vehicleNumber" IS NOT NULL;
