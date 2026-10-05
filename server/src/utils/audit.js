'use strict';
const prisma = require('../config/prisma');

/** Append-only audit trail. Never throws (an audit failure must not break the business operation). */
async function audit({ req, tenantId = null, actorType, actorId = null, actorEmail = null, action, entity = null, entityId = null, before = null, after = null }) {
  try {
    await prisma.system.auditLog.create({ data: {
      tenantId, actorType, actorId, actorEmail, action, entity, entityId,
      before: before ?? undefined, after: after ?? undefined,
      ip: req?.ip || null, userAgent: req?.get ? (req.get('user-agent') || '').slice(0, 300) : null,
    } });
  } catch (e) { console.error('[audit] failed:', e.message); }
}
module.exports = { audit };
