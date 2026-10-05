'use strict';
const router = require('express').Router();
const QRCode = require('qrcode');
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const H = require('../../utils/http');

const GATE = ['GUARD', 'SECURITY_ADMIN', 'ADMIN'];
const ownerInclude = { resident: { include: { user: { select: { name: true } }, unit: { include: { block: true } } } } };

router.get('/', authenticate, H.wrap(async (req, res) => {
  const where = {};
  if (req.user.role === 'RESIDENT') {
    const r = await prisma.resident.findFirst({ where: { userId: req.user.id } });
    if (!r) return res.json([]);              // legacy: no profile => every vehicle in the estate
    where.residentId = r.id;
  } else if (!['ADMIN', 'SECURITY_ADMIN', 'GUARD'].includes(req.user.role)) throw H.forbidden();
  res.json(await prisma.vehicle.findMany({ where, include: { ...ownerInclude, vehicleLogs: { orderBy: { timestamp: 'desc' }, take: 5 } }, orderBy: { createdAt: 'desc' }, take: 1000 }));
}));

router.post('/', authenticate, authorize('RESIDENT', 'ADMIN'), H.wrap(async (req, res) => {
  const b = req.body || {};
  let residentId = b.residentId;
  if (req.user.role === 'RESIDENT') { const r = await prisma.resident.findFirst({ where: { userId: req.user.id } }); if (!r) throw H.notFound('Resident profile'); residentId = r.id; }
  else if (!(await prisma.resident.findFirst({ where: { id: H.requireId(residentId, 'residentId') } }))) throw H.notFound('Resident');
  const plateNumber = H.str(b.plateNumber, { name: 'plateNumber', required: true, max: 15 }).toUpperCase().replace(/\s+/g, '');
  const type = b.type ? H.oneOf(b.type, ['CAR', 'BIKE', 'TRUCK', 'OTHER'], 'type') : 'CAR';
  const qrCode = await QRCode.toDataURL(JSON.stringify({ plateNumber, type: 'VEHICLE' }));
  res.status(201).json(await prisma.vehicle.create({ data: { residentId, plateNumber, make: H.str(b.make, { max: 60 }), model: H.str(b.model, { max: 60 }), color: H.str(b.color, { max: 30 }), type, qrCode } }));
}));

router.post('/:id/log', authenticate, authorize(...GATE), H.wrap(async (req, res) => {
  const vehicleId = H.requireId(req.params.id);
  if (!(await prisma.vehicle.findFirst({ where: { id: vehicleId } }))) throw H.notFound('Vehicle');
  res.status(201).json(await prisma.vehicleLog.create({ data: { vehicleId, action: H.oneOf(req.body?.action, ['ENTRY', 'EXIT'], 'action'), guardNote: H.str(req.body?.guardNote, { max: 300 }) } }));
}));

router.get('/logs', authenticate, authorize(...GATE), H.wrap(async (req, res) => {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  res.json(await prisma.vehicleLog.findMany({ where: { timestamp: { gte: today } }, include: { vehicle: { include: ownerInclude } }, orderBy: { timestamp: 'desc' }, take: 1000 }));
}));

module.exports = router;
