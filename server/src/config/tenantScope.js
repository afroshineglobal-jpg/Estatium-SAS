'use strict';
/**
 * Pure function used by the Prisma client extension (config/prisma.js): forces `tenantId` into every
 * query argument. Unit-tested without a database (test/tenantScope.test.js).
 *
 *  - reads / updates / deletes : tenantId is AND-ed into `where` (a caller-supplied tenantId is overwritten)
 *  - create / createMany / upsert.create : tenantId is stamped onto `data`
 *  - update data can never re-assign tenantId (key removed)
 * NOTE: nested writes (e.g. `payments: { create: {...} }`) are NOT touched — pass tenantId explicitly there.
 *       The NOT NULL column, the RLS WITH CHECK policy and the immutability trigger catch any miss.
 */
const strip = (d) => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return d;
  const { tenantId, tenant, ...rest } = d;      // eslint-disable-line no-unused-vars
  return rest;
};

function injectTenant(operation, args, tenantId) {
  if (!tenantId || typeof tenantId !== 'string') throw new Error('Tenant context missing: refusing to run a tenant-scoped query');
  const a = { ...(args || {}) };
  switch (operation) {
    case 'create':
      a.data = { ...strip(a.data), tenantId };
      break;
    case 'createMany':
    case 'createManyAndReturn':
      a.data = Array.isArray(a.data) ? a.data.map((d) => ({ ...strip(d), tenantId })) : { ...strip(a.data), tenantId };
      break;
    case 'upsert':
      a.where = { ...(a.where || {}), tenantId };
      a.create = { ...strip(a.create), tenantId };
      a.update = strip(a.update);
      break;
    case 'update':
    case 'updateMany':
      a.where = { ...(a.where || {}), tenantId };
      a.data = strip(a.data);
      break;
    case 'findUnique': case 'findUniqueOrThrow': case 'findFirst': case 'findFirstOrThrow': case 'findMany':
    case 'count': case 'aggregate': case 'groupBy': case 'delete': case 'deleteMany':
      a.where = { ...(a.where || {}), tenantId };
      break;
    default:
      throw new Error(`Operation "${operation}" is not allowed on tenant-scoped models`);
  }
  return a;
}

module.exports = { injectTenant };
