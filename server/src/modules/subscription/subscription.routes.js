'use strict';
/** Tenant-facing, read-only view of the estate's own SaaS subscription  —  /api/subscription (ADMIN, FINANCE_ADMIN).
 *  Always filtered by req.tenant.id taken from the verified JWT; the tenant id is never accepted from the client. */
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { wrap, notFound, requireId } = require('../../utils/http');
const B = require('../platform/billing.service');
const PP = require('../platform/prepaid.service');
const db = prisma.system;

router.use(authenticate, authorize('ADMIN', 'FINANCE_ADMIN'));

router.get('/', wrap(async (req, res) => {
  const tenantId = req.tenant.id;
  const [sub, invoices] = await Promise.all([B.loadSub(tenantId), db.invoice.findMany({ where: { tenantId }, orderBy: { issuedAt: 'desc' }, take: 24 })]);
  let estimate = null; try { estimate = await B.estimateNext(tenantId); } catch { /* no price configured */ }
  const prepaid = sub.billingMode === 'MANUAL_PREPAID' ? PP.view({ trialEndsAt: sub.trialEndsAt, subscription: sub }) : null;
  const payments = prepaid ? await db.prepaidPayment.findMany({ where: { tenantId, status: 'RECORDED' }, orderBy: { paidAt: 'desc' }, take: 24, select: { id: true, amount: true, currency: true, periodFrom: true, periodTo: true, method: true, reference: true, paidAt: true } }) : [];
  res.json({
    status: sub.status, plan: { code: sub.plan.code, name: sub.plan.name }, currency: sub.currency, billingInterval: sub.billingInterval,
    trialEndsAt: sub.trialEndsAt, currentPeriodStart: sub.currentPeriodStart, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    committedUnits: sub.committedUnits, maxUnits: sub.maxUnits, units: estimate?.units ?? null, unitPrice: estimate?.unitPrice ?? null, nextInvoice: estimate, invoices, prepaid, prepaidPayments: payments,
  });
}));

router.get('/invoices/:id', wrap(async (req, res) => {
  const inv = await db.invoice.findFirst({ where: { id: requireId(req.params.id), tenantId: req.tenant.id }, include: { lines: true, payments: { select: { amount: true, method: true, reference: true, paidAt: true } } } });
  if (!inv) throw notFound('Invoice');
  res.json(inv);
}));

module.exports = router;
