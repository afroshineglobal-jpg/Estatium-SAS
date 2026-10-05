# Implementation roadmap (5 sprints)

Effort in ideal engineer-days for one full-stack developer. **Done** = already on the branch.

## Sprint 0 — Today (½ day, you)
Revoke the Firebase key and rotate `JWT_SECRET`; make the repo private; purge `.env`, `estate.db`, zip from git history; regenerate `package-lock.json` from the official registry; apply the branch.

## Sprint 1 — Foundation & isolation (5 d)  — *mostly done*
Files: `server/prisma/schema.prisma`, `server/sql/001–003`, `src/config/{env,prisma,tenantScope,tenantContext,tenantModels}.js`, `src/middleware/*`, `src/modules/auth`, `scripts/*`. DB: new schema. API: login with estate. UI: login. **Remaining:** run on real Prisma+PG with `ENABLE_RLS=true` (1 d), Dockerfile + CI running the three test suites (1 d), CSP for the client.

## Sprint 2 — Hardening of the 14 modules (5 d) — *code done, needs real-DB verification*
Files: every `modules/*/*.routes.js`, `realtime.js`, `utils/*`. Remaining: manual pass of the ☐ items in `03-TEST-CHECKLIST.md`; Prisma-backed integration tests (replace the in-memory fake); move JWT to httpOnly cookie + CSRF (2 d); request-ID logging.

## Sprint 3 — Subscription engine & Super Owner (6 d) — *backend done, UI partial*
Files: `src/billing/*`, `modules/platform/*`, `jobs/scheduler.js`, `client/src/platform/*`. Remaining: platform-user/coupon/FX/usage-chart screens (2 d); invoice PDF + email (2 d); tax per country (1 d); dunning emails (1 d); end-to-end billing-cycle test on PostgreSQL with a fake clock (1 d).

## Sprint 4 — Tenant experience & ops (5 d)
Tenant onboarding wizard (Property level, import units/residents from CSV), per-tenant branding, sub-domain routing + wildcard TLS, backups/PITR, monitoring (health, job heartbeat), data export for tenants (GDPR), code-splitting the client, notification permission UX.

## Sprint 5 — Payment gateway (5 d)
Provider-agnostic `PaymentProvider` interface (`createCheckout`, `verifyWebhook`, `refund`). Two flows: **(a)** tenants pay SaaS invoices (`PlatformPayment` already has `provider/providerRef`, unique per provider ref ⇒ idempotent webhooks; `recordInvoicePayment()` is the single entry point and auto-reactivates suspended tenants); **(b)** residents pay dues online (`Payment.provider/providerRef`, one connected account per estate, or platform-collected with payout reports). Webhook route with raw-body signature check, replay protection, amount/currency match, 3-state reconcile job. Decide: Stripe / Razorpay / Paystack / Flutterwave per currency (INR→Razorpay, NGN→Paystack are common choices; Stripe covers most of the 8 currencies).

## Definition of done for go-live
All ☐ in the checklist reviewed · pen-test of auth + tenant isolation · restore drill · secrets rotated · RLS on · PgBouncer + 2 app instances tested · runbook for suspension/deletion/restore.
