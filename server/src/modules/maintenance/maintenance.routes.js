'use strict';
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { notify, notifyByRole } = require('../../utils/notify');
const H = require('../../utils/http');

const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'];
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
  const request = await prisma.maintenanceRequest.create({ data: { userId: req.user.id, title: H.str(b.title, { name: 'title', required: true, max: 160 }), description: H.str(b.description, { name: 'description', required: true, max: 2000 }), category: H.str(b.category, { name: 'category', required: true, max: 60 }), priority } });
  await notifyByRole('MAINTENANCE_MANAGER', '🔧 New Request', `${request.title} - ${priority} priority`, 'MAINTENANCE');
  res.status(201).json(request);
}));

// Only the fields that were actually sent are updated. (Legacy code wrote NULL over estimatedCost/actualCost on every status change.)
router.put('/:id', authenticate, authorize(...MANAGERS), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const b = req.body || {}; const data = {};
  const current = await prisma.maintenanceRequest.findFirst({ where: { id } });
  if (!current) throw H.notFound('Request');
  if (b.status !== undefined) { data.status = H.oneOf(b.status, STATUSES, 'status'); if (data.status === 'COMPLETED' && current.status !== 'COMPLETED') data.completedAt = new Date(); }
  if (b.assignedToId !== undefined) data.assignedToId = b.assignedToId ? H.requireId(b.assignedToId, 'assignedToId') : null;
  if (b.notes !== undefined) data.notes = H.str(b.notes, { max: 1000 });
  if (b.estimatedCost !== undefined) data.estimatedCost = b.estimatedCost === '' || b.estimatedCost === null ? null : H.money(b.estimatedCost, { name: 'estimatedCost', allowZero: true });
  if (b.actualCost !== undefined) data.actualCost = b.actualCost === '' || b.actualCost === null ? null : H.money(b.actualCost, { name: 'actualCost', allowZero: true });
  if (!Object.keys(data).length) throw H.bad('Nothing to update');
  const request = await prisma.maintenanceRequest.update({ where: { id }, data });

  // Charging the resident is now an explicit choice, and idempotent (one bill per request).
  if (b.billResident === true && request.status === 'COMPLETED' && request.actualCost && request.actualCost.gt(0)) {
    const resident = await prisma.resident.findFirst({ where: { userId: request.userId } });
    if (resident) await prisma.bill.createMany({ skipDuplicates: true, data: [{ residentId: resident.id, title: `Maintenance: ${request.title}`, amount: request.actualCost, currency: req.tenant.currency, dueDate: new Date(), type: 'ONE_TIME', sourceType: 'MAINTENANCE_REQUEST', sourceId: request.id }] });
  }
  if (data.status) await notify(request.userId, '🔧 Request Updated', `Your maintenance request "${request.title}" is now ${request.status}.`, 'MAINTENANCE');
  res.json(request);
}));

router.get('/stats', authenticate, H.wrap(async (req, res) => {
  const own = req.user.role === 'RESIDENT' ? { userId: req.user.id } : {};
  const [open, inProgress, completed] = await Promise.all(['OPEN', 'IN_PROGRESS', 'COMPLETED'].map((status) => prisma.maintenanceRequest.count({ where: { status, ...own } })));
  res.json({ open, inProgress, completed });
}));

module.exports = router;
