'use strict';
const prisma = require('../config/prisma');
const ctx = require('../config/tenantContext');
const { verifyTenantToken } = require('../utils/tokens');
const { evaluateAccess } = require('../lifecycle/lifecycle');

// Tenant rows are read on every request -> tiny TTL cache; platform actions call invalidateTenant().
const cache = new Map(); const TTL = 15000;
async function getTenant(id) {
  const hit = cache.get(id); if (hit && Date.now() - hit.at < TTL) return hit.tenant;
  const tenant = await prisma.system.tenant.findUnique({ where: { id }, select: { id: true, slug: true, name: true, status: true, currency: true, timezone: true, trialEndsAt: true } });
  cache.set(id, { at: Date.now(), tenant }); return tenant;
}
const invalidateTenant = (id) => { if (id) cache.delete(id); else cache.clear(); };

/**
 * 1. verifies the JWT (HS256, audience "tenant")           4. checks token version (revocation) + active user
 * 2. loads the tenant and applies the lifecycle gate       5. opens the tenant context for the rest of the request:
 * 3. loads the user THROUGH the tenant-scoped client          from here on `prisma.*` is automatically tenant-scoped
 */
const authenticate = async (req, res, next) => {
  let state;
  try {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
    const decoded = verifyTenantToken(h.slice(7));
    const tenant = await getTenant(decoded.tid);
    if (!tenant) return res.status(401).json({ error: 'Invalid token' });

    const gate = evaluateAccess(tenant, new Date(), req.method, req.originalUrl.split('?')[0]);
    if (!gate.allow) return res.status(gate.status).json({ error: gate.message, code: gate.code });

    const db = prisma.forTenant(tenant.id);
    const user = await db.user.findFirst({ where: { id: decoded.sub } });
    if (!user || !user.isActive || user.tokenVersion !== decoded.tv) return res.status(401).json({ error: 'Invalid or inactive user' });
    state = { tenant, db, user, gate };
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.user = state.user; req.tenant = state.tenant; req.tenantAccess = state.gate;
  return ctx.run({ tenantId: state.tenant.id, db: state.db, userId: state.user.id }, () => next());
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: `Access denied. Required roles: ${roles.join(', ')}` });
  next();
};

module.exports = { authenticate, authorize, getTenant, invalidateTenant };
