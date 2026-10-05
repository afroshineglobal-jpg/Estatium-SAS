'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const { addMonths, monthsIn } = require('../../billing/pricing');
const { assertTransition, tenantPatchFor, subscriptionStatusFor } = require('../../lifecycle/lifecycle');
const { invalidateTenant } = require('../../middleware/auth.middleware');
const { audit } = require('../../utils/audit');
const { bad, notFound, conflict, str, password: validatePassword } = require('../../utils/http');

const db = prisma.system;
const RESERVED_SLUGS = new Set(['www', 'api', 'admin', 'app', 'platform', 'static', 'assets', 'mail', 'support', 'billing', 'status', 'login', 'estatium']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RETENTION_DAYS = 30;

const actorFields = (actor) => ({ actorType: actor?.type || 'SYSTEM', actorId: actor?.id || null, actorEmail: actor?.email || null });
const tempPassword = () => `${crypto.randomBytes(9).toString('base64url')}Aa1`;   // satisfies the password policy

async function getTenantOrThrow(id) {
  const t = await db.tenant.findUnique({ where: { id }, include: { subscription: { include: { plan: true } } } });
  if (!t) throw notFound('Tenant'); return t;
}

/** Onboarding: tenant + subscription + first ADMIN + default settings, atomically. */
async function createTenant(input, actor, req) {
  const name = str(input.name, { name: 'name', min: 2, max: 120, required: true });
  const slug = str(input.slug, { name: 'slug', required: true }).toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) throw bad('slug must be 3-40 chars: lower-case letters, digits, hyphens (not reserved)');
  const adminEmail = str(input.adminEmail, { name: 'adminEmail', max: 200, required: true }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) throw bad('adminEmail is not a valid email');
  const adminName = str(input.adminName, { name: 'adminName', max: 120 }) || 'Estate Admin';

  const [exists, currency, plan] = await Promise.all([
    db.tenant.findUnique({ where: { slug } }),
    db.currency.findUnique({ where: { code: String(input.currency || '').toUpperCase() } }),
    db.plan.findFirst({ where: { OR: [{ id: String(input.planId || '') }, { code: String(input.planCode || '') }], isActive: true }, include: { prices: true } }),
  ]);
  if (exists) throw conflict('That slug is already in use', 'SLUG_TAKEN');
  if (!currency || !currency.isActive) throw bad('Unsupported or inactive currency');
  if (!plan) throw notFound('Plan');
  const hasPrice = plan.prices.some((p) => p.currency === currency.code) || input.customUnitAmount || input.customFlatAmount;
  if (!hasPrice) throw bad(`Plan "${plan.code}" has no ${currency.code} price — add one or provide a custom price`);

  const now = new Date();
  const active = input.startAsActive === true;
  const trialDays = Number.isInteger(input.trialDays) ? input.trialDays : plan.trialDays;
  const trialEndsAt = active ? null : new Date(now.getTime() + trialDays * 86400000);
  const interval = input.billingInterval === 'ANNUAL' ? 'ANNUAL' : plan.billingInterval;
  const periodEnd = active ? addMonths(now, monthsIn(interval)) : trialEndsAt;
  const pw = input.adminPassword ? validatePassword(input.adminPassword) : tempPassword();
  const hash = await bcrypt.hash(pw, 12);
  const id = crypto.randomUUID();
  const status = active ? 'ACTIVE' : 'TRIAL';

  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;      // needed when connected as the RLS-bound role
    const tenant = await tx.tenant.create({ data: {
      id, slug, name, status, currency: currency.code, timezone: input.timezone || 'UTC', country: input.country || null,
      contactName: input.contactName || null, contactEmail: input.contactEmail || adminEmail, contactPhone: input.contactPhone || null, address: input.address || null,
      trialEndsAt, activatedAt: active ? now : null,
    } });
    const subscription = await tx.subscription.create({ data: {
      tenantId: id, planId: plan.id, status, currency: currency.code, billingInterval: interval,
      customUnitAmount: input.customUnitAmount ?? null, customOverageAmount: input.customOverageAmount ?? null, customFlatAmount: input.customFlatAmount ?? null,
      committedUnits: input.committedUnits ?? null, maxUnits: input.maxUnits ?? null, contractReference: input.contractReference || null,
      trialEndsAt, currentPeriodStart: now, currentPeriodEnd: periodEnd,
    } });
    await tx.subscriptionEvent.create({ data: { subscriptionId: subscription.id, tenantId: id, type: 'CREATED', data: { plan: plan.code, currency: currency.code, status }, ...actorFields(actor) } });
    await tx.user.create({ data: { tenantId: id, email: adminEmail, password: hash, role: 'ADMIN', name: adminName, mustChangePassword: true } });
    await tx.setting.createMany({ data: [
      { tenantId: id, key: 'estate_name', value: name }, { tenantId: id, key: 'estate_address', value: input.address || '' },
      { tenantId: id, key: 'visitor_auto_expire_hours', value: '24' }, { tenantId: id, key: 'max_family_members', value: '15' },
    ] });
    return { tenant, subscription };
  }, { timeout: 20000 });

  await audit({ req, tenantId: id, ...actorFields(actor), action: 'TENANT_CREATED', entity: 'Tenant', entityId: id, after: { slug, plan: plan.code, currency: currency.code, status } });
  return { ...result, admin: { email: adminEmail, name: adminName }, temporaryPassword: input.adminPassword ? undefined : pw };
}

async function updateTenant(id, patch, actor, req) {
  const before = await getTenantOrThrow(id);
  const data = {};
  if (patch.name !== undefined) data.name = str(patch.name, { name: 'name', min: 2, max: 120, required: true });
  for (const k of ['contactName', 'contactEmail', 'contactPhone', 'address', 'country', 'timezone']) if (patch[k] !== undefined) data[k] = str(patch[k], { name: k, max: 200 });
  if (!Object.keys(data).length) throw bad('Nothing to update');
  const after = await db.tenant.update({ where: { id }, data });
  invalidateTenant(id);
  await audit({ req, tenantId: id, ...actorFields(actor), action: 'TENANT_UPDATED', entity: 'Tenant', entityId: id, before: Object.fromEntries(Object.keys(data).map((k) => [k, before[k]])), after: data });
  return after;
}

/** The ONLY place a tenant's status changes (validated state machine + subscription mirror + audit). */
async function setStatus(id, to, { reason = null, actor, req, now = new Date() } = {}) {
  const t = await getTenantOrThrow(id);
  assertTransition(t.status, to, { purged: !!t.purgedAt });
  const ops = [db.tenant.update({ where: { id }, data: tenantPatchFor(to, { now, reason, retentionDays: RETENTION_DAYS }) })];
  if (t.subscription) {
    const subStatus = subscriptionStatusFor(to);
    ops.push(db.subscription.update({ where: { id: t.subscription.id }, data: { status: subStatus, ...(subStatus === 'CANCELLED' ? { cancelledAt: now } : {}) } }));
    ops.push(db.subscriptionEvent.create({ data: { subscriptionId: t.subscription.id, tenantId: id, type: 'STATUS_CHANGED', data: { from: t.status, to, reason }, ...actorFields(actor) } }));
  }
  const [tenant] = await db.$transaction(ops);
  invalidateTenant(id);
  await audit({ req, tenantId: id, ...actorFields(actor), action: `TENANT_${to}`, entity: 'Tenant', entityId: id, before: { status: t.status }, after: { status: to, reason } });
  return tenant;
}

/** Soft delete (30-day retention, restorable) — requires typing the slug to confirm. */
async function deleteTenant(id, { confirmSlug, actor, req }) {
  const t = await getTenantOrThrow(id);
  if (confirmSlug !== t.slug) throw bad('Type the tenant slug to confirm deletion', 'CONFIRMATION_REQUIRED');
  return setStatus(id, 'DELETED', { reason: 'DELETED_BY_PLATFORM', actor, req });
}

async function listTenants({ q, status, page = 1, pageSize = 25 } = {}) {
  const where = { ...(status ? { status } : {}), ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }, { contactEmail: { contains: q, mode: 'insensitive' } }] } : {}) };
  const take = Math.min(Math.max(Number(pageSize) || 25, 1), 100); const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const [rows, total, stats] = await Promise.all([
    db.tenant.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { subscription: { include: { plan: { select: { code: true, name: true } } } } } }),
    db.tenant.count({ where }),
    db.$queryRaw`SELECT * FROM platform_tenant_stats()`,
  ]);
  const byId = new Map(stats.map((s) => [s.tenantId, s]));
  return { total, page: Number(page) || 1, pageSize: take, items: rows.map((t) => ({ ...t, usage: byId.get(t.id) || { units: 0, residents: 0, users: 0 } })) };
}

/** Support tool: issue a new temporary password for a tenant admin (forces change at next login, revokes old tokens). */
async function resetAdminPassword(tenantId, adminEmail, actor, req) {
  const t = await getTenantOrThrow(tenantId);
  const pw = tempPassword(); const hash = await bcrypt.hash(pw, 12);
  const email = String(adminEmail || '').toLowerCase();
  const n = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const r = await tx.user.updateMany({ where: { tenantId, email, role: 'ADMIN' }, data: { password: hash, mustChangePassword: true, tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null } });
    return r.count;
  });
  if (!n) throw notFound('Admin user');
  await audit({ req, tenantId, ...actorFields(actor), action: 'TENANT_ADMIN_PASSWORD_RESET', entity: 'User', after: { email, tenant: t.slug } });
  return { email, temporaryPassword: pw };
}

module.exports = { resetAdminPassword, createTenant, updateTenant, setStatus, deleteTenant, listTenants, getTenantOrThrow, RESERVED_SLUGS, SLUG_RE, RETENTION_DAYS };
