'use strict';
/** Pure tenant / subscription lifecycle rules (unit-tested, no I/O). */
const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'DELETED'];

const TRANSITIONS = {
  TRIAL:     ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'DELETED'],
  ACTIVE:    ['SUSPENDED', 'EXPIRED', 'DELETED'],
  SUSPENDED: ['ACTIVE', 'EXPIRED', 'DELETED'],
  EXPIRED:   ['ACTIVE', 'SUSPENDED', 'DELETED'],
  DELETED:   ['SUSPENDED'],                      // restore (only inside the retention window, never after purge)
};

class LifecycleError extends Error { constructor(code, message) { super(message); this.code = code; this.status = 409; } }

function assertTransition(from, to, { purged = false } = {}) {
  if (!TENANT_STATUSES.includes(to)) throw new LifecycleError('BAD_STATUS', `Unknown status ${to}`);
  if (from === to) throw new LifecycleError('NO_CHANGE', `Tenant is already ${from}`);
  if (from === 'DELETED' && purged) throw new LifecycleError('PURGED', 'Tenant data has been erased and cannot be restored');
  if (!TRANSITIONS[from]?.includes(to)) throw new LifecycleError('BAD_TRANSITION', `Cannot go from ${from} to ${to}`);
  return true;
}

/** Subscription status that mirrors a tenant status. */
const subscriptionStatusFor = (tenantStatus) => (tenantStatus === 'DELETED' ? 'CANCELLED' : tenantStatus);

/** Fields to update on the Tenant row for a status change. */
function tenantPatchFor(to, { now = new Date(), reason = null, retentionDays = 30 } = {}) {
  const patch = { status: to };
  if (to === 'ACTIVE')    Object.assign(patch, { activatedAt: now, suspendedAt: null, suspendedReason: null, expiredAt: null, deletedAt: null, purgeAfter: null });
  if (to === 'SUSPENDED') Object.assign(patch, { suspendedAt: now, suspendedReason: reason, deletedAt: null, purgeAfter: null });
  if (to === 'EXPIRED')   Object.assign(patch, { expiredAt: now });
  if (to === 'DELETED')   Object.assign(patch, { deletedAt: now, purgeAfter: new Date(now.getTime() + retentionDays * 86400000) });
  return patch;
}

/** What a tenant may do right now. Returns { allow } or { allow:false, status, code, message }. */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALWAYS_OK = [/^\/api\/auth(\/|$)/, /^\/api\/subscription(\/|$)/, /^\/api\/public(\/|$)/, /^\/api\/health$/];
function evaluateAccess(tenant, now, method, path) {
  let status = tenant.status;
  if (status === 'TRIAL' && tenant.trialEndsAt && now > new Date(tenant.trialEndsAt)) status = 'EXPIRED';   // lazy expiry between job runs
  if (status === 'DELETED') return { allow: false, status: 410, code: 'TENANT_DELETED', message: 'This estate account has been deleted.' };
  if (status === 'TRIAL' || status === 'ACTIVE') return { allow: true, effectiveStatus: status };
  if (ALWAYS_OK.some((re) => re.test(path))) return { allow: true, effectiveStatus: status };
  if (status === 'SUSPENDED') {
    if (SAFE.has(method)) return { allow: true, effectiveStatus: status, readOnly: true };
    if (method === 'POST' && /^\/api\/emergency\/?$/.test(path)) return { allow: true, effectiveStatus: status, readOnly: true };   // SOS must always work
    return { allow: false, status: 403, code: 'TENANT_SUSPENDED', message: 'This estate account is suspended (read-only). Contact your administrator.' };
  }
  return { allow: false, status: 402, code: 'TENANT_EXPIRED', message: 'This estate subscription has expired. Please renew to continue.' };
}

module.exports = { TENANT_STATUSES, TRANSITIONS, LifecycleError, assertTransition, subscriptionStatusFor, tenantPatchFor, evaluateAccess };
