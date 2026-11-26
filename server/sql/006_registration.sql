-- 006_registration.sql — resident self-registration (pilot). Idempotent; additive only.
--   * Tenant.registrationCode / registrationEnabled: one invitation code per estate (OFF until the estate admin turns it on)
--   * RegistrationRequest: a tenant-scoped table (same RLS + tenantId-immutable rules as every other tenant table)
--   * platform_purge_tenant() learns about the new table so a purge can never be blocked by it

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "registrationCode"    TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "registrationEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_registrationCode_key" ON "Tenant" ("registrationCode");

CREATE TABLE IF NOT EXISTS "RegistrationRequest" (
  "id"             TEXT         PRIMARY KEY,
  "tenantId"       TEXT         NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "trackingToken"  TEXT         NOT NULL,
  "name"           TEXT         NOT NULL,
  "email"          TEXT         NOT NULL,
  "phone"          TEXT,
  "residentType"   TEXT         NOT NULL DEFAULT 'TENANT' CHECK ("residentType" IN ('OWNER','TENANT')),
  "unitId"         TEXT         REFERENCES "Unit"("id") ON DELETE SET NULL,
  "passwordHash"   TEXT         NOT NULL,
  "selfiePath"     TEXT,
  "consentAt"      TIMESTAMP(3) NOT NULL,
  "consentVersion" TEXT         NOT NULL,
  "status"         TEXT         NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED','NEEDS_INFO')),
  "reviewNote"     TEXT,
  "reviewedById"   TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "createdUserId"  TEXT,
  "ip"             TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "RegistrationRequest_trackingToken_key" ON "RegistrationRequest" ("trackingToken");
-- one open request per email per estate (a rejected applicant may apply again)
CREATE UNIQUE INDEX IF NOT EXISTS "RegistrationRequest_open_email_key" ON "RegistrationRequest" ("tenantId", lower("email")) WHERE "status" IN ('PENDING','NEEDS_INFO');
CREATE INDEX IF NOT EXISTS "RegistrationRequest_tenantId_status_createdAt_idx" ON "RegistrationRequest" ("tenantId","status","createdAt" DESC);

ALTER TABLE "RegistrationRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RegistrationRequest";
CREATE POLICY tenant_isolation ON "RegistrationRequest"
  USING      ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
DROP TRIGGER IF EXISTS trg_tenant_immutable ON "RegistrationRequest";
CREATE TRIGGER trg_tenant_immutable BEFORE UPDATE ON "RegistrationRequest" FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change();

CREATE OR REPLACE FUNCTION platform_purge_tenant(p_tenant text, p_force boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st "TenantStatus"; pa timestamp;
BEGIN
  SELECT status, "purgeAfter" INTO st, pa FROM "Tenant" WHERE id = p_tenant;
  IF st IS NULL THEN RAISE EXCEPTION 'tenant not found'; END IF;
  IF st <> 'DELETED' THEN RAISE EXCEPTION 'tenant is not in DELETED state'; END IF;
  IF NOT p_force AND (pa IS NULL OR pa > now()) THEN RAISE EXCEPTION 'retention window not over yet'; END IF;

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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "RegistrationRequest" TO estatium_app;
  END IF;
END $$;
