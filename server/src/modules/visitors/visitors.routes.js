'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const QRCode = require('qrcode');
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { codeLimiter } = require('../../middleware/security');
const { notify } = require('../../utils/notify');
const { rooms } = require('../../realtime');
const H = require('../../utils/http');

const GATE = ['GUARD', 'SECURITY_ADMIN', 'ADMIN'];
const code6 = () => String(crypto.randomInt(100000, 1000000));            // CSPRNG, 6 digits (was Math.random, 5 digits)
const include = { resident: { include: { user: { select: { name: true, phone: true } }, unit: { include: { block: true } } } } };

async function expiryHours() { return Number((await prisma.setting.findFirst({ where: { key: 'visitor_auto_expire_hours' } }))?.value || 24); }
async function myResident(req) { const r = await prisma.resident.findFirst({ where: { userId: req.user.id } }); if (!r) throw H.notFound('Resident profile'); return r; }

/** Entry/exit codes are unique per estate; on the (rare) collision just draw again. */
async function withUniqueCodes(create) {
  for (let i = 0; i < 6; i++) {
    try { return await create({ entryCode: code6(), exitCode: code6() }); }
    catch (e) { if (e.code !== 'P2002') throw e; }
  }
  throw H.conflict('Could not allocate a unique visitor code, please retry');
}

router.get('/', authenticate, H.wrap(async (req, res) => {
  const { status, date, type } = req.query; const where = {};
  if (req.user.role === 'RESIDENT') where.residentId = (await myResident(req)).id;
  if (status) where.status = H.oneOf(status, ['PENDING', 'APPROVED', 'DENIED', 'INSIDE', 'EXITED'], 'status');
  if (type) where.visitorType = H.oneOf(type, ['GUEST', 'DELIVERY', 'SERVICE', 'DOMESTIC'], 'type');
  if (date) { const d = H.date(date); const next = new Date(d); next.setUTCDate(next.getUTCDate() + 1); where.createdAt = { gte: d, lt: next }; }
  const visitors = await prisma.visitor.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(visitors);
}));

router.post('/pre-approve', authenticate, authorize('RESIDENT', 'ADMIN'), H.wrap(async (req, res) => {
  const b = req.body || {};
  const name = H.str(b.name, { name: 'name', required: true, max: 120 });
  const resident = await myResident(req);
  const expires = new Date(Date.now() + (await expiryHours()) * 3600000);
  const visitor = await withUniqueCodes((codes) => prisma.visitor.create({ data: {
    residentId: resident.id, name, phone: H.str(b.phone, { max: 40 }), purpose: H.str(b.purpose, { max: 200 }), photo: H.str(b.photo, { max: 700000 }),
    visitorType: b.visitorType ? H.oneOf(b.visitorType, ['GUEST', 'DELIVERY', 'SERVICE', 'DOMESTIC'], 'visitorType') : 'GUEST', status: 'APPROVED', preApproved: true,
    vehicleNumber: H.str(b.vehicleNumber, { max: 20 }), expectedDate: b.expectedDate ? H.date(b.expectedDate, 'expectedDate') : null, codeExpiresAt: expires, ...codes,
  } }));
  const qrCode = await QRCode.toDataURL(JSON.stringify({ visitorId: visitor.id, entryCode: visitor.entryCode, type: 'VISITOR_ENTRY' }));
  res.status(201).json({ ...visitor, qrCode });
}));

router.post('/walkin', authenticate, authorize(...GATE), H.wrap(async (req, res) => {
  const b = req.body || {};
  const name = H.str(b.name, { name: 'name', required: true, max: 120 });
  const resident = await prisma.resident.findFirst({ where: { unitId: H.requireId(b.unitId, 'unitId'), isActive: true } });
  if (!resident) throw H.notFound('Active resident for this unit');
  const visitor = await prisma.visitor.create({ data: {
    residentId: resident.id, name, phone: H.str(b.phone, { max: 40 }), purpose: H.str(b.purpose, { max: 200 }), photo: H.str(b.photo, { max: 700000 }),
    visitorType: b.visitorType ? H.oneOf(b.visitorType, ['GUEST', 'DELIVERY', 'SERVICE', 'DOMESTIC'], 'visitorType') : 'GUEST', status: 'PENDING', vehicleNumber: H.str(b.vehicleNumber, { max: 20 }),
  } });
  // only the resident's own sockets hear the doorbell (was io.emit => every connected client)
  req.app.get('io').to(rooms.user(req.tenant.id, resident.userId)).emit(`resident-${resident.userId}`, { type: 'VISITOR_WAITING', visitor });
  await notify(resident.userId, '🔔 Visitor at Gate', `${name} wants to visit you. Approve or deny in the app.`, 'VISITOR', { visitorId: visitor.id });
  res.status(201).json(visitor);
}));

// Resident decides — only for visitors of THEIR household, only while PENDING
router.put('/:id/approve', authenticate, authorize('RESIDENT', 'ADMIN'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const action = H.oneOf(req.body?.action, ['APPROVED', 'DENIED'], 'action');
  const visitor = await prisma.visitor.findFirst({ where: { id }, include: { resident: true } });
  if (!visitor) throw H.notFound('Visitor');
  if (req.user.role === 'RESIDENT' && visitor.resident.userId !== req.user.id) throw H.forbidden('Not your visitor');
  if (visitor.status !== 'PENDING') throw H.conflict(`Visitor is already ${visitor.status}`, 'ALREADY_DECIDED');
  const expires = new Date(Date.now() + (await expiryHours()) * 3600000);
  const updated = action === 'DENIED'
    ? await prisma.visitor.update({ where: { id }, data: { status: 'DENIED', denialNote: H.str(req.body?.denialNote, { max: 300 }), entryCode: null, exitCode: null } })
    : await withUniqueCodes((codes) => prisma.visitor.update({ where: { id }, data: { status: 'APPROVED', denialNote: null, codeExpiresAt: expires, ...codes } }));
  const io = req.app.get('io');
  const payload = { visitorId: id, action };
  io.to(rooms.user(req.tenant.id, visitor.resident.userId)).emit('visitor-decision', { ...payload, entryCode: updated.entryCode });   // the resident gets the code
  io.to(rooms.role(req.tenant.id, 'GUARD')).to(rooms.role(req.tenant.id, 'SECURITY_ADMIN')).emit('visitor-decision', payload);          // guards get the decision, NOT the code
  res.json(updated);
}));

// Guard verifies a code. Gate staff only, rate-limited, codes expire.
router.post('/verify-code', authenticate, authorize(...GATE), codeLimiter, H.wrap(async (req, res) => {
  const entryCode = H.str(req.body?.entryCode, { name: 'entryCode', required: true, max: 12 });
  const v = await prisma.visitor.findFirst({ where: { entryCode }, include });
  if (!v) throw H.notFound('Visitor for this code');
  if (v.codeExpiresAt && v.codeExpiresAt < new Date()) throw H.conflict('This code has expired', 'CODE_EXPIRED');
  if (v.status === 'INSIDE') throw H.conflict('Visitor is already inside');
  if (v.status === 'EXITED') throw H.conflict('Visitor has already exited');
  if (v.status === 'DENIED') throw H.forbidden('Entry was denied by resident');
  if (v.status !== 'APPROVED') throw H.conflict(`Cannot enter — status is ${v.status}`);
  res.json(v);
}));

router.post('/verify-exit-code', authenticate, authorize(...GATE), codeLimiter, H.wrap(async (req, res) => {
  const exitCode = H.str(req.body?.exitCode, { name: 'exitCode', required: true, max: 12 });
  const v = await prisma.visitor.findFirst({ where: { exitCode }, include });     // unique per estate now: no wrong-person match
  if (!v) throw H.notFound('Visitor for this exit code');
  if (v.status !== 'INSIDE') throw H.conflict(`Visitor status is ${v.status} — cannot exit`);
  res.json(v);
}));

// Atomic status transitions: updateMany with the expected current status => two guards cannot both "enter" the same visitor
router.put('/:id/entry', authenticate, authorize(...GATE), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const r = await prisma.visitor.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'INSIDE', entryTime: new Date() } });
  if (!r.count) throw H.conflict('Visitor is not in an approved state');
  const v = await prisma.visitor.findFirst({ where: { id }, include: { resident: true } });
  await notify(v.resident.userId, '✅ Visitor Entered', `${v.name} has entered.`, 'VISITOR');
  res.json(v);
}));

router.put('/:id/exit', authenticate, authorize(...GATE), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const r = await prisma.visitor.updateMany({ where: { id, status: 'INSIDE' }, data: { status: 'EXITED', exitTime: new Date() } });
  if (!r.count) throw H.conflict('Visitor is not inside');
  const v = await prisma.visitor.findFirst({ where: { id }, include: { resident: true } });
  await notify(v.resident.userId, '👋 Visitor Exited', `${v.name} has left.`, 'VISITOR');
  res.json(v);
}));

router.get('/today/stats', authenticate, authorize('ADMIN', 'SECURITY_ADMIN', 'GUARD'), H.wrap(async (req, res) => {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);       // NOTE: estate-local midnight would need Tenant.timezone; UTC day is used consistently server-side
  const [total, inside, pending] = await Promise.all([
    prisma.visitor.count({ where: { createdAt: { gte: today } } }), prisma.visitor.count({ where: { status: 'INSIDE' } }), prisma.visitor.count({ where: { status: 'PENDING' } }),
  ]);
  res.json({ total, inside, pending });
}));

module.exports = router;
