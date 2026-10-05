'use strict';
/**
 * Prisma access layer — the heart of tenant isolation.
 *
 *   const prisma = require('../../config/prisma');
 *   prisma.bill.findMany(...)      // route code is unchanged: inside an authenticated request the
 *                                  // exported object transparently resolves to the CURRENT TENANT's client
 *   prisma.system                  // un-scoped client for platform tables, jobs, onboarding (never use in tenant routes)
 *
 * Layers of defence
 *   1. The request's tenantId comes ONLY from the verified JWT (never from a header/query/body).
 *   2. Client extension forces tenantId into every query on the 27 tenant-scoped models (config/tenantScope.js).
 *   3. Outside a tenant context a tenant-scoped model THROWS (deny by default) — no accidental cross-tenant reads.
 *   4. ENABLE_RLS=true additionally sets `app.tenant_id` per query so PostgreSQL row-level security
 *      (sql/002) rejects anything layers 1-3 missed. Connect as the NOBYPASSRLS role `estatium_app`.
 */
const { PrismaClient, Prisma } = require('@prisma/client');
const ctx = require('./tenantContext');
const TENANT_MODELS = require('./tenantModels');
const { injectTenant } = require('./tenantScope');

// Decimal columns must reach the React client as numbers (it calls .toLocaleString() on them).
Prisma.Decimal.prototype.toJSON = function toJSON() { return this.toNumber(); };

const base = new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
const RLS = process.env.ENABLE_RLS === 'true';

// Client for code that is NOT inside a tenant context: tenant models are blocked.
const guarded = base.$extends({
  name: 'deny-tenant-models-without-context',
  query: { $allModels: { async $allOperations({ model, operation, args, query }) {
    if (TENANT_MODELS.has(model)) throw new Error(`Tenant context required for ${model}.${operation}`);
    return query(args);
  } } },
});

const cache = new Map();
function forTenant(tenantId) {
  if (!tenantId) throw new Error('forTenant(): tenantId required');
  const hit = cache.get(tenantId); if (hit) return hit;
  const client = base.$extends({
    name: `tenant-scope`,
    query: { $allModels: { async $allOperations({ model, operation, args, query }) {
      if (!TENANT_MODELS.has(model)) return query(args);
      const scoped = injectTenant(operation, args, tenantId);
      if (!RLS) return query(scoped);
      // Prisma-documented RLS pattern: set the GUC and run the query in the same (batched) transaction.
      const [, result] = await base.$transaction([base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`, query(scoped)]);
      return result;
    } } },
  });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(tenantId, client);
  return client;
}

/** Run `fn` with a tenant context (used by background jobs). */
const withTenant = (tenantId, fn) => ctx.run({ tenantId, db: forTenant(tenantId) }, fn);

const proxy = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'system') return base;
    if (prop === 'forTenant') return forTenant;
    if (prop === 'withTenant') return withTenant;
    if (prop === 'Prisma') return Prisma;
    const target = ctx.get()?.db || guarded;
    const v = target[prop];
    return typeof v === 'function' ? v.bind(target) : v;
  },
});

module.exports = proxy;
