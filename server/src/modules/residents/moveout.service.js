'use strict';
/**
 * Resident move-out ("vacate") and reinstatement. NOTHING is deleted: the resident, family, vehicles, visitors, bills and
 * every gate log stay in the database for history and exports. Vacating only switches things off.
 */
const H = require('../../utils/http');

async function vacate(req, id, { date, note } = {}) {
  const prisma = require('../../config/prisma'); const { audit } = require('../../utils/audit');
  const reason = H.str(note, { name: 'note', max: 300 });
  const moveOutDate = date ? H.date(date, 'moveOutDate') : new Date();
  const r = await prisma.resident.findFirst({ where: { id }, include: { user: { select: { name: true } }, unit: { include: { block: true } } } });
  if (!r) throw H.notFound('Resident');
  const claim = await prisma.resident.updateMany({ where: { id, isActive: true }, data: { isActive: false, moveOutDate, moveOutNote: reason, vacatedById: req.user.id } });   // claim first: a double click cannot run it twice
  if (!claim.count) throw H.conflict('This resident has already moved out', 'ALREADY_VACATED');
  const now = new Date();
  await prisma.user.update({ where: { id: r.userId }, data: { isActive: false, tokenVersion: { increment: 1 } } });                   // cannot sign in; open sessions end
  const requests = await prisma.vehicle.updateMany({ where: { residentId: id, status: 'PENDING' }, data: { status: 'REJECTED', reviewNote: 'Resident moved out', reviewedById: req.user.id, reviewedAt: now } });
  const vehicles = await prisma.vehicle.updateMany({ where: { residentId: id, isActive: true }, data: { isActive: false } });          // the gate stops accepting them; plate can be registered by a new owner
  const visitors = await prisma.visitor.updateMany({ where: { residentId: id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'DENIED', denialNote: 'Resident moved out' } });   // expected guests are no longer admitted
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'RESIDENT_VACATED', entity: 'Resident', entityId: id,
    after: { name: r.user?.name, unit: r.unit ? `${r.unit.block.name}-${r.unit.unitNumber}` : null, moveOutDate, note: reason, vehiclesDeactivated: vehicles.count, visitorsCancelled: visitors.count } });
  return { id, status: 'VACATED', moveOutDate, vehiclesDeactivated: vehicles.count, vehicleRequestsClosed: requests.count, visitorsCancelled: visitors.count };
}

async function reinstate(req, id, { restoreVehicles = true } = {}) {
  const prisma = require('../../config/prisma'); const { audit } = require('../../utils/audit'); const { assertUnitVacant } = require('./occupancy');
  const r = await prisma.resident.findFirst({ where: { id } });
  if (!r) throw H.notFound('Resident');
  if (r.isActive) throw H.conflict('This resident is already active', 'ALREADY_ACTIVE');
  await assertUnitVacant(r.unitId, id);
  await prisma.resident.update({ where: { id }, data: { isActive: true, moveOutDate: null, moveOutNote: null, vacatedById: null } });
  await prisma.user.update({ where: { id: r.userId }, data: { isActive: true, failedLogins: 0, lockedUntil: null } });
  let restored = 0;
  if (restoreVehicles) {
    try { restored = (await prisma.vehicle.updateMany({ where: { residentId: id, isActive: false, status: 'APPROVED' }, data: { isActive: true } })).count; }
    catch (e) { if (e.code === 'P2002') throw H.conflict('Resident reinstated, but a vehicle plate is now registered by someone else. Re-register that vehicle by hand.', 'PLATE_TAKEN'); throw e; }
  }
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'RESIDENT_REINSTATED', entity: 'Resident', entityId: id, after: { vehiclesRestored: restored } });
  return { id, status: 'ACTIVE', vehiclesRestored: restored };
}
module.exports = { vacate, reinstate };
