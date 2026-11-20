# Estatium — Re-engineering for the 10-Estate Pilot

Status: design only, no code written. Date: 2026-11-20. Revised after owner decisions (VPS, 30-day grace, family logins, local currencies, English and pt-BR).
Inputs: `estate-poc-v4_1.zip`, `Estatium_re-engineer.docx`, and this repo (`C:\Estatium-SAS`).

## 1. Verdict

1. **Most of the docx is already built in this repo.** The zip is the old single-estate SQLite proof of concept. This repo is the multi-tenant rewrite: PostgreSQL, `tenantId` on 27 models, Prisma tenant scoping, row-level security, a Super Owner portal, a subscription engine, audit log, 52 unit tests and 24 DB assertions (as claimed in `README.md`; I could not run them).
2. **Do not execute the docx as written.** It would rebuild working parts (auth, tenancy, RLS) and add four hosting vendors for ten customers.
3. **The real work is five small things:** a prepaid payment ledger with a paid-through date, resident self-registration with approval and selfie, CSV onboarding, a safe production deployment, and PWA and backup hardening.

Scope of my reading: `README.md`, `docs/01–04`, `schema.prisma`, `app.js`, `config/prisma.js`, `jobs/scheduler.js`, `utils/notify.js`, `residents.routes.js`, `vite.config.js`, both `package.json` files, and the folder listing. I did not read `billing.service.js` (28 KB) or `platform.routes.js` line by line. I did not open `estate-poc/server/.env` inside the zip.

## 2. What already exists vs what the docx asks for

| Docx requirement | State in repo | Action |
|---|---|---|
| Multi-tenant, `estate_id` everywhere, RLS | Done (`tenantId`, Prisma extension, `sql/002`, `ENABLE_RLS`) | Turn RLS on and verify on the VPS database |
| Superadmin portal, estate create/suspend/activate | Done (`/platform`, 4 platform roles) | Keep |
| Estate admin, role-based access | Done (ADMIN, SECURITY_ADMIN, FINANCE_ADMIN, GUARD, RESIDENT) | Keep |
| Per-estate rate, currency, unit cap, history | Largely done (custom price, `maxUnits` with DB trigger, `SubscriptionEvent`, `AuditLog`) | Verify; **activate NGN** (currently inactive) |
| Manual payments, paid-through date, countdown | **Missing.** The engine is invoice and dunning based | Build thin prepaid mode (§4) |
| Self-registration, selfie, approval | **Missing.** Admin creates residents only | Build (§5) |
| Audit logs | Done | Keep |
| Push notifications | Done with Firebase FCM | Keep FCM, skip OneSignal (§3) |
| PWA | Partial (vite-plugin-pwa) | Fix API caching (§6) |
| Supabase Auth | Not used | **Skip** (§3) |
| Onboarding a batch of estates | Missing (CSV import is Sprint 4) | Build minimal CSV import |

## 3. Stack decisions (revised: single VPS, portable)

Decision: the pilot runs on **one small VPS**. Later it may move to paid Render, paid Supabase or a bigger VPS, so **nothing in the pilot may depend on a vendor**.

| Docx choice | Decision | Reason |
|---|---|---|
| Vercel (frontend) | **Drop.** Express serves the built client | One deploy, no CORS setup. Vercel Hobby is non-commercial only |
| Render Free | **Drop.** Use the VPS | Free services sleep after 15 minutes idle (Render docs); gate approvals and SOS need an always-on process |
| Supabase (DB, Auth, Storage) | **Drop for the pilot.** Plain PostgreSQL on the VPS | Supabase Free pauses after a week idle and has no automatic backups. Plain Postgres plus Prisma moves to Supabase, Render Postgres or any host with a dump and restore |
| Supabase Auth | **Skip** | Existing JWT login already handles estate code, revocation and lockout |
| Supabase Storage (selfies) | **Private folder on the VPS behind a small storage interface** | Local disk now; switch to an S3-compatible bucket later by changing one adapter. Files served only through authenticated, short-lived URLs |
| OneSignal | **Skip** | Firebase push already works |
| Scheduled jobs | **Keep the in-process, advisory-locked `runOnce()`** | An always-on server makes it reliable. It is already idempotent |

### VPS layout
- Docker Compose with three containers: app (API plus built client), PostgreSQL, and Caddy for automatic HTTPS.
- Postgres reachable only from the app container. Run the app as the `estatium_app` role (NOBYPASSRLS) and set `ENABLE_RLS=true`. Migrations use a separate owner role.
- Firewall allowing only 80, 443 and SSH (key only, no passwords); automatic security updates; fail2ban.
- **Region:** Germany or the wider EU. This serves Germany and Turkey well, and Nigeria, South Africa and India acceptably for a request/response app. It also keeps German residents' data in the EU. Check one real phone from each country before launch.
- **Sizing:** about 2 vCPU and 4 GB RAM is ample for 10 estates plus Postgres. Single instance only, since Socket.IO state is in memory.
- **Backups (not optional):** nightly `pg_dump` plus a copy of the selfie folder to an off-server bucket in a different provider, one restore drill before launch, and a monthly drill after.
- **Monitoring:** health endpoint, an external uptime monitor with alerts, disk-space alert, job heartbeat visible to Superadmin.

### Portability rules (so you can move to paid Render, Supabase or a bigger VPS)
1. No Supabase-, Render- or VPS-specific code. Config comes only from environment variables.
2. Storage and push behind small adapters.
3. Standard Postgres features only; schema changes via numbered SQL or Prisma migrations.
4. Dockerfile plus Compose file in the repo; a written move runbook (dump, restore, change `DATABASE_URL`, DNS cut-over, rollback).
5. A tested restore on a second machine counts as proof the move works.

## 4. Billing: simplify for 10 estates

The existing engine (plans, per-currency plan prices, coupons, proration, credit balance, overage, FX, dunning, auto-invoicing) is built for a self-serve SaaS with thousands of customers. You want to invoice ten estates by hand.

- **Add a billing mode per tenant: `MANUAL_PREPAID`** (pilot default). In this mode the hourly run does not generate invoices or auto-suspend. Nothing is deleted; the engine stays dormant for later.
- **Reuse:** custom price per unit, currency, `maxUnits`, `SubscriptionEvent` (rate history), `PlatformPayment`, `AuditLog`.
- **Add:**
  - On `PlatformPayment`: period from, period to, and paid-through date. These are explicit, never inferred from the amount.
  - Corrections via void and reversal entries, never edits or deletes.
  - **Countdown computed at read time** from the paid-through date, with configurable thresholds (90/60/30 days by default). Statuses: Unpaid (no date, no countdown), Active, Approaching, Due soon, Urgent, Expired. Never stored, so it cannot go stale.
  - A daily job writes a notification at each threshold, deduplicated per estate and threshold.
- **Expiry policy (decided):** after the paid-through date the estate gets a **30-day grace period** with full access and a warning banner. After day 30 it becomes **read-only**: login, viewing and SOS still work, but creating or editing is blocked. There is no automatic deletion and no hard lockout. Paying lifts read-only at once. Superadmin can always recover.
- **Reporting:** show totals per currency, never summed. The `ExchangeRate` table and MRR conversion go unused in the pilot.
- **Unit-limit check:** confirm the DB trigger blocks the 101st unit under concurrent requests, and that lowering the cap below the current count blocks new units without deleting any.

## 5. Resident self-registration (the main new build)

- **Entry:** one invitation code per estate, printed or shared by the admin. This avoids a public list of estates and keeps private data hidden.
- **Public endpoints (rate limited, bot challenge such as Cloudflare Turnstile, which is free):**
  - Validate the code and return the estate name and unoccupied or available unit labels only.
  - Submit the registration.
- **New tenant-scoped table `RegistrationRequest`:** name, email, phone, type (OWNER, TENANT, FAMILY), unit, relationship, selfie path, status (PENDING, APPROVED, REJECTED, NEEDS_INFO), reviewer, reason, timestamps. It gets the same `tenantId`, RLS and scoping as every other model.
- **Approval:** one transaction creates the User and Resident (the existing nested-create pattern in `residents.routes.js`), sets `mustChangePassword`, sends a notification and writes an audit entry. Idempotent, so a double click cannot create two accounts.
- **Selfie:** compressed on the device to about 100 KB, uploaded to a private bucket through the API, shown only via short-lived signed URLs to the estate admin.
- **A selfie is not identity verification.** The admin approves membership, not identity.
- **Family members get their own login (decided).**
  - New role `FAMILY`, linked to a primary resident (`FamilyMember` gains an optional `userId`). Registration needs the named primary's phone or email, and an admin or the primary approves it.
  - Access follows the household: if the primary resident is deactivated or moves out, family logins are suspended.
  - Proposed permissions (please confirm): see and pre-approve visitors for the household, receive parcel alerts, raise SOS and maintenance requests, view notices. **Not allowed:** bills and payments, vehicles, adding or removing family, approving other registrations.
  - Family members do not count as billable units.
- **One person in several estates:** logins are already per estate (unique on tenant plus email), so a person simply has one account per estate. A cross-estate membership table is deferred.

## 5a. Pilot countries: currency, language, privacy

Pilot countries: Nigeria, Germany, South Africa, India, Turkey, plus Brazil (implied by the Brazilian Portuguese requirement; please confirm).

**Billing currency (decided): each estate is billed in its local currency.** Resident dues use the same currency. One currency per estate, so the current data model needs no change.
- Currencies to enable: the 8 already in the system (USD, EUR, GBP, AED, SAR, INR, CAD, AUD) plus **NGN** (exists, inactive), **ZAR**, **TRY** and **BRL** (new). That is 12 in total, so any estate can be set up in any of them.
- Reports show totals per currency, never added together. The exchange-rate table stays unused in the pilot.
- You carry the exchange-rate risk, mostly on NGN and TRY. Revisit the rates per estate at each renewal; every change is already logged.

**Language (decided): English and Brazilian Portuguese (pt-BR).** The app is English only today, so this is real work.
- Client: add a translation layer (one string file per language) and replace the hard-coded text on all 15 pages. Each user has a language setting, and each estate has a default language.
- Server: notification titles and bodies, validation errors and welcome messages are currently written in English in the code. They must become translation keys, rendered in the recipient's language.
- The public registration page must be bilingual, since applicants have no account yet.
- Dates and money already use `Intl` formatting, so they follow the language.
- German, Turkish and Hindi estates see English in the pilot.
- Estimate: about 4 to 6 developer-days plus a native pt-BR review of the text.

**Privacy law:** selfies and contact details are personal data under different laws (Germany: GDPR; Brazil: LGPD; South Africa: POPIA; India: DPDP Act; Nigeria: NDPA; Turkey: KVKK). Plan for a privacy notice and consent text on the registration screen in both languages, a retention rule, and deletion of a resident's data on request. Take legal advice per country; I can't give it.

**Per-estate settings to verify:** timezone (exists on the tenant), country, phone format with country code.

## 6. Hardening before real users

1. **PWA caches authenticated API responses.** `vite.config.js` caches `/api/` for 5 minutes with NetworkFirst, keyed without the user. On a shared phone a different user can be served someone else's cached bills or visitor data when offline. Make API calls network-only and add an offline fallback page. This also meets the docx rule not to cache authenticated data.
2. **Remove the stray `"server"` dependency** from `client/package.json`. It pulled Express, Pug, Hbs, ioredis and Socket.IO into the client's `node_modules`. It is not needed in a React client.
3. **Secrets:** the zip contains `estate-poc/server/.env`. Treat any keys in it as compromised. Rotate Firebase and JWT secrets; the repo roadmap lists this as Sprint 0. Use two different 32+ character secrets for tenant and platform JWTs.
4. **Turn on `ENABLE_RLS=true`** and run the 24 SQL isolation assertions against the pilot database. Add cross-estate tests for every new endpoint.
5. **Backups:** see §3 (off-server nightly dump, restore drill).
6. **Monitoring and server hardening:** see §3.
7. **Realtime:** Socket.IO state is in memory, which is fine for one instance. Do not run two instances in the pilot without a Redis adapter.

## 7. Cut list for the pilot (kept in code, not built or exposed)

Payment gateway, coupon and FX screens, proration UI, invoice PDF and email, tax rules, subdomains and wildcard TLS, per-estate branding, platform-user admin screen, cross-estate membership, one-click GDPR data export (deletion on request is still required, §5a), OneSignal, Supabase Auth, Redis, microservices.

## 8. Pilot plan (about 3 weeks of one developer)

| Step | Work | Exit check |
|---|---|---|
| 0 | Rotate secrets, fix the PWA cache, drop the stray dependency, create the DB role | Secrets rotated; PWA no longer caches `/api` |
| 1 | Deploy to a staging VPS with Docker Compose, RLS on | 52 unit tests and 24 DB assertions pass on real Postgres |
| 2 | Prepaid mode, paid-through, 30-day grace, countdown, 12 currencies | Test scenarios in the docx §16 (subscription, unit limit) pass |
| 3 | Self-registration, approval, selfie, family logins | Register, approve, reject and cross-estate photo access tests pass |
| 4 | CSV import for units and residents, minimal onboarding, English and pt-BR text | A realistic 150-unit estate loads in under 10 minutes |
| 5 | Off-server backups, restore drill on a second machine, monitoring | Restore verified; alert fires on a stopped service |
| 6 | Onboard 2 friendly estates, then the remaining 8 in waves | No cross-tenant leak, no billing surprises for 2 weeks |

**Go or no-go gates:** zero isolation failures; a restore drill passed; SOS and visitor flow tested on a phone in Nigeria on mobile data; every estate has a paid-through date or explicit trial end.

## 9. Decisions

Decided by the owner on 2026-11-20:
1. Small VPS for the pilot; a later move to paid Render, paid Supabase or a bigger VPS is possible.
2. 30-day grace after the paid-through date, then read-only. No automatic deletion and no hard cutoff.
3. Family members get their own logins.
4. Each estate is billed in its local currency; all 12 currencies enabled.
5. Languages: English and Brazilian Portuguese.
6. `Estatium-SAS.zip` is just a backup: ignore it, do not delete it.

Still open:
1. Confirm Brazil is a pilot country (assumed from the language choice).
2. Confirm the family permissions proposed in §5.

## 10. Files expected to change when build starts

Schema and SQL: `server/prisma/schema.prisma`, new `sql/004` (ledger fields, `RegistrationRequest` and RLS).
Server: `modules/platform/billing.service.js`, `platform.routes.js`, `jobs/scheduler.js`, `modules/public/public.routes.js`, new `modules/registration/`, `modules/residents/` (CSV import), `utils/notify.js` (translated messages), `utils/http.js` (error text), `app.js` (serve the client build).
Client: all pages (translation layer), `vite.config.js`, `package.json`, `platform/PlatformApp.jsx` (payments and countdown), new registration and approval pages, `Residents.jsx` (import).
Ops: Dockerfile, Docker Compose and Caddy config, backup script, move runbook, deployment guide.
