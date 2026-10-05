'use strict';
const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const env = require('../../config/env');
const { signPlatformToken, verifyPlatformToken } = require('../../utils/tokens');
const { HttpError, bad, password: validatePassword } = require('../../utils/http');
const { can } = require('./permissions');
const { audit } = require('../../utils/audit');

const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', 12);
const MAX_FAILS = 5, LOCK_MINUTES = 15;
const db = prisma.system;
const safe = ({ password, ...u }) => u;                                     // eslint-disable-line no-unused-vars

async function login(req, res) {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') throw bad('Email and password are required');
  const user = await db.platformUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.isActive) { await bcrypt.compare(password, DUMMY_HASH); throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS'); }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new HttpError(423, 'Account temporarily locked. Try again later.', 'LOCKED');
  if (!(await bcrypt.compare(password, user.password))) {
    const u = await db.platformUser.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } });
    if (u.failedLogins >= MAX_FAILS) await db.platformUser.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000), failedLogins: 0 } });
    await audit({ req, actorType: 'PLATFORM_USER', actorId: user.id, actorEmail: user.email, action: 'PLATFORM_LOGIN_FAILED' });
    throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }
  await db.platformUser.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit({ req, actorType: 'PLATFORM_USER', actorId: user.id, actorEmail: user.email, action: 'PLATFORM_LOGIN' });
  res.json({ token: signPlatformToken(user), user: safe(user) });
}

/** Verifies the platform JWT (separate secret + audience from tenant tokens) and the optional IP allow-list. */
const platformAuth = async (req, res, next) => {
  try {
    if (env.PLATFORM_ALLOWED_IPS.length && !env.PLATFORM_ALLOWED_IPS.includes(req.ip)) return res.status(403).json({ error: 'Not allowed from this network' });
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
    const d = verifyPlatformToken(h.slice(7));
    const user = await db.platformUser.findUnique({ where: { id: d.sub } });
    if (!user || !user.isActive || user.tokenVersion !== d.tv) return res.status(401).json({ error: 'Invalid or inactive user' });
    req.platformUser = user;
    req.actor = { type: 'PLATFORM_USER', id: user.id, email: user.email };
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
};

const requirePerm = (perm) => (req, res, next) => (can(req.platformUser.role, perm) ? next() : res.status(403).json({ error: `Missing permission: ${perm}`, code: 'FORBIDDEN' }));

async function changeOwnPassword(req, res) {
  const { currentPassword, newPassword } = req.body || {};
  if (!(await bcrypt.compare(String(currentPassword || ''), req.platformUser.password))) throw bad('Current password is incorrect');
  validatePassword(newPassword);
  const u = await db.platformUser.update({ where: { id: req.platformUser.id }, data: { password: await bcrypt.hash(newPassword, 12), tokenVersion: { increment: 1 } } });
  await audit({ req, actorType: 'PLATFORM_USER', actorId: u.id, actorEmail: u.email, action: 'PLATFORM_PASSWORD_CHANGED' });
  res.json({ success: true, token: signPlatformToken(u) });
}

module.exports = { login, platformAuth, requirePerm, changeOwnPassword, safe };
