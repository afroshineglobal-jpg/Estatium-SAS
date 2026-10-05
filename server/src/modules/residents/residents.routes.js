'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { notify } = require('../../utils/notify');
const { audit } = require('../../utils/audit');
const H = require('../../utils/http');

const ADMIN_ROLES = ['ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN'];
const userSelect = { id: true, name: true, email: true, phone: true, isActive: true };
const tempPassword = () => `${crypto.randomBytes(9).toString('base64url')}Aa1`;

/** A resident may only touch their OWN record; staff roles may touch any. */
async function assertOwnerOrStaff(req, residentId) {
  if (ADMIN_ROLES.includes(req.user.role)) return;
  const own = await prisma.resident.findFirst({ where: { id: residentId, userId: req.user.id }, select: { id: true } });
  if (!own) throw H.forbidden('You can only manage your own household');
}

// GET /api/residents
router.get('/', authenticate, authorize(...ADMIN_ROLES), H.wrap(async (req, res) => {
  res.json(await prisma.resident.findMany({ include: { user: { select: userSelect }, unit: { include: { block: true } }, members: true, vehicles: true }, orderBy: { createdAt: 'desc' }, take: 1000 }));
}));

// GET /api/residents/units — guards need it (walk-in visitors); residents must not see their neighbours' names/phones
router.get('/units', authenticate, H.wrap(async (req, res) => {
  const staff = req.user.role !== 'RESIDENT';
  res.json(await prisma.unit.findMany({
    where: { isActive: true },
    include: { block: true, ...(staff ? { residents: { include: { user: { select: { name: true, phone: true } } } } } : {}) },
    orderBy: [{ block: { name: 'asc' } }, { unitNumber: 'asc' }],
  }));
}));

router.get('/blocks', authenticate, H.wrap(async (req, res) => res.json(await prisma.block.findMany({ include: { units: true } }))));

// POST /api/residents — creates a RESIDENT account (role can no longer be chosen => no privilege escalation)
router.post('/', authenticate, authorize(...ADMIN_ROLES), H.wrap(async (req, res) => {
  const b = req.body || {};
  const name = H.str(b.name, { name: 'name', required: true, max: 120 });
  const email = H.str(b.email, { name: 'email', required: true, max: 200 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw H.bad('email is not valid');
  const unitId = H.requireId(b.unitId, 'unitId');
  const unit = await prisma.unit.findFirst({ where: { id: unitId, isActive: true } });
  if (!unit) throw H.notFound('Unit');
  if (await prisma.user.findFirst({ where: { email } })) throw H.conflict('Email already registered', 'DUPLICATE');

  const pw = b.password ? H.password(b.password) : tempPassword();
  const created = await prisma.user.create({                      // nested create => user + resident are written atomically
    data: {
      name, email, phone: H.str(b.phone, { max: 40 }), password: await bcrypt.hash(pw, 12), role: 'RESIDENT', mustChangePassword: true,
      resident: { create: { tenantId: req.tenant.id, unitId, residentType: b.residentType ? H.oneOf(b.residentType, ['OWNER', 'TENANT'], 'residentType') : 'TENANT', moveInDate: new Date() } },
    },
    include: { resident: true },
  });
  await notify(created.id, 'Welcome to the Estate!', `Your account has been created. Login with ${email}`, 'GENERAL');
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'RESIDENT_CREATED', entity: 'Resident', entityId: created.resident.id });
  const { password: _p, ...user } = created;                       // eslint-disable-line no-unused-vars
  res.status(201).json({ user, resident: created.resident, ...(b.password ? {} : { temporaryPassword: pw }) });
}));

// GET /api/residents/:id — staff, or the resident themself
router.get('/:id', authenticate, H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  await assertOwnerOrStaff(req, id);
  const resident = await prisma.resident.findFirst({ where: { id }, include: { user: { select: userSelect }, unit: { include: { block: true } }, members: true, vehicles: true, bills: { orderBy: { createdAt: 'desc' }, take: 10 } } });
  if (!resident) throw H.notFound('Resident');
  res.json(resident);
}));

// PUT /api/residents/:id
router.put('/:id', authenticate, authorize(...ADMIN_ROLES), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const b = req.body || {};
  const resident = await prisma.resident.findFirst({ where: { id } });
  if (!resident) throw H.notFound('Resident');
  const userData = {}; const resData = {};
  if (b.name !== undefined) userData.name = H.str(b.name, { required: true, max: 120, name: 'name' });
  if (b.phone !== undefined) userData.phone = H.str(b.phone, { max: 40 });
  if (b.residentType !== undefined) resData.residentType = H.oneOf(b.residentType, ['OWNER', 'TENANT'], 'residentType');
  if (b.unitId !== undefined && b.unitId !== resident.unitId) {
    if (!(await prisma.unit.findFirst({ where: { id: H.requireId(b.unitId, 'unitId'), isActive: true } }))) throw H.notFound('Unit');
    resData.unitId = b.unitId;
  }
  if (b.isActive !== undefined) { userData.isActive = !!b.isActive; resData.isActive = !!b.isActive; resData.moveOutDate = b.isActive ? null : new Date(); if (!b.isActive) userData.tokenVersion = { increment: 1 }; }
  if (Object.keys(userData).length) await prisma.user.update({ where: { id: resident.userId }, data: userData });
  const updated = Object.keys(resData).length ? await prisma.resident.update({ where: { id }, data: resData }) : resident;
  res.json(updated);
}));

// Family members — staff or the household itself, capped by the estate's setting
router.post('/:id/members', authenticate, H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); await assertOwnerOrStaff(req, id);
  const cap = Number((await prisma.setting.findFirst({ where: { key: 'max_family_members' } }))?.value || 15);
  if ((await prisma.familyMember.count({ where: { residentId: id } })) >= cap) throw H.conflict(`Limit of ${cap} family members reached`, 'LIMIT');
  const b = req.body || {};
  res.status(201).json(await prisma.familyMember.create({ data: { residentId: id, name: H.str(b.name, { required: true, max: 120, name: 'name' }), relation: H.str(b.relation, { required: true, max: 60, name: 'relation' }), phone: H.str(b.phone, { max: 40 }) } }));
}));

router.delete('/:id/members/:memberId', authenticate, H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); await assertOwnerOrStaff(req, id);
  const r = await prisma.familyMember.deleteMany({ where: { id: H.requireId(req.params.memberId, 'memberId'), residentId: id } });   // must belong to THIS resident
  if (!r.count) throw H.notFound('Family member');
  res.json({ success: true });
}));

// Blocks & units (ADMIN). One INSERT per call; the DB trigger enforces the subscription's unit cap atomically.
router.post('/blocks', authenticate, authorize('ADMIN'), H.wrap(async (req, res) => {
  const name = H.str(req.body?.name, { name: 'name', required: true, max: 60 });
  const units = req.body?.units ? H.int(req.body.units, { min: 0, max: 500, name: 'units' }) : 0;
  const block = await prisma.block.create({ data: { name } });
  if (units) await prisma.unit.createMany({ data: Array.from({ length: units }, (_, i) => ({ blockId: block.id, unitNumber: String(i + 1).padStart(3, '0') })) });
  res.status(201).json(block);
}));

router.post('/blocks/add-units', authenticate, authorize('ADMIN'), H.wrap(async (req, res) => {
  const blockId = H.requireId(req.body?.blockId, 'blockId'); const count = H.int(req.body?.count, { min: 1, max: 500, name: 'count' });
  if (!(await prisma.block.findFirst({ where: { id: blockId } }))) throw H.notFound('Block');
  const existing = await prisma.unit.findMany({ where: { blockId }, select: { unitNumber: true } });
  const highest = existing.reduce((m, u) => Math.max(m, parseInt(u.unitNumber, 10) || 0), 0);     // numeric max (string sort broke after 999)
  const r = await prisma.unit.createMany({ data: Array.from({ length: count }, (_, i) => ({ blockId, unitNumber: String(highest + i + 1).padStart(3, '0') })) });
  res.status(201).json({ created: r.count });
}));

module.exports = router;
