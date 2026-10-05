# System-wide test checklist

✅ = covered by an automated test in this branch  ·  ☐ = manual / not automated yet

## Platform & tenancy
- ✅ Two estates with the same email are different accounts; login needs the estate code
- ✅ Estate A cannot read/update/delete any B row by id (404), nor by forged `tenantId` in body or query
- ✅ Any Prisma call outside a tenant context throws (deny by default)
- ✅ DB: no tenant context ⇒ 0 rows; cross-tenant INSERT rejected by RLS; `tenantId` immutable; cross-tenant DELETE/UPDATE touch 0 rows
- ✅ Sockets: anonymous rejected; an SOS in A never reaches B; client-originated `emergency-sos`/`send-message` ignored
- ✅ Platform token cannot call tenant routes and vice-versa
- ☐ Run the same isolation suite against a real Prisma + PostgreSQL stack with `ENABLE_RLS=true`
- ☐ Sub-domain login (`greenville.<TENANT_BASE_DOMAIN>`) behind your reverse proxy

## Tenant lifecycle
- ✅ Legal / illegal state transitions; DELETED→ACTIVE refused; purged tenants cannot be restored
- ✅ SUSPENDED: reads OK, writes 403, SOS + auth + subscription pages still work
- ✅ EXPIRED: app 402, `/auth/me` and subscription still reachable; DELETED 410; an in-flight token stops immediately
- ✅ Trial past `trialEndsAt` behaves as EXPIRED even before the job runs
- ✅ Delete requires typing the slug; purge refuses before the retention date (DB test)
- ☐ Trial → paid conversion issues the first invoice; failed price lookup expires instead of crashing (real DB)
- ☐ Suspended-for-nonpayment tenant auto-reactivates when the last overdue invoice is paid

## Subscription & billing engine (pure logic ✅)
- ✅ 100 units × $2 = $200; custom price; plan minimum; committed units + overage; annual = 12×
- ✅ Percent then fixed coupons, never below zero, fixed coupon only in its own currency; credit never makes an invoice negative; tax on discounted amount
- ✅ Proration: upgrade mid-period, downgrade → credit, day-1 change, change after period end
- ✅ Month-end clamping (31 Jan → 28/29 Feb)
- ☐ Renewal job idempotency (kill the process mid-run; no double invoice)
- ☐ Concurrent `runBillingCycle` from two instances (advisory lock)
- ☐ Currency change with open invoices refused; coupon one-per-tenant

## Authentication
- ✅ Wrong password / unknown user / unknown estate return the same message; lockout after 5 failures
- ✅ Password policy; changing the password revokes old tokens
- ☐ `logout-all`; token expiry; `mustChangePassword` flow in the UI

## Resident management
- ✅ Resident cannot read a neighbour's record or delete their family members; staff can
- ☐ Create resident ⇒ user + resident created atomically; duplicate email → 409; move-out frees the unit
- ☐ Family-member cap from settings; unit numbers beyond 999

## Visitors / gate
- ✅ Resident cannot verify codes; guard can
- ☐ Walk-in → doorbell reaches only that resident; approve/deny only for own visitors; expired code refused; entry/exit double-scan blocked

## Parcels
- ☐ OTP hashed; 5 wrong tries lock; wrong-unit resident refused; guard sees OTP once

## Amenities
- ✅ (DB) overlapping booking rejected; back-to-back and cancelled bookings allowed
- ☐ Approval bills exactly once (re-approve = no second bill); price = hours × rate; past-date refusal; cancellation by owner only

## Billing (resident dues)
- ✅ Resident cannot record a payment; invalid amounts → 400; (DB) overpayment/unknown currency/duplicate auto-bill rejected
- ☐ Partial payments → PARTIAL → PAID; bulk billing twice creates nothing the 2nd time; WAIVE/VOID rules; summary totals in estate currency
- ☐ Overdue job flips UNPAID/PARTIAL after due date

## Maintenance · Emergency · Communication · Staff · Vehicles · Ads · Settings
- ☐ Status change preserves costs; auto-bill only when `billResident: true`, once
- ✅ SOS works while SUSPENDED; ☐ SOS response time with 50 responders (< 200 ms); residents see only their own reports
- ☐ Private chat rooms; poll one-vote-per-user & vote change; notice expiry
- ☐ STAFF role has no gate access; staff can update only their own tasks
- ☐ Unknown settings keys rejected; currency not editable by tenant admin; ad `javascript:` URLs rejected

## Migration
- ✅ Real legacy DB: all 26 source tables, row counts and bill total (₦175 000.00) match; dry-run rolls back; re-run refuses; works as the RLS-bound role; purge rolls the tenant back
- ☐ Run on a copy of **production** data and review the repair report (duplicate codes, overlapping bookings, PAID bills with no payment)
