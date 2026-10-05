'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const env = require('../../config/env');
const { authenticate } = require('../../middleware/auth.middleware');
const { loginLimiter } = require('../../middleware/security');
const { signTenantToken } = require('../../utils/tokens');
const { wrap, bad, HttpError, password: validatePassword } = require('../../utils/http');
const { audit } = require('../../utils/audit');

const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', 12);
const MAX_FAILS = 5, LOCK_MINUTES = 15;
const safeUser = ({ password, fcmToken, failedLogins, lockedUntil, ...u }) => u;          // eslint-disable-line no-unused-vars
const publicTenant = (t, access) => ({ id: t.id, slug: t.slug, name: t.name, currency: t.currency, timezone: t.timezone, status: access?.effectiveStatus || t.status, readOnly: !!access?.readOnly, trialEndsAt: t.trialEndsAt });

/** Tenant is chosen by (in order): body.tenant, X-Tenant header, or the sub-domain when TENANT_BASE_DOMAIN is set. */
function resolveSlug(req) {
  const explicit = req.body?.tenant || req.headers['x-tenant'];
  if (explicit) return String(explicit).trim().toLowerCase();
  if (env.TENANT_BASE_DOMAIN && req.hostname.endsWith('.' + env.TENANT_BASE_DOMAIN)) return req.hostname.slice(0, -(env.TENANT_BASE_DOMAIN.length + 1)).split('.').pop();
  return null;
}

// POST /api/auth/login   { tenant, email, password }
router.post('/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const slug = resolveSlug(req);
  if (!slug || typeof email !== 'string' || typeof password !== 'string') throw bad('Estate, email and password are required');
  const invalid = () => new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');       // same answer for unknown estate / user / password

  const tenant = await prisma.system.tenant.findUnique({ where: { slug } });
  if (!tenant || tenant.status === 'DELETED') { await bcrypt.compare(password, DUMMY_HASH); throw invalid(); }
  const db = prisma.forTenant(tenant.id);
  const user = await db.user.findFirst({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.isActive) { await bcrypt.compare(password, DUMMY_HASH); throw invalid(); }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new HttpError(423, 'Account temporarily locked. Try again later.', 'LOCKED');

  if (!(await bcrypt.compare(password, user.password))) {
    const u = await db.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } });
    if (u.failedLogins >= MAX_FAILS) await db.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000), failedLogins: 0 } });
    throw invalid();
  }
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit({ req, tenantId: tenant.id, actorType: 'TENANT_USER', actorId: user.id, actorEmail: user.email, action: 'LOGIN' });
  res.json({ token: signTenantToken(user, tenant), user: safeUser(user), tenant: publicTenant(tenant), mustChangePassword: user.mustChangePassword });
}));

// GET /api/auth/me
router.get('/me', authenticate, wrap(async (req, res) => {
  let extra = {};
  if (req.user.role === 'RESIDENT') extra = { resident: await prisma.resident.findFirst({ where: { userId: req.user.id }, include: { unit: { include: { block: true } } } }) };
  res.json({ ...safeUser(req.user), tenant: publicTenant(req.tenant, req.tenantAccess), ...extra });
}));

router.put('/fcm-token', authenticate, wrap(async (req, res) => {
  const t = req.body?.fcmToken; if (typeof t !== 'string' || t.length > 4096) throw bad('fcmToken must be a string');
  await prisma.user.update({ where: { id: req.user.id }, data: { fcmToken: t } });
  res.json({ success: true });
}));

// PUT /api/auth/password — policy enforced, all existing tokens revoked, a fresh token is returned
router.put('/password', authenticate, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!(await bcrypt.compare(String(currentPassword || ''), req.user.password))) throw bad('Current password incorrect');
  validatePassword(newPassword);
  if (currentPassword === newPassword) throw bad('New password must be different');
  const u = await prisma.user.update({ where: { id: req.user.id }, data: { password: await bcrypt.hash(newPassword, 12), mustChangePassword: false, tokenVersion: { increment: 1 } } });
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: u.id, actorEmail: u.email, action: 'PASSWORD_CHANGED' });
  res.json({ success: true, token: signTenantToken(u, req.tenant) });
}));

// POST /api/auth/logout-all — revoke every token issued to this user (lost phone, shared device)
router.post('/logout-all', authenticate, wrap(async (req, res) => {
  await prisma.user.update({ where: { id: req.user.id }, data: { tokenVersion: { increment: 1 } } });
  res.json({ success: true });
}));

router.get('/notifications', authenticate, wrap(async (req, res) => res.json(await prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }))));
router.put('/notifications/read', authenticate, wrap(async (req, res) => { await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } }); res.json({ success: true }); }));

module.exports = router;
