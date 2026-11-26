'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const H = require('../../utils/http');
const { audit } = require('../../utils/audit');
const { planStatusChange } = require('./staffStatus');

const STAFF_TYPES = ['GUARD', 'CLEANER', 'ELECTRICIAN', 'PLUMBER', 'GARDENER', 'OTHER'];
const tempPassword = () => `${crypto.randomBytes(9).toString('base64url')}Aa1`;

router.get('/', authenticate, authorize('ADMIN', 'SECURITY_ADMIN', 'MAINTENANCE_MANAGER'), H.wrap(async (req, res) => {
  res.json(await prisma.staffMember.findMany({
    include: { user: { select: { name: true, email: true, phone: true, isActive: true } }, tasks: { where: { status: { not: 'DONE' } } }, attendanceLogs: { orderBy: { timestamp: 'desc' }, take: 2 } },
    orderBy: { createdAt: 'desc' }, take: 500,
  }));
}));

// Creates the login + staff profile. GUARD staff get the GUARD role (gate permissions); every other staff type gets the
// permission-less STAFF role (legacy code made cleaners and gardeners "GUARD", i.e. able to verify visitor codes).
router.post('/', authenticate, authorize('ADMIN', 'SECURITY_ADMIN'), H.wrap(async (req, res) => {
  const b = req.body || {};
  const email = H.str(b.email, { name: 'email', required: true, max: 200 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw H.bad('email is not valid');
  const staffType = H.oneOf(b.staffType, STAFF_TYPES, 'staffType');
  if (await prisma.user.findFirst({ where: { email } })) throw H.conflict('Email already registered', 'DUPLICATE');
  const pw = b.password ? H.password(b.password) : tempPassword();
  const id = crypto.randomUUID();
  const qrCode = await QRCode.toDataURL(JSON.stringify({ userId: id, type: 'STAFF' }));
  const user = await prisma.user.create({ data: {
    id, name: H.str(b.name, { name: 'name', required: true, max: 120 }), email, phone: H.str(b.phone, { max: 40 }), password: await bcrypt.hash(pw, 12), mustChangePassword: true, role: staffType === 'GUARD' ? 'GUARD' : 'STAFF',
    staffMember: { create: { tenantId: req.tenant.id, staffType, employedBy: b.employedBy === 'RESIDENT' ? 'RESIDENT' : 'SOCIETY', residentId: b.residentId ? H.requireId(b.residentId, 'residentId') : null, qrCode, accessStart: b.accessStart ? H.hhmm(b.accessStart) : null, accessEnd: b.accessEnd ? H.hhmm(b.accessEnd) : null } },
  }, include: { staffMember: true } });
  const { password: _p, ...safe } = user;                                   // eslint-disable-line no-unused-vars
  res.status(201).json({ ...safe.staffMember, user: safe, ...(b.password ? {} : { temporaryPassword: pw }) });
}));

// Admin / security admin resets a guard's or staff member's password (shown once, must be changed at next sign-in).
router.post('/:id/reset-password', authenticate, authorize('ADMIN', 'SECURITY_ADMIN'), H.wrap(async (req, res) => {
  const s = await prisma.staffMember.findFirst({ where: { id: H.requireId(req.params.id) }, select: { id: true, userId: true } });
  if (!s) throw H.notFound('Staff member');
  res.json(await require('../../utils/credentials').adminResetPassword({ req, userId: s.userId, allowedRoles: ['GUARD', 'STAFF'], entity: 'StaffMember', entityId: s.id }));
}));

router.post('/:id/tasks', authenticate, authorize('ADMIN', 'MAINTENANCE_MANAGER'), H.wrap(async (req, res) => {
  const staffId = H.requireId(req.params.id);
  if (!(await prisma.staffMember.findFirst({ where: { id: staffId } }))) throw H.notFound('Staff member');
  const b = req.body || {};
  res.status(201).json(await prisma.task.create({ data: { staffId, title: H.str(b.title, { name: 'title', required: true, max: 160 }), description: H.str(b.description, { max: 1000 }), dueDate: b.dueDate ? H.date(b.dueDate, 'dueDate') : null } }));
}));

// Managers update any task; a staff member may update only their own.
router.put('/tasks/:taskId', authenticate, H.wrap(async (req, res) => {
  const id = H.requireId(req.params.taskId, 'taskId'); const status = H.oneOf(req.body?.status, ['PENDING', 'IN_PROGRESS', 'DONE'], 'status');
  const task = await prisma.task.findFirst({ where: { id }, include: { staff: true } });
  if (!task) throw H.notFound('Task');
  if (!['ADMIN', 'MAINTENANCE_MANAGER'].includes(req.user.role) && task.staff.userId !== req.user.id) throw H.forbidden();
  res.json(await prisma.task.update({ where: { id }, data: { status } }));
}));

router.post('/:id/attendance', authenticate, H.wrap(async (req, res) => {
  const staffId = H.requireId(req.params.id); const action = H.oneOf(req.body?.action, ['CHECK_IN', 'CHECK_OUT'], 'action');
  const member = await prisma.staffMember.findFirst({ where: { id: staffId } });
  if (!member) throw H.notFound('Staff member');
  if (!['ADMIN', 'SECURITY_ADMIN', 'GUARD'].includes(req.user.role) && member.userId !== req.user.id) throw H.forbidden();
  if (member.status !== 'ACTIVE') throw H.conflict('This staff member is not active', 'STAFF_NOT_ACTIVE');
  res.status(201).json(await prisma.attendanceLog.create({ data: { staffId, action } }));
}));

router.get('/guards', authenticate, authorize('ADMIN', 'SECURITY_ADMIN'), H.wrap(async (req, res) => res.json(await prisma.guard.findMany({ include: { user: { select: { name: true, phone: true, isActive: true } } } }))));

// ── Full record of one staff member: everything the admin needs when the person has forgotten their own login details.
router.get('/:id', authenticate, authorize('ADMIN', 'SECURITY_ADMIN', 'MAINTENANCE_MANAGER'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const s = await prisma.staffMember.findFirst({ where: { id }, include: {
    user: { select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true, mustChangePassword: true, lockedUntil: true, createdAt: true } },
    attendanceLogs: { orderBy: { timestamp: 'desc' }, take: 30 }, tasks: { orderBy: { createdAt: 'desc' }, take: 20 } } });
  if (!s) throw H.notFound('Staff member');
  const history = await prisma.system.auditLog.findMany({ where: { tenantId: req.tenant.id, entity: 'StaffMember', entityId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { action: true, actorEmail: true, after: true, createdAt: true } });
  res.json({ ...s, history });
}));

// ── Edit contact + access details (email is the sign-in name, so it must stay unique in the estate).
router.put('/:id', authenticate, authorize('ADMIN', 'SECURITY_ADMIN'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const b = req.body || {};
  const s = await prisma.staffMember.findFirst({ where: { id }, include: { user: { select: { email: true, role: true } } } });
  if (!s) throw H.notFound('Staff member');
  const userData = {}; const data = {};
  if (b.name !== undefined) userData.name = H.str(b.name, { name: 'name', required: true, max: 120 });
  if (b.phone !== undefined) userData.phone = H.str(b.phone, { max: 40 });
  if (b.email !== undefined) {
    const email = H.str(b.email, { name: 'email', required: true, max: 200 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw H.bad('email is not valid');
    if (email !== s.user.email) { if (await prisma.user.findFirst({ where: { email, NOT: { id: s.userId } } })) throw H.conflict('Email already registered', 'DUPLICATE'); userData.email = email; userData.tokenVersion = { increment: 1 }; }
  }
  if (b.accessStart !== undefined) data.accessStart = H.hhmm(b.accessStart, 'accessStart');
  if (b.accessEnd !== undefined) data.accessEnd = H.hhmm(b.accessEnd, 'accessEnd');
  if (b.employedBy !== undefined) data.employedBy = H.oneOf(b.employedBy, ['SOCIETY', 'RESIDENT'], 'employedBy');
  if (Object.keys(userData).length) await prisma.user.update({ where: { id: s.userId }, data: userData });
  if (Object.keys(data).length) await prisma.staffMember.update({ where: { id }, data });
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'STAFF_UPDATED', entity: 'StaffMember', entityId: id, after: { fields: [...Object.keys(userData), ...Object.keys(data)].filter((k) => k !== 'tokenVersion') } });
  res.json({ id, updated: true });
}));

// ── Status: ACTIVE | SUSPENDED | DEACTIVATED | LEFT. Anything but ACTIVE blocks sign-in and signs the person out; nothing is deleted.
router.post('/:id/status', authenticate, authorize('ADMIN', 'SECURITY_ADMIN'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const s = await prisma.staffMember.findFirst({ where: { id }, include: { user: { select: { role: true } } } });
  if (!s) throw H.notFound('Staff member');
  if (!['GUARD', 'STAFF'].includes(s.user.role)) throw H.forbidden('This account cannot be changed here');
  const plan = planStatusChange(s.status, req.body?.status, { note: req.body?.note, date: req.body?.date });
  if (!plan.ok) throw H.bad(plan.error);
  const { signOutEverywhere, ...userPatch } = plan.userPatch;
  await prisma.user.update({ where: { id: s.userId }, data: { ...userPatch, ...(signOutEverywhere ? { tokenVersion: { increment: 1 } } : {}) } });
  await prisma.staffMember.update({ where: { id }, data: plan.patch });
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'STAFF_STATUS_CHANGED', entity: 'StaffMember', entityId: id, before: { status: s.status }, after: { status: plan.patch.status, note: plan.patch.statusNote, leftAt: plan.patch.leftAt } });
  res.json({ id, status: plan.patch.status });
}));

module.exports = router;
