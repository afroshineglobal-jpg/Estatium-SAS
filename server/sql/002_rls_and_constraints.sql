-- 002_rls_and_constraints.sql — run AFTER 001_schema.sql, as the table-owner / migration role.
-- Adds: row-level security, integrity CHECKs, no-overlap booking constraint, unit cap,
-- tenant-id immutability, platform helper functions, invoice number sequence, app-role grants.
--
-- Roles
--   migration/owner role : owns the tables, bypasses RLS (RLS is ENABLED but NOT FORCED).
--   estatium_app         : the role the Node server connects as. NOBYPASSRLS, not an owner.
-- Create it once (change the password!):
--   CREATE ROLE estatium_app LOGIN PASSWORD '...' NOBYPASSRLS;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── 1. Row level security on every tenant-scoped table ──────────────────────
-- The server sets   SELECT set_config('app.tenant_id', '<tenant uuid>', true)   inside each
-- transaction. With no setting, current_setting(...) is NULL → policy is false → zero rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User','Block','Unit','Resident','FamilyMember','Visitor','Parcel','Amenity','AmenitySlot',
    'AmenityBooking','Bill','Payment','Vehicle','VehicleLog','StaffMember','AttendanceLog','Task',
    'MaintenanceRequest','EmergencyReport','Notice','Message','Poll','PollVote','Guard',
    'Notification','Advertisement','Setting'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                      USING      ("tenantId" = current_setting('app.tenant_id', true))
                      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))$p$, t);
  END LOOP;
END $$;

-- ─── 2. tenantId is immutable ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION forbid_tenant_change() RETURNS trigger AS $$
BEGIN
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" THEN
    RAISE EXCEPTION 'tenantId is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User','Block','Unit','Resident','FamilyMember','Visitor','Parcel','Amenity','AmenitySlot',
    'AmenityBooking','Bill','Payment','Vehicle','VehicleLog','StaffMember','AttendanceLog','Task',
    'MaintenanceRequest','EmergencyReport','Notice','Message','Poll','PollVote','Guard',
    'Notification','Advertisement','Setting'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_tenant_immutable ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_tenant_immutable BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change()', t);
  END LOOP;
END $$;

-- ─── 3. Referential + domain integrity ───────────────────────────────────────
ALTER TABLE "Tenant"       ADD CONSTRAINT tenant_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
ALTER TABLE "Subscription" ADD CONSTRAINT subscription_currency_fk FOREIGN KEY ("currency") REFERENCES "Currency"("code");
ALTER TABLE "Invoice"      ADD CONSTRAINT invoice_currency_fk      FOREIGN KEY ("currency") REFERENCES "Currency"("code");
ALTER TABLE "Bill"         ADD CONSTRAINT bill_currency_fk         FOREIGN KEY ("currency") REFERENCES "Currency"("code");
ALTER TABLE "Payment"      ADD CONSTRAINT payment_currency_fk      FOREIGN KEY ("currency") REFERENCES "Currency"("code");

ALTER TABLE "Bill"    ADD CONSTRAINT bill_amounts_ck   CHECK ("amount" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "amount");
ALTER TABLE "Payment" ADD CONSTRAINT payment_amount_ck CHECK ("amount" > 0);
ALTER TABLE "Invoice" ADD CONSTRAINT invoice_amounts_ck CHECK ("total" >= 0 AND "amountPaid" >= 0 AND "subtotal" >= 0 AND "discountTotal" >= 0);
ALTER TABLE "PlanPrice" ADD CONSTRAINT planprice_nonneg CHECK ("unitAmount" >= 0 AND COALESCE("overageAmount",0) >= 0 AND COALESCE("flatAmount",0) >= 0);
ALTER TABLE "Coupon"  ADD CONSTRAINT coupon_shape_ck CHECK (
  ("type" = 'PERCENT'      AND "percentOff" IS NOT NULL AND "percentOff" > 0 AND "percentOff" <= 100) OR
  ("type" = 'FIXED_AMOUNT' AND "amountOff"  IS NOT NULL AND "amountOff"  > 0 AND "currency" IS NOT NULL));
ALTER TABLE "Subscription" ADD CONSTRAINT subscription_period_ck CHECK ("currentPeriodEnd" > "currentPeriodStart");
ALTER TABLE "Subscription" ADD CONSTRAINT subscription_units_ck  CHECK (COALESCE("committedUnits",0) >= 0 AND COALESCE("maxUnits",0) >= 0 AND "creditBalance" >= 0);
ALTER TABLE "Visitor" ADD CONSTRAINT visitor_times_ck CHECK ("exitTime" IS NULL OR "entryTime" IS NULL OR "exitTime" >= "entryTime");
ALTER TABLE "AmenityBooking" ADD CONSTRAINT booking_times_ck CHECK ("endAt" > "startAt");

-- Double-booking is impossible at the database level (replaces the racy read-then-insert check).
ALTER TABLE "AmenityBooking" ADD CONSTRAINT amenity_booking_no_overlap
  EXCLUDE USING gist ("tenantId" WITH =, "amenityId" WITH =, tsrange("startAt", "endAt", '[)') WITH &&)
  WHERE ("status" IN ('PENDING', 'APPROVED'));

-- Only one active resident per user is already unique(userId); a unit may have several residents.

-- ─── 4. Contractual unit cap (Subscription.maxUnits) ─────────────────────────
CREATE OR REPLACE FUNCTION enforce_unit_cap() RETURNS trigger AS $$
DECLARE cap integer; used integer;
BEGIN
  SELECT "maxUnits" INTO cap FROM "Subscription" WHERE "tenantId" = NEW."tenantId";
  IF cap IS NOT NULL AND NEW."isActive" THEN
    SELECT count(*) INTO used FROM "Unit" WHERE "tenantId" = NEW."tenantId" AND "isActive";
    IF used + 1 > cap THEN
      RAISE EXCEPTION 'UNIT_CAP_EXCEEDED: subscription allows % units', cap USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_unit_cap ON "Unit";
CREATE TRIGGER trg_unit_cap BEFORE INSERT ON "Unit" FOR EACH ROW EXECUTE FUNCTION enforce_unit_cap();

-- ─── 5. Sequences ────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1000;

-- ─── 6. Platform helper functions (SECURITY DEFINER: run as owner → bypass RLS) ──
-- The Super Owner portal needs cross-tenant aggregates; it must never read tenant tables directly.
CREATE OR REPLACE FUNCTION platform_billable_units(p_tenant text) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT count(*)::int FROM "Unit" WHERE "tenantId" = p_tenant AND "isActive" $$;

CREATE OR REPLACE FUNCTION platform_tenant_stats()
RETURNS TABLE ("tenantId" text, units integer, residents integer, users integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id,
         (SELECT count(*)::int FROM "Unit"     u WHERE u."tenantId" = t.id AND u."isActive"),
         (SELECT count(*)::int FROM "Resident" r WHERE r."tenantId" = t.id AND r."isActive"),
         (SELECT count(*)::int FROM "User"     x WHERE x."tenantId" = t.id AND x."isActive")
  FROM "Tenant" t WHERE t.status <> 'DELETED'
$$;

-- Hard-erases a tenant's operational data once its retention window has passed.
-- Invoices / payments / audit rows are retained for accounting. Tenant row stays as a tombstone.
CREATE OR REPLACE FUNCTION platform_purge_tenant(p_tenant text, p_force boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st "TenantStatus"; pa timestamp;
BEGIN
  SELECT status, "purgeAfter" INTO st, pa FROM "Tenant" WHERE id = p_tenant;
  IF st IS NULL THEN RAISE EXCEPTION 'tenant not found'; END IF;
  IF st <> 'DELETED' THEN RAISE EXCEPTION 'tenant is not in DELETED state'; END IF;
  IF NOT p_force AND (pa IS NULL OR pa > now()) THEN RAISE EXCEPTION 'retention window not over yet'; END IF;

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

REVOKE ALL ON FUNCTION platform_purge_tenant(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_billable_units(text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_tenant_stats()              FROM PUBLIC;

-- ─── 7. Grants for the application role ──────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estatium_app') THEN
    GRANT USAGE ON SCHEMA public TO estatium_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO estatium_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO estatium_app;
    GRANT EXECUTE ON FUNCTION platform_purge_tenant(text, boolean), platform_billable_units(text), platform_tenant_stats() TO estatium_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO estatium_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO estatium_app;
  END IF;
END $$;
