-- Database-level isolation tests. Run on a scratch DB that has 001/002/003 applied:
--   psql -v ON_ERROR_STOP=1 -d estatium_test -f test/db_isolation.test.sql
-- Everything runs inside one transaction that is rolled back.
BEGIN;

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_label text, p_like text DEFAULT '%') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE p_like THEN RAISE NOTICE 'PASS  %  (%)', p_label, left(SQLERRM, 70); RETURN; END IF;
    RAISE EXCEPTION 'FAIL  %: wrong error: %', p_label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL  %: expected an error but statement succeeded', p_label;
END $$;

CREATE FUNCTION pg_temp.expect_eq(p_actual bigint, p_expected bigint, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'FAIL  %: got %, expected %', p_label, p_actual, p_expected; END IF;
  RAISE NOTICE 'PASS  %  (= %)', p_label, p_actual;
END $$;

CREATE FUNCTION pg_temp.expect_rows(p_sql text, p_expected int, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> p_expected THEN RAISE EXCEPTION 'FAIL  %: affected % rows, expected %', p_label, n, p_expected; END IF;
  RAISE NOTICE 'PASS  %  (% rows)', p_label, n;
END $$;

-- ── fixtures (as owner; bypasses RLS) ────────────────────────────────────────
INSERT INTO "Tenant"(id, slug, name, "updatedAt") VALUES ('t1','alpha-estate','Alpha',now()), ('t2','beta-estate','Beta',now());
INSERT INTO "Subscription"(id,"tenantId","planId",currency,"currentPeriodStart","currentPeriodEnd","maxUnits","updatedAt")
  SELECT 's1','t1',id,'USD',now(),now()+interval '30 day',2,now() FROM "Plan" WHERE code='standard';
INSERT INTO "Subscription"(id,"tenantId","planId",currency,"currentPeriodStart","currentPeriodEnd","updatedAt")
  SELECT 's2','t2',id,'USD',now(),now()+interval '30 day',now() FROM "Plan" WHERE code='standard';
INSERT INTO "User"(id,"tenantId",email,password,role,name,"updatedAt") VALUES
  ('u1','t1','a@x.com','h','ADMIN','A',now()), ('u2','t2','a@x.com','h','ADMIN','A2',now());   -- same email, different tenants
INSERT INTO "Block"(id,"tenantId",name) VALUES ('b1','t1','A'), ('b2','t2','A');               -- same block name
INSERT INTO "Unit"(id,"tenantId","blockId","unitNumber") VALUES ('un1','t1','b1','001'), ('un2','t2','b2','001');
INSERT INTO "Amenity"(id,"tenantId",name) VALUES ('am1','t1','Pool');

-- ── tests as the application role ───────────────────────────────────────────
SET LOCAL ROLE estatium_app;

SELECT pg_temp.expect_eq((SELECT count(*) FROM "User"), 0, 'no tenant context => zero rows visible');

SELECT set_config('app.tenant_id','t1',true);
SELECT pg_temp.expect_eq((SELECT count(*) FROM "User"), 1, 'tenant t1 sees only its user');
SELECT pg_temp.expect_eq((SELECT count(*) FROM "Unit" WHERE "tenantId"='t2'), 0, 'tenant t1 cannot read t2 units even by explicit filter');
SELECT pg_temp.expect_error($$INSERT INTO "Block"(id,"tenantId",name) VALUES ('bx','t2','Evil')$$, 'insert into another tenant is rejected', '%row-level security%');
SELECT pg_temp.expect_error($$UPDATE "Block" SET "tenantId"='t2' WHERE id='b1'$$, 'moving a row to another tenant is rejected', '%');
SELECT pg_temp.expect_rows($$DELETE FROM "Block" WHERE id='b2'$$, 0, 'cannot delete another tenant''s row');
SELECT pg_temp.expect_rows($$UPDATE "Unit" SET floor=9 WHERE id='un2'$$, 0, 'cannot update another tenant''s row');

-- unique-per-tenant semantics
SELECT pg_temp.expect_error($$INSERT INTO "User"(id,"tenantId",email,password,role,name,"updatedAt") VALUES ('u3','t1','a@x.com','h','GUARD','dup',now())$$, 'duplicate email inside one tenant rejected', '%duplicate key%');

-- unit cap (maxUnits = 2 for t1; one unit exists)
INSERT INTO "Unit"(id,"tenantId","blockId","unitNumber") VALUES ('un3','t1','b1','002');
SELECT pg_temp.expect_error($$INSERT INTO "Unit"(id,"tenantId","blockId","unitNumber") VALUES ('un4','t1','b1','003')$$, 'unit cap enforced', '%UNIT_CAP_EXCEEDED%');

-- booking overlap
INSERT INTO "User"(id,"tenantId",email,password,role,name,"updatedAt") VALUES ('u4','t1','r@x.com','h','RESIDENT','R',now());
INSERT INTO "AmenityBooking"(id,"tenantId","amenityId","userId",date,"startTime","endTime","startAt","endAt",status)
  VALUES ('bk1','t1','am1','u4','2026-10-10','10:00','12:00','2026-10-10 10:00','2026-10-10 12:00','APPROVED');
SELECT pg_temp.expect_error($$INSERT INTO "AmenityBooking"(id,"tenantId","amenityId","userId",date,"startTime","endTime","startAt","endAt",status)
  VALUES ('bk2','t1','am1','u4','2026-10-10','11:00','13:00','2026-10-10 11:00','2026-10-10 13:00','PENDING')$$, 'overlapping booking rejected', '%amenity_booking_no_overlap%');
INSERT INTO "AmenityBooking"(id,"tenantId","amenityId","userId",date,"startTime","endTime","startAt","endAt",status)
  VALUES ('bk3','t1','am1','u4','2026-10-10','12:00','13:00','2026-10-10 12:00','2026-10-10 13:00','APPROVED');  -- back-to-back is fine
INSERT INTO "AmenityBooking"(id,"tenantId","amenityId","userId",date,"startTime","endTime","startAt","endAt",status)
  VALUES ('bk4','t1','am1','u4','2026-10-10','10:30','11:30','2026-10-10 10:30','2026-10-10 11:30','CANCELLED');  -- cancelled doesn't block
SELECT pg_temp.expect_eq((SELECT count(*) FROM "AmenityBooking"), 3, 'back-to-back and cancelled bookings allowed');

-- money integrity
INSERT INTO "Resident"(id,"tenantId","userId","unitId") VALUES ('r1','t1','u4','un1');
SELECT pg_temp.expect_error($$INSERT INTO "Bill"(id,"tenantId","residentId",title,amount,"amountPaid",currency,"dueDate") VALUES ('bl1','t1','r1','x',100,150,'USD',now())$$, 'overpaid bill rejected', '%bill_amounts_ck%');
SELECT pg_temp.expect_error($$INSERT INTO "Bill"(id,"tenantId","residentId",title,amount,currency,"dueDate") VALUES ('bl2','t1','r1','x',100,'ZZZ',now())$$, 'unknown currency rejected', '%');
INSERT INTO "Bill"(id,"tenantId","residentId",title,amount,currency,"dueDate","sourceType","sourceId") VALUES ('bl3','t1','r1','Pool',50,'USD',now(),'AMENITY_BOOKING','bk1');
SELECT pg_temp.expect_error($$INSERT INTO "Bill"(id,"tenantId","residentId",title,amount,currency,"dueDate","sourceType","sourceId") VALUES ('bl4','t1','r1','Pool again',50,'USD',now(),'AMENITY_BOOKING','bk1')$$, 'duplicate auto-bill for same booking rejected (idempotency)', '%duplicate key%');

-- switching tenant context switches visibility
SELECT set_config('app.tenant_id','t2',true);
SELECT pg_temp.expect_eq((SELECT count(*) FROM "Unit"), 1, 'tenant t2 sees exactly its own unit');
SELECT pg_temp.expect_eq((SELECT count(*) FROM "Bill"), 0, 'tenant t2 sees none of t1''s bills');

-- platform functions work for the app role and bypass RLS
SELECT set_config('app.tenant_id','',true);
SELECT pg_temp.expect_eq((SELECT platform_billable_units('t1')), 2, 'platform_billable_units counts across RLS');
SELECT pg_temp.expect_eq((SELECT count(*) FROM platform_tenant_stats()), 2, 'platform_tenant_stats sees both tenants');
SELECT pg_temp.expect_error($$SELECT platform_purge_tenant('t1')$$, 'purge refuses a non-DELETED tenant', '%not in DELETED%');

RESET ROLE;
UPDATE "Tenant" SET status='DELETED', "deletedAt"=now(), "purgeAfter"=now()+interval '30 day' WHERE id='t1';
SET LOCAL ROLE estatium_app;
SELECT pg_temp.expect_error($$SELECT platform_purge_tenant('t1')$$, 'purge refuses before retention window ends', '%retention window%');
SELECT platform_purge_tenant('t1', true);
RESET ROLE;
SELECT pg_temp.expect_eq((SELECT count(*) FROM "User" WHERE "tenantId"='t1'), 0, 'purge erased t1 users');
SELECT pg_temp.expect_eq((SELECT count(*) FROM "User" WHERE "tenantId"='t2'), 1, 'purge left t2 untouched');
SELECT pg_temp.expect_eq((SELECT count(*) FROM "Tenant" WHERE id='t1' AND "purgedAt" IS NOT NULL), 1, 'tombstone kept with purgedAt');

ROLLBACK;
\echo ALL DB ISOLATION TESTS PASSED
