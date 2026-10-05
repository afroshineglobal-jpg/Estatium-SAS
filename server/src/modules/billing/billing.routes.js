'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const prisma = require('../../config/prisma');
const { Prisma } = prisma;
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { notify, notifyMany } = require('../../utils/notify');
const { audit } = require('../../utils/audit');
const { format } = require('../../billing/money');
const H = require('../../utils/http');

const BILL_TYPES = ['MAINTENANCE', 'UTILITY', 'PENALTY', 'AMENITY', 'ONE_TIME'];
const BILL_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED', 'VOID'];
const FINANCE = ['ADMIN', 'FINANCE_ADMIN'];
const fmt = (amount, req) => format(amount, req.tenant.currency);

// GET /api/billing — residents see only their own bills
router.get('/', authenticate, H.wrap(async (req, res) => {
  const where = {};
  if (req.user.role === 'RESIDENT') {
    const resident = await prisma.resident.findFirst({ where: { userId: req.user.id } });
    if (!resident) return res.json([]);          // never fall through to "all bills"
    where.residentId = resident.id;
  }
  if (req.query.status) where.status = H.oneOf(req.query.status, BILL_STATUSES, 'status');
  const bills = await prisma.bill.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 500,
    include: { resident: { include: { user: { select: { name: true } }, unit: { include: { block: true } } } }, payments: true },
  });
  res.json(bills);
}));

// POST /api/billing — one resident
router.post('/', authenticate, authorize(...FINANCE), H.wrap(async (req, res) => {
  const { residentId, title, type } = req.body || {};
  const amount = H.money(req.body?.amount);
  const dueDate = H.date(req.body?.dueDate, 'dueDate');
  const resident = await prisma.resident.findFirst({ where: { id: H.requireId(residentId, 'residentId'), isActive: true } });
  if (!resident) throw H.notFound('Resident');
  const bill = await prisma.bill.create({ data: {
    residentId: resident.id, title: H.str(title, { name: 'title', required: true, max: 160 }), amount, currency: req.tenant.currency, dueDate,
    type: type ? H.oneOf(type, BILL_TYPES, 'type') : 'MAINTENANCE', description: H.str(req.body?.description, { max: 500 }),
  } });
  await notify(resident.userId, '💰 New Bill', `New bill "${bill.title}" of ${fmt(amount, req)}`, 'BILLING', { billId: bill.id });
  res.status(201).json(bill);
}));

// POST /api/billing/bulk — every active resident. One INSERT, idempotent: re-submitting the same title/due date/type creates nothing twice.
router.post('/bulk', authenticate, authorize(...FINANCE), H.wrap(async (req, res) => {
  const { title, type } = req.body || {};
  const amount = H.money(req.body?.amount);
  const dueDate = H.date(req.body?.dueDate, 'dueDate');
  const t = H.str(title, { name: 'title', required: true, max: 160 });
  const billType = type ? H.oneOf(type, BILL_TYPES, 'type') : 'MAINTENANCE';
  const residents = await prisma.resident.findMany({ where: { isActive: true }, select: { id: true, userId: true } });
  if (!residents.length) throw H.bad('No active residents found');

  const runKey = crypto.createHash('sha1').update(`${t}|${dueDate.toISOString()}|${billType}|${amount}`).digest('hex').slice(0, 16);
  const startedAt = new Date(Date.now() - 1000);
  const r = await prisma.bill.createMany({ skipDuplicates: true, data: residents.map((x) => ({
    residentId: x.id, title: t, amount, currency: req.tenant.currency, dueDate, type: billType, description: H.str(req.body?.description, { max: 500 }), sourceType: 'BULK', sourceId: `${runKey}:${x.id}`,
  })) });
  if (r.count) {
    const fresh = await prisma.bill.findMany({ where: { sourceType: 'BULK', sourceId: { startsWith: `${runKey}:` }, createdAt: { gte: startedAt } }, select: { resident: { select: { userId: true } } } });
    await notifyMany(fresh.map((b) => b.resident.userId), '💰 New Bill', `New bill "${t}" of ${fmt(amount, req)}`, 'BILLING', {});
  }
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'BILLS_BULK_CREATED', after: { title: t, amount, created: r.count, skippedDuplicates: residents.length - r.count } });
  res.status(201).json({ created: r.count, skippedDuplicates: residents.length - r.count });
}));

// POST /api/billing/:id/pay — record a CASH / BANK_TRANSFER receipt. Staff only.
// (Residents pay online through the payment-gateway flow; they can no longer mark their own bills paid.)
router.post('/:id/pay', authenticate, authorize(...FINANCE), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const method = H.oneOf(req.body?.method || 'CASH', ['CASH', 'BANK_TRANSFER'], 'method');
  const amount = new Prisma.Decimal(H.money(req.body?.amount));
  const key = req.get('Idempotency-Key');

  const bill = await prisma.bill.findFirst({ where: { id }, include: { resident: true } });
  if (!bill) throw H.notFound('Bill');
  if (['PAID', 'WAIVED', 'VOID'].includes(bill.status)) throw H.conflict(`Bill is already ${bill.status}`, 'BILL_CLOSED');
  const outstanding = bill.amount.minus(bill.amountPaid);
  if (amount.gt(outstanding)) throw H.conflict(`Amount exceeds the outstanding balance (${fmt(outstanding.toString(), req)})`, 'OVERPAYMENT');

  // One atomic statement: increment + payment row. The DB CHECK (amountPaid <= amount) stops concurrent over-payment.
  const updated = await prisma.bill.update({ where: { id }, data: {
    amountPaid: { increment: amount },
    payments: { create: { tenantId: req.tenant.id, amount, currency: bill.currency, method, status: 'SUCCEEDED', provider: key ? 'MANUAL' : null, providerRef: key || null, reference: H.str(req.body?.reference, { max: 120 }), notes: H.str(req.body?.notes, { max: 300 }), recordedById: req.user.id } },
  }, include: { payments: { orderBy: { paidAt: 'desc' }, take: 1 } } });

  const settled = updated.amountPaid.gte(updated.amount);
  await prisma.bill.update({ where: { id }, data: settled ? { status: 'PAID', paidAt: new Date() } : (bill.status === 'UNPAID' ? { status: 'PARTIAL' } : {}) });
  await notify(bill.resident.userId, '✅ Payment Recorded', `Payment of ${fmt(amount.toString(), req)} for "${bill.title}" recorded.`, 'BILLING', { billId: id });
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'BILL_PAYMENT_RECORDED', entity: 'Bill', entityId: id, after: { amount: amount.toString(), method, settled } });
  res.status(201).json(updated.payments[0]);
}));

// GET /api/billing/summary — real money: "collected" = recorded payments, not bills flagged PAID
router.get('/summary', authenticate, authorize(...FINANCE), H.wrap(async (req, res) => {
  const rows = await prisma.bill.groupBy({ by: ['status', 'currency'], _sum: { amount: true, amountPaid: true } });
  const cur = req.tenant.currency; const z = new Prisma.Decimal(0);
  const sum = (pred, f) => rows.filter(pred).reduce((s, r) => s.plus(f(r)), z);
  const mine = (r) => r.currency === cur;
  const open = (r) => ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(r.status);
  res.json({
    currency: cur,
    total:   sum((r) => mine(r) && !['VOID', 'WAIVED'].includes(r.status), (r) => r._sum.amount || z).toNumber(),
    paid:    sum(mine, (r) => r._sum.amountPaid || z).toNumber(),
    unpaid:  sum((r) => mine(r) && open(r) && r.status !== 'OVERDUE', (r) => (r._sum.amount || z).minus(r._sum.amountPaid || z)).toNumber(),
    overdue: sum((r) => mine(r) && r.status === 'OVERDUE', (r) => (r._sum.amount || z).minus(r._sum.amountPaid || z)).toNumber(),
    otherCurrencies: [...new Set(rows.filter((r) => !mine(r)).map((r) => r.currency))],
  });
}));

// PUT /api/billing/:id — waive / void / edit note. A bill can NOT be set to PAID by hand (only payments do that).
router.put('/:id', authenticate, authorize(...FINANCE), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const data = {};
  const bill = await prisma.bill.findFirst({ where: { id } });
  if (!bill) throw H.notFound('Bill');
  if (req.body?.status !== undefined) {
    const s = H.oneOf(req.body.status, ['WAIVED', 'VOID'], 'status');
    if (s === 'VOID' && bill.amountPaid.gt(0)) throw H.conflict('A bill with payments cannot be voided', 'HAS_PAYMENTS');
    if (['PAID', 'VOID'].includes(bill.status)) throw H.conflict(`Bill is already ${bill.status}`, 'BILL_CLOSED');
    data.status = s;
  }
  if (req.body?.description !== undefined) data.description = H.str(req.body.description, { max: 500 });
  if (!Object.keys(data).length) throw H.bad('Nothing to update');
  const out = await prisma.bill.update({ where: { id }, data });
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'BILL_UPDATED', entity: 'Bill', entityId: id, before: { status: bill.status }, after: data });
  res.json(out);
}));

module.exports = router;
