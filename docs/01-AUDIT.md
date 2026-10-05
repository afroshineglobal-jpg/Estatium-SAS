# Estatium — System Audit (original code, branch `main` @ b6f1756)

Scope: every file under `server/src`, `server/prisma`, `client/src` and the repo root. Line numbers refer to the **original** files.
Verified items were reproduced by reading the code path; "untested" means not exercised at runtime. Status column = what the `feature/multi-tenant-saas` branch does about it.

## Architecture summary
| Area | Original state |
|---|---|
| Frontend | React 18 + Vite + Tailwind PWA, 14 pages, Axios, context-based auth/socket, no state library, no code-splitting (one 500 kB+ chunk) |
| Backend | Express 4, one `*.routes.js` per module, Prisma 5, Socket.IO, Firebase push; no service layer, no validation layer, no tests |
| Database | SQLite via Prisma; money as `Float`; enums as free strings; poll votes as JSON text; only unique indexes |
| Auth | bcrypt (cost 12) + HS256 JWT, 7 days, no revocation, no rate limit, role claim re-read from DB (good) |
| Deployment | `npm run dev` only; no Dockerfile/CI; **secrets and a database committed to git** |
| Duplicates | `estate-poc/` is a stale copy of `server/` + `client/`; a 138 kB zip of it is also committed |

## CRITICAL
| # | File : line | Issue | Business impact | Fix | Status |
|---|---|---|---|---|---|
| C1 | `server/.env` (tracked), `estate-poc/server/.env` | Firebase service-account **private key** + client email + a placeholder-style `JWT_SECRET` are committed (and the repo is now public) | Anyone can send pushes as you and forge admin JWTs (payload is just `{userId, role}` and user ids are in the committed DB) | Revoke the Firebase key, rotate JWT secret, purge from history (`git filter-repo`), `.gitignore` `.env` | Files removed + `.gitignore` + `.env.example`; **history purge and key revocation are yours to do** |
| C2 | `server/prisma/estate.db` (tracked) | Production-shaped database committed: 10 users (bcrypt hashes of the **README-published** demo passwords), phones, visitor photo | Account takeover (`admin@estate.com / Admin@123` is in the README) and personal-data exposure | Delete, purge history, never ship demo creds | Removed; seed now generates random passwords; migration flags `mustChangePassword` |
| C3 | `billing.routes.js:66-82` | `POST /billing/:id/pay` allows role `RESIDENT`, never checks the bill belongs to the caller, accepts any `amount` (no positivity/NaN check) and flips the bill to PAID | Any resident can mark any bill (theirs or a neighbour's) paid without paying | Staff-only manual receipts; online payment only via a verified gateway webhook | Fixed (`billing.routes.js`) |
| C4 | `app.js:82-119` | `POST /api/send-notification` is unauthenticated and sends arbitrary FCM messages | Phishing/spam through your Firebase project | Remove | Removed |
| C5 | `app.js:55-78`, `useSocket.jsx:92-94` | Socket.IO has no auth; any client may `join-room` any room, `emergency-sos` is re-broadcast to **all** clients, `send-message` to any room | Fake SOS to the whole estate; eavesdropping on chat; cross-tenant leak once multi-tenant | Authenticate the handshake, server-side room membership, drop client-originated broadcasts | Fixed (`realtime.js`) |
| C6 | `visitors.routes.js:88` | `io.emit('visitor-decision', {entryCode})` broadcasts the visitor entry code to every connected socket | Anyone listening can walk in with a valid code | Emit only to the resident's room; guards get the decision without the code | Fixed |
| C7 | `visitors.routes.js:94-109, 7` | `verify-code` open to every authenticated user incl. residents, no rate limit, 5-digit codes from `Math.random` (90 000 combinations), codes never expire | Brute-forcing entry codes from a resident account | 6-digit `crypto.randomInt`, gate roles only, rate limit, expiry | Fixed |
| C8 | `residents.routes.js:53,63` | Role taken from the request body: a `FINANCE_ADMIN` (allowed to call this) can create an `ADMIN` | Privilege escalation | Always create `RESIDENT` | Fixed |
| C9 | `auth.routes.js:8-26`, `package.json` | No login rate limiting (`express-rate-limit` is installed but never used) and no lockout | Credential stuffing / brute force of the published demo accounts | Limiter + per-account lockout + equalised timing | Fixed |
| C10 | `app.js:21,27` | CORS `origin: '*'` with `credentials: true`; Helmet CSP disabled | Any website can call the API with a victim's token if it is ever cookie-based; weak default posture | Explicit allow-list | Fixed |

## HIGH
| # | File : line | Issue | Impact | Fix | Status |
|---|---|---|---|---|---|
| H1 | `residents.routes.js:79-97, 113-134` | Any logged-in user can read any resident (incl. bills, vehicles, family) and add/remove family members of any resident (`DELETE …/members/:memberId` ignores `:id`) | Neighbour data exposure and tampering | Ownership check: staff or self only | Fixed |
| H2 | `residents.routes.js:28-38` | `/units` returns every resident's name+phone to every role | Resident privacy | Names only for staff | Fixed |
| H3 | `visitors.routes.js:78-91` | `PUT /:id/approve` does not check the visitor belongs to the caller; any resident can approve/deny anyone's visitors, and re-approval regenerates codes | Gate decisions taken by strangers | Own household only, only while PENDING | Fixed |
| H4 | `parcels.routes.js:10-22, 41-55` | A resident without a profile gets **all parcels**; `collect` is open to any user and the OTP check is skipped when `otp` is null; OTP stored in plaintext, 6 digits via `Math.random`, no attempt limit | Parcel theft, data leak | Own unit only, HMAC-hashed OTP, 5-attempt lock | Fixed |
| H5 | `emergency.routes.js:6-14, 36-46` | Any user lists all emergency reports (with reporters' phones) and any user can resolve any report | Privacy + sabotage of safety workflow | Responders only | Fixed |
| H6 | `emergency.routes.js:28-30` | Three sequential `notifyByRole` loops (each does N awaited DB+FCM calls) **before** the response | SOS latency grows with staff count — worst possible place to be slow | Respond first, fan out async, batch inserts | Fixed |
| H7 | `staff.routes.js:21` | Every staff type (cleaner, gardener…) is created with role `GUARD`, i.e. gate permissions; password hard-coded `Staff@123`; any user can update any task / log attendance | Gate access for non-security staff; known default password | New `STAFF` role, random temp password, ownership checks | Fixed |
| H8 | `amenities.routes.js:40-48` | `{...req.body}` mass-assignment into `amenity.update` | Arbitrary field overwrite (e.g. `id`, `isActive`) | Whitelist | Fixed |
| H9 | `amenities.routes.js:112-139` | Overlap check is read-then-insert (race); no past-date/length checks; `hours` from `new Date("2000-01-01T…")` can be `NaN` → `NaN` price saved | Double-booked facilities, corrupt prices | DB exclusion constraint + validation | Fixed (`amenity_booking_no_overlap`) |
| H10 | `amenities.routes.js:152-157`, `maintenance.routes.js:37-42` | A bill is created **every time** an approval / completion update is saved | Residents double-billed | Idempotent bills keyed on `(sourceType, sourceId)` | Fixed |
| H11 | `maintenance.routes.js:31-35` | `estimatedCost/actualCost` default to `null` when absent → **every status change wipes the costs** | Lost financial data | Update only supplied fields | Fixed |
| H12 | `billing.routes.js:98-104` | `PUT /billing/:id` lets staff set any status (e.g. PAID with no payment) and any value | Books can be falsified silently | Only WAIVED/VOID; PAID only via payments | Fixed |
| H13 | `schema.prisma:174,186,136,…` | Money stored as `Float` | Rounding drift in totals (e.g. 0.1+0.2) | `Decimal(14,2)`; integer minor units in code | Fixed |
| H14 | `auth.routes.js:19,59-71`; `auth.middleware.js:11` | JWT valid 7 days, no revocation, `jwt.verify` without `algorithms`; password change has no policy and does not invalidate tokens; no logout-all | Stolen tokens live a week | 8 h, `tokenVersion`, algorithm + audience pinned, policy | Fixed |
| H15 | `client/src/utils/api.js:10`, `useAuth.jsx:53` | JWT in `localStorage` | Any XSS = full account takeover | httpOnly cookie + CSRF token (Sprint 4) | **Open** (mitigated by 8 h expiry, revocation, CSP) |

## MEDIUM
| # | File : line | Issue | Fix | Status |
|---|---|---|---|---|
| M1 | `firebaseAdmin.js` + `utils/firebase.js:12` | Firebase initialised twice → second `initializeApp` throws "already exists", caught, returns `null` → **push notifications never sent** | Single init, reuse `admin.app()` | Fixed |
| M2 | `billing.routes.js:46-63` | Bulk billing: N sequential create+notify, not idempotent (double click = double bills), no transaction | One `createMany`, `skipDuplicates`, idempotency key | Fixed |
| M3 | nothing sets `OVERDUE` (`grep` finds only the read in `billing.routes.js:91`) | Overdue filter/summary is always 0 | Daily job | Fixed (`jobs/scheduler.js`) |
| M4 | `analytics.routes.js:20-31` | "Collected" = sum of bills flagged PAID (spoofable, see C3); occupancy from `isOccupied` which is never cleared on move-out; 7 sequential queries for trends | Derive from payments/residents, one query | Fixed |
| M5 | `communication.routes.js:34-43` | Any user reads any chat room incl. `unit-*`; notices ignore `expiresAt`; poll vote is read-modify-write on JSON (race, any `optionIndex`) | Room access rules, `PollVote` table with unique(poll,user) | Fixed |
| M6 | `residents.routes.js:143,159-168` | Units created in a loop of awaits; next unit number from a **string** sort (breaks after 999) | `createMany`, numeric max | Fixed |
| M7 | `vehicles.routes.js:28-30` | `plateNumber.toUpperCase()` before validation → `TypeError` → 500; resident without profile sees all vehicles | Validate; own vehicles only | Fixed |
| M8 | `advertisements.routes.js:18-27,37-48` | Any user can create ads; `linkUrl` unvalidated (`javascript:`); impression/click endpoints unauthenticated | Validate URLs; require auth; rate limit | Fixed |
| M9 | `settings.routes.js:14-22` | Arbitrary keys; currency is free text | Whitelist; currency is a tenant property | Fixed |
| M10 | all routes | `res.status(500).json({error: err.message})` leaks Prisma messages; no input validation | Central error handler + validators | Fixed |
| M11 | `visitors.routes.js:126-145` | Entry/exit transitions are check-then-update (two guards can both admit) | Conditional `updateMany` | Fixed |
| M12 | `schema.prisma` | `Parcel.unitId`, `Notice.postedById`, `MaintenanceRequest.assignedToId` have no relation/FK; enums are strings; no secondary indexes | Relations, enums, composite indexes | Fixed (except `assignedToId`/`postedById` kept as plain ids) |

## LOW
| # | Where | Issue | Status |
|---|---|---|---|
| L1 | `Login.jsx:23` | Failed login shows nothing (error swallowed; 401 handler reloads the page) | Fixed |
| L2 | `Login.jsx:69-84` | Demo credentials rendered in the UI | Removed |
| L3 | ~25 places in `client/src/pages/*` | Currency symbol `₦` hard-coded | Fixed (`utils/money.js`) |
| L4 | `main.jsx` | Asks for notification permission on page load; logs the FCM token to the console | **Open** |
| L5 | `client/dev-dist/` committed; `estate-poc/` + zip duplicate | Removed |
| L6 | `package.json` | `express-validator`, `multer`, `uuid` unused (multer 1.x is deprecated upstream) | Removed |
| L7 | `vite.config.js` | Single 500 kB+ bundle; no route-level code splitting | **Open** |
| L8 | no tests / CI / Dockerfile | Now 76 automated checks; CI and Docker **open** |

## Dependency review
`express 4.18`, `helmet 7`, `jsonwebtoken 9`, `bcryptjs 2`, `prisma 5.10` are current enough — run `npm audit` on your side (the sandbox registry mirror blocked part of the tree). `firebase-admin ^12.7` is fine. `package-lock.json` resolves some packages from `registry.npmmirror.com`: regenerate it against the official registry.

## Database review (SQLite → PostgreSQL)
SQLite allows a single writer, so 100+ households with push fan-out will queue; there was no FK enforcement for four relations, no `CHECK`s, and booleans/dates stored as integers/epoch-ms (the migration script converts them). See `02-ARCHITECTURE.md` for the new model.
