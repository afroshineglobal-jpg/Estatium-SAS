'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const tempPassword = () => `${crypto.randomBytes(9).toString('base64url').replace(/^[-_]+/, 'x')}Aa1`;   // meets the password policy, never starts with - or _

/**
 * Admin-initiated password reset for a user in the CURRENT estate (call inside an authenticated tenant request).
 * Sets a new temporary password, forces a change at next sign-in, unlocks the account and signs out every device.
 * The temporary password is returned ONCE to the admin; it is never stored in readable form or logged.
 */
async function adminResetPassword({ req, userId, allowedRoles, entity, entityId }) {
  const prisma = require('../config/prisma'); const { audit } = require('./audit'); const H = require('./http');
  const user = await prisma.user.findFirst({ where: { id: userId }, select: { id: true, email: true, role: true, isActive: true } });
  if (!user || !allowedRoles.includes(user.role)) throw H.notFound('User');       // admins/other roles cannot be reset through these endpoints
  const pw = tempPassword();
  await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(pw, 12), mustChangePassword: true, failedLogins: 0, lockedUntil: null, tokenVersion: { increment: 1 } } });
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'PASSWORD_RESET_BY_ADMIN', entity, entityId, after: { targetUserId: user.id } });
  return { email: user.email, temporaryPassword: pw };
}
module.exports = { tempPassword, adminResetPassword };
