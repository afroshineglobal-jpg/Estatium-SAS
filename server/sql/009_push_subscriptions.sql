-- 009_push_subscriptions.sql — Web Push (standard browser push, no Firebase). One row per device a person turned notifications on for.
-- Idempotent; additive only; tenant-scoped with the same RLS + immutable tenantId rules as every other tenant table.
CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id"        TEXT         PRIMARY KEY,
  "tenantId"  TEXT         NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "userId"    TEXT         NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "endpoint"  TEXT         NOT NULL,
  "p256dh"    TEXT         NOT NULL,
  "auth"      TEXT         NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "lastUsedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription" ("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_tenantId_userId_idx" ON "PushSubscription" ("tenantId","userId");

ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PushSubscription";
CREATE POLICY tenant_isolation ON "PushSubscription"
  USING      ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
DROP TRIGGER IF EXISTS trg_tenant_immutable ON "PushSubscription";
CREATE TRIGGER trg_tenant_immutable BEFORE UPDATE ON "PushSubscription" FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change();

CREATE OR REPLACE FUNCTION platform_purge_tenant(p_tenant text, p_force boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st "TenantStatus"; pa timestamp;
BEGIN
  SELECT status, "purgeAfter" INTO st, pa FROM "Tenant" WHERE id = p_tenant;
  IF st IS NULL THEN RAISE EXCEPTION 'tenant not found'; END IF;
  IF st <> 'DELETED' THEN RAISE EXCEPTION 'tenant is not in DELETED state'; END IF;
  IF NOT p_force AND (pa IS NULL OR pa > now()) THEN RAISE EXCEPTION 'retention window not over yet'; END IF;

  DELETE FROM "PushSubscription"   WHERE "tenantId" = p_tenant;
  DELETE FROM "RegistrationRequest" WHERE "tenantId" = p_tenant;
  DELETE FROM "PollVote"           WHERE "tenantId" = p_tenant;
  DELETE FROM "Poll"               WHERE "tenantId" = p_tenant;
  DELETE FROM "Message"            WHERE "tenantId" = p_tenant;
  DELETE FROM "Notification"       WHERE "tenantId" = p_tenant;
  DELETE FROM "Notice"             WHERE "tenantId" = p_tenant;
  DELETE FROM "Advertisement"      WHERE "tenantId" = p_tenant;
  DELETE FROM "Setting"            WHERE "tenantId" = p_tenant;
  DELETE FROM "Task"               WHERE "tenantId" = p_tenant;
  DELETE FROM "AttendanceLog"      WHERE "tenantId" = p_tenant;
  DELETE FROM "StaffMember"        WHERE "tenantId" = p_tenant;
  DELETE FROM "VehicleLog"         WHERE "tenantId" = p_tenant;
  DELETE FROM "Vehicle"            WHERE "tenantId" = p_tenant;
  DELETE FROM "Payment"            WHERE "tenantId" = p_tenant;
  DELETE FROM "Bill"               WHERE "tenantId" = p_tenant;
  DELETE FROM "AmenityBooking"     WHERE "tenantId" = p_tenant;
  DELETE FROM "AmenitySlot"        WHERE "tenantId" = p_tenant;
  DELETE FROM "Amenity"            WHERE "tenantId" = p_tenant;
  DELETE FROM "Parcel"             WHERE "tenantId" = p_tenant;
  DELETE FROM "FamilyMember"       WHERE "tenantId" = p_tenant;
  DELETE FROM "Visitor"            WHERE "tenantId" = p_tenant;
  DELETE FROM "Guard"              WHERE "tenantId" = p_tenant;
  DELETE FROM "EmergencyReport"    WHERE "tenantId" = p_tenant;
  DELETE FROM "MaintenanceRequest" WHERE "tenantId" = p_tenant;
  DELETE FROM "Resident"           WHERE "tenantId" = p_tenant;
  DELETE FROM "Unit"               WHERE "tenantId" = p_tenant;
  DELETE FROM "Block"              WHERE "tenantId" = p_tenant;
  DELETE FROM "User"               WHERE "tenantId" = p_tenant;
  UPDATE "Tenant" SET "purgedAt" = now(), "updatedAt" = now() WHERE id = p_tenant;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estatium_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PushSubscription" TO estatium_app;
  END IF;
END $$;
