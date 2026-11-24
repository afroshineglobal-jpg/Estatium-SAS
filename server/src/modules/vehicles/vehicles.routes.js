'use strict';
const router = require('express').Router();
const QRCode = require('qrcode');
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const H = require('../../utils/http');
const { notify, notifyMany } = require('../../utils/notify');
const { audit } = require('../../utils/audit');

const GATE = ['GUARD', 'SECURITY_ADMIN', 'ADMIN'];
const MAX_OPEN_REQUESTS = 5;                       // per resident: stops a flood of pending requests
const ownerInclude = { resident: { include: { user: { select: { name: true } }, unit: { include: { block: true } } } } };
const A = (req) => ({ req, tenantId: req.tenant?.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email });

// Residents see all of their own vehicles (any status). The estate ADMIN sees everything, optionally filtered.
// Security and guards only ever see APPROVED vehicles, so a vehicle nobody has vetted can never be waved through.
router.get('/', authenticate, H.wrap(async (req, res) => {
  const where = { isActive: true };                 // vehicles of residents who moved out stay in the database (history/exports) but leave the gate lists
  if (req.user.role === 'RESIDENT') {
    const r = await prisma.resident.findFirst({ where: { userId: req.user.id } });
    if (!r) return res.json([]);              // legacy: no profile => every vehicle in the estate
    where.residentId = r.id;
  } else if (req.user.role === 'ADMIN') {
    if (req.query.status && req.query.status !== 'ALL') where.status = H.oneOf(req.query.status, ['PENDING', 'APPROVED', 'REJECTED'], 'status');
  } else if (['SECURITY_ADMIN', 'GUARD'].includes(req.user.role)) where.status = 'APPROVED';
  else throw H.forbidden();
  res.json(await prisma.vehicle.findMany({ where, include: { ...ownerInclude, vehicleLogs: { orderBy: { timestamp: 'desc' }, take: 5 } }, orderBy: { createdAt: 'desc' }, take: 1000 }));
}));

// RESIDENT => a request (PENDING). ADMIN => registered directly (APPROVED).
router.post('/', authenticate, authorize('RESIDENT', 'ADMIN'), H.wrap(async (req, res) => {
  const b = req.body || {};
  const isResident = req.user.role === 'RESIDENT';
  let residentId = b.residentId;
  if (isResident) { const r = await prisma.resident.findFirst({ where: { userId: req.user.id } }); if (!r) throw H.notFound('Resident profile'); residentId = r.id; }
  else if (!(await prisma.resident.findFirst({ where: { id: H.requireId(residentId, 'residentId') } }))) throw H.notFound('Resident');
  const plateNumber = H.str(b.plateNumber, { name: 'plateNumber', required: true, max: 15 }).toUpperCase().replace(/\s+/g, '');
  const type = b.type ? H.oneOf(b.type, ['CAR', 'BIKE', 'TRUCK', 'OTHER'], 'type') : 'CAR';
  if (isResident && (await prisma.vehicle.count({ where: { residentId, status: 'PENDING' } })) >= MAX_OPEN_REQUESTS)
    throw H.conflict(`You already have ${MAX_OPEN_REQUESTS} requests waiting for approval`, 'TOO_MANY_REQUESTS');
  const existing = await prisma.vehicle.findFirst({ where: { plateNumber, isActive: true } });
  if (existing && existing.status !== 'REJECTED') throw H.conflict('A vehicle with this plate number is already registered or waiting for approval', 'PLATE_EXISTS');
  const qrCode = await QRCode.toDataURL(JSON.stringify({ plateNumber, type: 'VEHICLE' }));
  const now = new Date();
  const data = { residentId, plateNumber, make: H.str(b.make, { max: 60 }), model: H.str(b.model, { max: 60 }), color: H.str(b.color, { max: 30 }), type, qrCode, isActive: true,
    status: isResident ? 'PENDING' : 'APPROVED', requestedAt: now, reviewNote: null, reviewedById: isResident ? null : req.user.id, reviewedAt: isResident ? null : now };
  let vehicle;
  try { vehicle = existing ? await prisma.vehicle.update({ where: { id: existing.id }, data }) : await prisma.vehicle.create({ data }); }   // a rejected plate can be re-requested
  catch (e) { if (e.code === 'P2002') throw H.conflict('A vehicle with this plate number is already registered or waiting for approval', 'PLATE_EXISTS'); throw e; }
  if (isResident) {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    await notifyMany(admins.map((a) => a.id), 'Vehicle registration request', `${req.user.name || 'A resident'} requests approval for ${plateNumber}.`, 'GENERAL', { vehicleId: vehicle.id });
  }
  await audit({ ...A(req), action: isResident ? 'VEHICLE_REQUESTED' : 'VEHICLE_REGISTERED', entity: 'Vehicle', entityId: vehicle.id, after: { plateNumber } });
  res.status(201).json(vehicle);
}));

async function decide(req, res, status) {
  const id = H.requireId(req.params.id);
  const note = status === 'REJECTED' ? H.str(req.body?.reason, { name: 'reason', required: true, min: 3, max: 300 }) : null;
  const v = await prisma.vehicle.findFirst({ where: { id }, include: { resident: true } });
  if (!v) throw H.notFound('Vehicle');
  const claim = await prisma.vehicle.updateMany({ where: { id, status: 'PENDING' }, data: { status, reviewNote: note, reviewedById: req.user.id, reviewedAt: new Date() } });   // double-click / two admins safe
  if (!claim.count) throw H.conflict(`This request is already ${v.status.toLowerCase()}`, 'ALREADY_DECIDED');
  if (v.resident?.userId) await notify(v.resident.userId, status === 'APPROVED' ? 'Vehicle approved' : 'Vehicle request not approved',
    status === 'APPROVED' ? `${v.plateNumber} is now registered.` : `${v.plateNumber}: ${note}`, 'GENERAL', { vehicleId: id });
  await audit({ ...A(req), action: status === 'APPROVED' ? 'VEHICLE_APPROVED' : 'VEHICLE_REJECTED', entity: 'Vehicle', entityId: id, after: { plateNumber: v.plateNumber, reason: note } });
  res.json({ id, status });
}
router.post('/:id/approve', authenticate, authorize('ADMIN'), H.wrap((req, res) => decide(req, res, 'APPROVED')));
router.post('/:id/reject', authenticate, authorize('ADMIN'), H.wrap((req, res) => decide(req, res, 'REJECTED')));

// A resident may withdraw their own request while it is still waiting.
router.post('/:id/cancel', authenticate, authorize('RESIDENT'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const r = await prisma.resident.findFirst({ where: { userId: req.user.id } });
  if (!r) throw H.notFound('Resident profile');
  const done = await prisma.vehicle.deleteMany({ where: { id, residentId: r.id, status: 'PENDING' } });
  if (!done.count) throw H.conflict('Only a request that is still waiting can be withdrawn', 'NOT_PENDING');
  res.json({ id, cancelled: true });
}));

router.post('/:id/log', authenticate, authorize(...GATE), H.wrap(async (req, res) => {
  const vehicleId = H.requireId(req.params.id);
  const v = await prisma.vehicle.findFirst({ where: { id: vehicleId } });
  if (!v) throw H.notFound('Vehicle');
  if (v.status !== 'APPROVED' || !v.isActive) throw H.conflict('This vehicle is not registered at the gate', 'VEHICLE_NOT_APPROVED');
  res.status(201).json(await prisma.vehicleLog.create({ data: { vehicleId, action: H.oneOf(req.body?.action, ['ENTRY', 'EXIT'], 'action'), guardNote: H.str(req.body?.guardNote, { max: 300 }) } }));
}));

router.get('/logs', authenticate, authorize(...GATE), H.wrap(async (req, res) => {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  res.json(await prisma.vehicleLog.findMany({ where: { timestamp: { gte: today } }, include: { vehicle: { include: ownerInclude } }, orderBy: { timestamp: 'desc' }, take: 1000 }));
}));

module.exports = router;
