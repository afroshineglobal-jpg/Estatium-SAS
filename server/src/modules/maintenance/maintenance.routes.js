'use strict';
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { notify, notifyByRole } = require('../../utils/notify');
const H = require('../../utils/http');
const Inv = require('../../billing/invoice');
const S = require('./stages');

const STATUSES = S.KEYS;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const MANAGERS = ['ADMIN', 'MAINTENANCE_MANAGER'];

router.get('/', authenticate, H.wrap(async (req, res) => {
  const where = {};
  if (req.user.role === 'RESIDENT') where.userId = req.user.id;
  else if (!['ADMIN', 'MAINTENANCE_MANAGER', 'SECURITY_ADMIN', 'FINANCE_ADMIN'].includes(req.user.role)) throw H.forbidden();
  if (req.query.status) where.status = H.oneOf(req.query.status, STATUSES, 'status');
  res.json(await prisma.maintenanceRequest.findMany({ where, include: { user: { select: { name: true, phone: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }));
}));

router.post('/', authenticate, authorize('RESIDENT', 'ADMIN'), H.wrap(async (req, res) => {
  const b = req.body || {};
  const priority = b.priority ? H.oneOf(b.priority, PRIORITIES, 'priority') : 'MEDIUM';
  const request = await prisma.maintenanceRequest.create({ data: { userId: req.user.id, title: H.str(b.title, { name: 'title', required: true, max: 160 }), description: H.str(b.description, { name: 'description', required: true, max: 2000 }), category: H.str(b.category, { name: 'category', required: true, max: 60 }), priority, timeline: S.append([], { status: 'OPEN', note: 'Request submitted', by: req.user.name }) } });
  await notifyByRole('MAINTENANCE_MANAGER', '🔧 New Request', `${request.title} - ${priority} priority`, 'MAINTENANCE');
  res.status(201).json(request);
}));

// One request with its timeline and invoices. A resident sees only their own; managers see all.
router.get('/:id([0-9a-fA-F-]{36})', authenticate, H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const where = { id }; if (req.user.role === 'RESIDENT') where.userId = req.user.id; else if (!['ADMIN', 'MAINTENANCE_MANAGER', 'SECURITY_ADMIN', 'FINANCE_ADMIN'].includes(req.user.role)) throw H.forbidden();
  const r = await prisma.maintenanceRequest.findFirst({ where, include: { user: { select: { name: true, phone: true } } } });
  if (!r) throw H.notFound('Request');
  const invoices = await prisma.bill.findMany({ where: { sourceType: 'MAINTENANCE_REQUEST', sourceId: { startsWith: r.id } }, orderBy: { createdAt: 'asc' }, select: { id: true, invoiceNo: true, title: true, amount: true, amountPaid: true, status: true, dueDate: true, taxTotal: true, createdAt: true } });
  const { notes, ...pub } = r;                                   // internal notes stay with the managers
  res.json({ ...(MANAGERS.includes(req.user.role) ? r : pub), stages: S.STAGES, invoices });
}));

// Only the fields that were actually sent are updated. (Legacy code wrote NULL over estimatedCost/actualCost on every status change.)
router.put('/:id', authenticate, authorize(...MANAGERS), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const b = req.body || {}; const data = {};
  const current = await prisma.maintenanceRequest.findFirst({ where: { id } });
  if (!current) throw H.notFound('Request');
  const stageChanged = b.status !== undefined && b.status !== current.status;
  if (b.status !== undefined) { data.status = H.oneOf(b.status, STATUSES, 'status'); if (data.status === 'COMPLETED' && current.status !== 'COMPLETED') data.completedAt = new Date(); }
  if (b.assignedToId !== undefined) data.assignedToId = b.assignedToId ? H.requireId(b.assignedToId, 'assignedToId') : null;
  if (b.assigneeName !== undefined) data.assigneeName = H.str(b.assigneeName, { max: 120 }) || null;
  if (b.expectedDate !== undefined) data.expectedDate = b.expectedDate ? H.date(b.expectedDate, 'expectedDate') : null;
  if (b.notes !== undefined) data.notes = H.str(b.notes, { max: 1000 });
  if (b.estimatedCost !== undefined) data.estimatedCost = b.estimatedCost === '' || b.estimatedCost === null ? null : H.money(b.estimatedCost, { name: 'estimatedCost', allowZero: true });
  if (b.actualCost !== undefined) data.actualCost = b.actualCost === '' || b.actualCost === null ? null : H.money(b.actualCost, { name: 'actualCost', allowZero: true });
  const message = H.str(b.message, { max: 500 });                // shown to the resident in the timeline
  if (stageChanged || message) data.timeline = S.append(current.timeline, { status: data.status || current.status, note: message, by: req.user.name });
  if (!Object.keys(data).length) throw H.bad('Nothing to update');
  const request = await prisma.maintenanceRequest.update({ where: { id }, data });

  // Charging the resident is now an explicit choice, and idempotent (one bill per request).
  if (b.billResident === true && request.status === 'COMPLETED' && request.actualCost && request.actualCost.gt(0)) {
    const resident = await prisma.resident.findFirst({ where: { userId: request.userId } });
    if (resident) await prisma.bill.createMany({ skipDuplicates: true, data: [{ residentId: resident.id, title: `Maintenance: ${request.title}`, ...Inv.price(await Inv.loadConfig(prisma), 'REPAIR', request.actualCost), currency: req.tenant.currency, dueDate: new Date(), type: 'ONE_TIME', sourceType: 'MAINTENANCE_REQUEST', sourceId: request.id }] });
  }
  if (stageChanged || message) await notify(request.userId, `🔧 ${S.label(request.status)}`, `"${request.title}": ${message || S.label(request.status)}`, 'MAINTENANCE', { requestId: request.id });
  res.json(request);
}));

// Raise an invoice for this request at ANY stage (inspection fee, parts deposit, final bill...). Several are allowed.
router.post('/:id/invoice', authenticate, authorize('ADMIN', 'FINANCE_ADMIN'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const b = req.body || {};
  const request = await prisma.maintenanceRequest.findFirst({ where: { id } });
  if (!request) throw H.notFound('Request');
  const resident = await prisma.resident.findFirst({ where: { userId: request.userId, isActive: true } });
  if (!resident) throw H.conflict('The resident of this request is no longer active', 'NO_RESIDENT');
  const amount = H.money(b.amount, { name: 'amount' });
  const dueDate = b.dueDate ? H.date(b.dueDate, 'dueDate') : new Date(Date.now() + 14 * 86400000);
  const count = await prisma.bill.count({ where: { sourceType: 'MAINTENANCE_REQUEST', sourceId: { startsWith: id } } });
  const title = H.str(b.title, { max: 160 }) || `Maintenance: ${request.title}`;
  const bill = await prisma.bill.create({ data: { residentId: resident.id, title, ...Inv.price(await Inv.loadConfig(prisma), 'REPAIR', amount), currency: req.tenant.currency, dueDate, type: 'ONE_TIME',
    description: H.str(b.description, { max: 500 }) || `Stage: ${S.label(request.status)}`, sourceType: 'MAINTENANCE_REQUEST', sourceId: count === 0 ? id : `${id}:${count + 1}` } });
  await prisma.maintenanceRequest.update({ where: { id }, data: { timeline: S.append(request.timeline, { status: request.status, note: `Invoice ${bill.invoiceNo} raised`, by: req.user.name }) } });
  await notify(request.userId, '💰 New Invoice', `Invoice ${bill.invoiceNo} for "${request.title}"`, 'BILLING', { billId: bill.id });
  res.status(201).json(bill);
}));

router.get('/stats', authenticate, H.wrap(async (req, res) => {
  const own = req.user.role === 'RESIDENT' ? { userId: req.user.id } : {};
  const cnt = (statuses) => prisma.maintenanceRequest.count({ where: { status: { in: statuses }, ...own } });
  const [open, inProgress, completed] = await Promise.all([cnt(['OPEN', 'ACCEPTED', 'ASSIGNED']), cnt(['IN_PROGRESS', 'AWAITING_PARTS', 'FIXED']), cnt(['COMPLETED', 'CLOSED'])]);
  res.json({ open, inProgress, completed });
}));

module.exports = router;
