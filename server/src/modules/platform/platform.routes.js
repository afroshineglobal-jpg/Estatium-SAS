'use strict';
/**
 * Super Owner portal API  —  mounted at /api/platform
 * Auth: separate JWT (secret + audience) from tenant tokens. Every route is permission-checked (permissions.js)
 * and every state-changing action is written to AuditLog.
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const { wrap, bad, notFound, conflict, str, oneOf, money, int, password: validatePassword } = require('../../utils/http');
const { platformAuth, requirePerm: need, login, changeOwnPassword, safe } = require('./platform.auth');
const { ROLE_PERMISSIONS, PERMISSIONS } = require('./permissions');
const T = require('./tenants.service');
const B = require('./billing.service');
const { audit } = require('../../utils/audit');
const { loginLimiter } = require('../../middleware/security');
const { setStatus } = T;
const db = prisma.system;
const page = (q) => { const take = Math.min(Math.max(Number(q.pageSize) || 25, 1), 100); return { take, skip: (Math.max(Number(q.page) || 1, 1) - 1) * take }; };

// ── auth ─────────────────────────────────────────────────────────────────────
router.post('/auth/login', loginLimiter, wrap(login));
router.use(platformAuth);
router.get('/auth/me', (req, res) => res.json({ user: safe(req.platformUser), permissions: ROLE_PERMISSIONS[req.platformUser.role], allPermissions: PERMISSIONS }));
router.post('/auth/password', wrap(changeOwnPassword));

// ── tenants ──────────────────────────────────────────────────────────────────
router.get('/tenants', need('tenants:read'), wrap(async (req, res) => res.json(await T.listTenants({ q: req.query.q, status: req.query.status && oneOf(req.query.status, ['TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'DELETED'], 'status'), page: req.query.page, pageSize: req.query.pageSize }))));

router.post('/tenants', need('tenants:create'), wrap(async (req, res) => {
  const out = await T.createTenant(req.body || {}, req.actor, req);
  if (out.subscription.status === 'ACTIVE') await B.generateInvoice(await B.loadSub(out.tenant.id), { periodStart: out.subscription.currentPeriodStart, periodEnd: out.subscription.currentPeriodEnd });
  res.status(201).json(out);
}));

router.get('/tenants/:id', need('tenants:read'), wrap(async (req, res) => {
  const t = await T.getTenantOrThrow(req.params.id);
  const [stats, invoices, events, estimate] = await Promise.all([
    db.$queryRaw`SELECT * FROM platform_tenant_stats()`,
    db.invoice.findMany({ where: { tenantId: t.id }, orderBy: { issuedAt: 'desc' }, take: 12 }),
    db.subscriptionEvent.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: 'desc' }, take: 25 }),
    ['DELETED'].includes(t.status) ? null : B.estimateNext(t.id).catch(() => null),
  ]);
  res.json({ ...t, usage: stats.find((s) => s.tenantId === t.id) || { units: 0, residents: 0, users: 0 }, invoices, events, nextInvoiceEstimate: estimate });
}));

router.patch('/tenants/:id', need('tenants:update'), wrap(async (req, res) => res.json(await T.updateTenant(req.params.id, req.body || {}, req.actor, req))));
router.post('/tenants/:id/suspend', need('tenants:suspend'), wrap(async (req, res) => res.json(await setStatus(req.params.id, 'SUSPENDED', { reason: str(req.body?.reason, { max: 200, name: 'reason' }) || 'SUSPENDED_BY_PLATFORM', actor: req.actor, req }))));
router.post('/tenants/:id/expire', need('tenants:suspend'), wrap(async (req, res) => res.json(await setStatus(req.params.id, 'EXPIRED', { reason: str(req.body?.reason, { max: 200 }) || 'EXPIRED_BY_PLATFORM', actor: req.actor, req }))));
router.post('/tenants/:id/activate', need('tenants:activate'), wrap(async (req, res) => {
  const t = await T.getTenantOrThrow(req.params.id);
  if (t.status === 'TRIAL') return res.json(await B.convertTrial(t.id, { actor: req.actor, req }));       // first invoice is issued
  const out = await setStatus(t.id, 'ACTIVE', { reason: 'ACTIVATED_BY_PLATFORM', actor: req.actor, req });
  const sub = await B.loadSub(t.id);
  if (sub.currentPeriodEnd <= new Date()) {                                                                  // came back after the period lapsed: start a fresh one
    const now = new Date(); const end = require('../../billing/pricing').addMonths(now, require('../../billing/pricing').monthsIn(sub.billingInterval));
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: now, currentPeriodEnd: end } });
    await B.generateInvoice({ ...sub, currentPeriodStart: now, currentPeriodEnd: end }, { periodStart: now, periodEnd: end, now });
  }
  res.json(out);
}));
router.post('/tenants/:id/restore', need('tenants:delete'), wrap(async (req, res) => res.json(await setStatus(req.params.id, 'SUSPENDED', { reason: 'RESTORED_BY_PLATFORM', actor: req.actor, req }))));
router.delete('/tenants/:id', need('tenants:delete'), wrap(async (req, res) => res.json(await T.deleteTenant(req.params.id, { confirmSlug: req.body?.confirmSlug, actor: req.actor, req }))));
router.post('/tenants/:id/reset-admin-password', need('tenants:update'), wrap(async (req, res) => res.json(await T.resetAdminPassword(req.params.id, req.body?.email, req.actor, req))));

// ── subscription management ──────────────────────────────────────────────────
router.get('/tenants/:id/usage', need('usage:read'), wrap(async (req, res) => res.json(await B.usageHistory(req.params.id, req.query.days))));
router.get('/tenants/:id/estimate', need('subscriptions:read'), wrap(async (req, res) => res.json(await B.estimateNext(req.params.id))));
router.get('/tenants/:id/invoices', need('invoices:read'), wrap(async (req, res) => res.json(await db.invoice.findMany({ where: { tenantId: req.params.id }, orderBy: { issuedAt: 'desc' }, include: { lines: true, payments: true }, take: 100 }))));
router.get('/tenants/:id/events', need('subscriptions:read'), wrap(async (req, res) => res.json(await db.subscriptionEvent.findMany({ where: { tenantId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 100 }))));
router.put('/tenants/:id/plan', need('subscriptions:update'), wrap(async (req, res) => res.json(await B.changePlan(req.params.id, req.body || {}, req.actor, req))));
router.put('/tenants/:id/pricing', need('subscriptions:update'), wrap(async (req, res) => res.json(await B.setPricing(req.params.id, req.body || {}, req.actor, req))));
router.put('/tenants/:id/currency', need('subscriptions:update'), wrap(async (req, res) => res.json(await B.changeCurrency(req.params.id, req.body?.currency, req.actor, req))));
router.post('/tenants/:id/coupons', need('subscriptions:update'), wrap(async (req, res) => res.json(await B.applyCoupon(req.params.id, req.body?.code, req.actor, req))));
router.post('/tenants/:id/cancel', need('subscriptions:update'), wrap(async (req, res) => {
  const sub = await B.loadSub(req.params.id);
  if (req.body?.atPeriodEnd === false) return res.json(await setStatus(req.params.id, 'EXPIRED', { reason: 'CANCELLED_BY_PLATFORM', actor: req.actor, req }));
  const out = await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
  await audit({ req, tenantId: req.params.id, actorType: 'PLATFORM_USER', actorId: req.actor.id, actorEmail: req.actor.email, action: 'SUBSCRIPTION_CANCEL_SCHEDULED', entity: 'Subscription', entityId: sub.id });
  res.json(out);
}));
router.post('/tenants/:id/uncancel', need('subscriptions:update'), wrap(async (req, res) => { const sub = await B.loadSub(req.params.id); res.json(await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } })); }));

// ── invoices ─────────────────────────────────────────────────────────────────
router.get('/invoices', need('invoices:read'), wrap(async (req, res) => {
  const where = { ...(req.query.status ? { status: oneOf(req.query.status, ['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'], 'status') } : {}), ...(req.query.tenantId ? { tenantId: String(req.query.tenantId) } : {}) };
  const [items, total] = await Promise.all([db.invoice.findMany({ where, orderBy: { issuedAt: 'desc' }, ...page(req.query), include: { tenant: { select: { name: true, slug: true } } } }), db.invoice.count({ where })]);
  res.json({ total, items });
}));
router.get('/invoices/:id', need('invoices:read'), wrap(async (req, res) => { const i = await db.invoice.findUnique({ where: { id: req.params.id }, include: { lines: true, payments: true, tenant: { select: { name: true, slug: true } } } }); if (!i) throw notFound('Invoice'); res.json(i); }));
router.post('/invoices/:id/payments', need('invoices:manage'), wrap(async (req, res) => {
  const b = req.body || {};
  res.status(201).json(await B.recordInvoicePayment(req.params.id, { amount: money(b.amount), method: oneOf(b.method || 'MANUAL', ['MANUAL', 'BANK_TRANSFER'], 'method'), reference: str(b.reference, { max: 120 }), actor: req.actor, req }));
}));
router.post('/invoices/:id/void', need('invoices:manage'), wrap(async (req, res) => res.json(await B.voidInvoice(req.params.id, { actor: req.actor, req }))));
router.post('/billing/run', need('invoices:manage'), wrap(async (req, res) => res.json(await B.runBillingCycle(new Date()))));

// ── plans ────────────────────────────────────────────────────────────────────
router.get('/plans', need('plans:read'), wrap(async (req, res) => res.json(await db.plan.findMany({ orderBy: { createdAt: 'asc' }, include: { prices: { orderBy: { currency: 'asc' } }, _count: { select: { subscriptions: true } } } }))));
router.post('/plans', need('plans:manage'), wrap(async (req, res) => {
  const b = req.body || {}; const code = str(b.code, { name: 'code', required: true, max: 40 }).toLowerCase();
  if (!/^[a-z0-9-]+$/.test(code)) throw bad('code: lower-case letters, digits, hyphens');
  const plan = await db.plan.create({ data: { code, name: str(b.name, { name: 'name', required: true, max: 80 }), description: str(b.description, { max: 300 }), pricingModel: oneOf(b.pricingModel || 'PER_UNIT', ['PER_UNIT', 'FLAT'], 'pricingModel'), billingInterval: oneOf(b.billingInterval || 'MONTHLY', ['MONTHLY', 'ANNUAL'], 'billingInterval'), minBillableUnits: int(b.minBillableUnits ?? 0, { name: 'minBillableUnits' }), trialDays: int(b.trialDays ?? 14, { max: 365, name: 'trialDays' }), isPublic: b.isPublic !== false } });
  await audit({ req, actorType: 'PLATFORM_USER', actorId: req.actor.id, actorEmail: req.actor.email, action: 'PLAN_CREATED', entity: 'Plan', entityId: plan.id, after: plan });
  res.status(201).json(plan);
}));
router.put('/plans/:id', need('plans:manage'), wrap(async (req, res) => {
  const b = req.body || {}; const data = {};
  if (b.name !== undefined) data.name = str(b.name, { max: 80, required: true }); if (b.description !== undefined) data.description = str(b.description, { max: 300 });
  if (b.isActive !== undefined) data.isActive = !!b.isActive; if (b.isPublic !== undefined) data.isPublic = !!b.isPublic;
  if (b.minBillableUnits !== undefined) data.minBillableUnits = int(b.minBillableUnits, { name: 'minBillableUnits' }); if (b.trialDays !== undefined) data.trialDays = int(b.trialDays, { max: 365, name: 'trialDays' });
  const out = await db.plan.update({ where: { id: req.params.id }, data });
  await audit({ req, actorType: 'PLATFORM_USER', actorId: req.actor.id, actorEmail: req.actor.email, action: 'PLAN_UPDATED', entity: 'Plan', entityId: out.id, after: data });
  res.json(out);
}));
router.put('/plans/:id/prices', need('plans:manage'), wrap(async (req, res) => {          // body: { prices: [{currency, unitAmount, overageAmount?, flatAmount?}] }
  const list = Array.isArray(req.body?.prices) ? req.body.prices : []; if (!list.length) throw bad('prices[] required');
  const ops = list.map((p) => { const currency = String(p.currency || '').toUpperCase(); const unitAmount = money(p.unitAmount ?? '0', { name: 'unitAmount', allowZero: true });
    const overageAmount = p.overageAmount == null ? null : money(p.overageAmount, { allowZero: true }); const flatAmount = p.flatAmount == null ? null : money(p.flatAmount, { allowZero: true });
    return db.planPrice.upsert({ where: { planId_currency: { planId: req.params.id, currency } }, create: { planId: req.params.id, currency, unitAmount, overageAmount, flatAmount }, update: { unitAmount, overageAmount, flatAmount } }); });
  const out = await db.$transaction(ops);
  await audit({ req, actorType: 'PLATFORM_USER', actorId: req.actor.id, actorEmail: req.actor.email, action: 'PLAN_PRICES_CHANGED', entity: 'Plan', entityId: req.params.id, after: list });
  res.json(out);
}));

// ── coupons ──────────────────────────────────────────────────────────────────
router.get('/coupons', need('coupons:read'), wrap(async (req, res) => res.json(await db.coupon.findMany({ orderBy: { createdAt: 'desc' } }))));
router.post('/coupons', need('coupons:manage'), wrap(async (req, res) => {
  const b = req.body || {}; const type = oneOf(b.type, ['PERCENT', 'FIXED_AMOUNT'], 'type'); const duration = oneOf(b.duration || 'ONCE', ['ONCE', 'REPEATING', 'FOREVER'], 'duration');
  const c = await db.coupon.create({ data: { code: str(b.code, { name: 'code', required: true, max: 40 }).toUpperCase(), name: str(b.name, { name: 'name', required: true, max: 120 }), type,
    percentOff: type === 'PERCENT' ? money(b.percentOff, { name: 'percentOff' }) : null, amountOff: type === 'FIXED_AMOUNT' ? money(b.amountOff, { name: 'amountOff' }) : null, currency: type === 'FIXED_AMOUNT' ? String(b.currency || '').toUpperCase() : null,
    duration, durationMonths: duration === 'REPEATING' ? int(b.durationMonths, { min: 1, max: 60, name: 'durationMonths' }) : null, validUntil: b.validUntil ? new Date(b.validUntil) : null, maxRedemptions: b.maxRedemptions == null ? null : int(b.maxRedemptions, { min: 1, name: 'maxRedemptions' }) } });
  await audit({ req, actorType: 'PLATFORM_USER', actorId: req.actor.id, actorEmail: req.actor.email, action: 'COUPON_CREATED', entity: 'Coupon', entityId: c.id, after: { code: c.code } });
  res.status(201).json(c);
}));
router.put('/coupons/:id', need('coupons:manage'), wrap(async (req, res) => res.json(await db.coupon.update({ where: { id: req.params.id }, data: { isActive: !!req.body?.isActive } }))));

// ── currencies / FX ──────────────────────────────────────────────────────────
router.get('/currencies', need('currencies:read'), wrap(async (req, res) => res.json(await db.currency.findMany({ orderBy: { code: 'asc' } }))));
router.put('/currencies/:code', need('currencies:manage'), wrap(async (req, res) => res.json(await db.currency.update({ where: { code: req.params.code.toUpperCase() }, data: { isActive: !!req.body?.isActive } }))));
router.get('/exchange-rates', need('currencies:read'), wrap(async (req, res) => res.json(await db.exchangeRate.findMany({ orderBy: { asOf: 'desc' }, take: 100 }))));
router.post('/exchange-rates', need('currencies:manage'), wrap(async (req, res) => { const b = req.body || {}; if (!(Number(b.rate) > 0)) throw bad('rate must be > 0'); res.status(201).json(await db.exchangeRate.create({ data: { base: String(b.base).toUpperCase(), quote: String(b.quote).toUpperCase(), rate: String(b.rate), source: 'manual' } })); }));

// ── reporting ────────────────────────────────────────────────────────────────
router.get('/revenue', need('revenue:read'), wrap(async (req, res) => res.json(await B.revenueSummary(String(req.query.currency || 'USD').toUpperCase()))));
router.get('/audit-logs', need('audit:read'), wrap(async (req, res) => {
  const where = { ...(req.query.tenantId ? { tenantId: String(req.query.tenantId) } : {}), ...(req.query.action ? { action: String(req.query.action) } : {}), ...(req.query.actorId ? { actorId: String(req.query.actorId) } : {}) };
  const [items, total] = await Promise.all([db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...page(req.query) }), db.auditLog.count({ where })]);
  res.json({ total, items });
}));

// ── platform users (SUPER_OWNER only) ────────────────────────────────────────
router.get('/users', need('platform_users:manage'), wrap(async (req, res) => res.json((await db.platformUser.findMany({ orderBy: { createdAt: 'asc' } })).map(safe))));
router.post('/users', need('platform_users:manage'), wrap(async (req, res) => {
  const b = req.body || {}; const email = str(b.email, { required: true, max: 200, name: 'email' }).toLowerCase();
  const u = await db.platformUser.create({ data: { email, name: str(b.name, { required: true, max: 120, name: 'name' }), role: oneOf(b.role, ['SUPER_OWNER', 'BILLING_ADMIN', 'SUPPORT', 'READ_ONLY'], 'role'), password: await bcrypt.hash(validatePassword(b.password), 12) } });
  await audit({ req, actorType: 'PLATFORM_USER', actorId: req.actor.id, actorEmail: req.actor.email, action: 'PLATFORM_USER_CREATED', entity: 'PlatformUser', entityId: u.id, after: { email, role: u.role } });
  res.status(201).json(safe(u));
}));
router.patch('/users/:id', need('platform_users:manage'), wrap(async (req, res) => {
  const b = req.body || {}; const data = {};
  if (b.role !== undefined) data.role = oneOf(b.role, ['SUPER_OWNER', 'BILLING_ADMIN', 'SUPPORT', 'READ_ONLY'], 'role');
  if (b.isActive !== undefined) { data.isActive = !!b.isActive; if (!data.isActive) data.tokenVersion = { increment: 1 }; }
  if (req.params.id === req.platformUser.id && (data.isActive === false || (data.role && data.role !== 'SUPER_OWNER'))) throw conflict('You cannot demote or disable yourself', 'SELF_LOCKOUT');
  const u = await db.platformUser.update({ where: { id: req.params.id }, data });
  await audit({ req, actorType: 'PLATFORM_USER', actorId: req.actor.id, actorEmail: req.actor.email, action: 'PLATFORM_USER_UPDATED', entity: 'PlatformUser', entityId: u.id, after: { role: u.role, isActive: u.isActive } });
  res.json(safe(u));
}));

module.exports = router;
