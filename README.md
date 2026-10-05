# Estatium — multi-tenant estate management SaaS

Express + Prisma + **PostgreSQL** API, React PWA client, Socket.IO realtime, Firebase push.
Each **estate is a tenant**; a **Super Owner portal** (`/platform`) manages estates, plans, per-unit pricing, invoices and revenue.

Read first: `docs/01-AUDIT.md` → `02-ARCHITECTURE.md` → `03-TEST-CHECKLIST.md` → `04-ROADMAP.md`.

## Quick start
```bash
# 1. PostgreSQL 14+ and two roles (owner + app)
createdb estatium
psql estatium -c "CREATE ROLE estatium_app LOGIN PASSWORD 'change-me' NOBYPASSRLS"
# 2. schema (generated from prisma/schema.prisma by `npm run db:ddl`)
cd server && for f in sql/001_schema.sql sql/002_rls_and_constraints.sql sql/003_seed_reference.sql; do psql estatium -v ON_ERROR_STOP=1 -f $f; done
# 3. config — copy .env.example → .env and fill in TWO different 32+ char secrets
cp .env.example .env
# 4. install, generate client, create your Super Owner
npm install && npx prisma generate
PLATFORM_OWNER_PASSWORD='a-long-Passw0rd!' npm run platform:create-owner you@company.com "You"
# 5. run
npm run dev                       # API :3001
cd ../client && npm install && npm run dev      # app :3000   (Super Owner portal: /platform/login)
```
Create the first estate from the portal ("+ New estate"), or `SEED_DEMO=true node prisma/seed.js` for a throw-away demo estate (random passwords printed once).

## Tests
```bash
cd server && npm test                                   # 52 unit + HTTP-level tests
psql estatium_test -f sql/001… -f sql/002… -f sql/003… && psql estatium_test -f test/db_isolation.test.sql   # 24 DB assertions
```
The HTTP tests use an in-memory Prisma stand-in (`test/helpers/fakePrisma.js`); they prove the logic, not PostgreSQL — see the checklist.

## Migrating the old SQLite estate
See `docs/02-ARCHITECTURE.md` → *Migration plan*. `node scripts/migrate-sqlite-to-postgres.js --sqlite old.db --slug greenville --currency NGN --dry-run`.

## Security notes
No default credentials exist any more. Never commit `.env`. Rotate any secret that was ever committed to the old repo history.
