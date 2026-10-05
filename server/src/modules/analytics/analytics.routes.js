'use strict';
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { Prisma } = prisma;
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const H = require('../../utils/http');

const Z = new Prisma.Decimal(0);
const num = (d) => (d ? new Prisma.Decimal(d).toNumber() : 0);

router.get('/dashboard', authenticate, authorize('ADMIN', 'FINANCE_ADMIN', 'SECURITY_ADMIN', 'MAINTENANCE_MANAGER'), H.wrap(async (req, res) => {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const thisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const cur = req.tenant.currency;
  const open = ['UNPAID', 'PARTIAL', 'OVERDUE'];

  const [totalResidents, occupiedUnits, totalUnits, visitorsToday, visitorsInside, pendingMaintenance, activeEmergencies, billAgg, paymentsMonth, parcelsAwaiting, newResidentsMonth] = await Promise.all([
    prisma.resident.count({ where: { isActive: true } }),
    prisma.unit.count({ where: { isActive: true, residents: { some: { isActive: true } } } }),     // occupancy is DERIVED (the isOccupied flag drifted)
    prisma.unit.count({ where: { isActive: true } }),
    prisma.visitor.count({ where: { createdAt: { gte: today } } }),
    prisma.visitor.count({ where: { status: 'INSIDE' } }),
    prisma.maintenanceRequest.count({ where: { status: { in: ['OPEN', 'ASSIGNED'] } } }),
    prisma.emergencyReport.count({ where: { status: 'ACTIVE' } }),
    prisma.bill.aggregate({ where: { currency: cur, status: { in: [...open, 'PAID'] } }, _sum: { amount: true, amountPaid: true } }),
    prisma.payment.aggregate({ where: { currency: cur, status: 'SUCCEEDED', paidAt: { gte: thisMonth } }, _sum: { amount: true } }),
    prisma.parcel.count({ where: { status: 'PENDING' } }),
    prisma.resident.count({ where: { createdAt: { gte: thisMonth } } }),
  ]);
  const billed = billAgg._sum.amount || Z, collected = billAgg._sum.amountPaid || Z;
  res.json({
    currency: cur,
    residents: { total: totalResidents, new: newResidentsMonth },
    occupancy: { occupied: occupiedUnits, total: totalUnits, rate: totalUnits ? Math.round((occupiedUnits / totalUnits) * 100) : 0 },
    visitors: { today: visitorsToday, inside: visitorsInside },
    maintenance: { pending: pendingMaintenance },
    emergency: { active: activeEmergencies },
    billing: { collected: num(collected), outstanding: num(billed.minus(collected)), thisMonth: num(paymentsMonth._sum.amount) },
    parcels: { pending: parcelsAwaiting },
  });
}));

// One query, bucketed in memory (was 7 sequential queries)
router.get('/visitor-trends', authenticate, authorize('ADMIN', 'SECURITY_ADMIN', 'GUARD'), H.wrap(async (req, res) => {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - 6);
  const rows = await prisma.visitor.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true } });
  const buckets = new Map(Array.from({ length: 7 }, (_, i) => [new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10), 0]));
  for (const r of rows) { const k = r.createdAt.toISOString().slice(0, 10); if (buckets.has(k)) buckets.set(k, buckets.get(k) + 1); }
  res.json([...buckets].map(([date, count]) => ({ date, count })));
}));

router.get('/billing-breakdown', authenticate, authorize('ADMIN', 'FINANCE_ADMIN'), H.wrap(async (req, res) => {
  res.json(await prisma.bill.groupBy({ by: ['type'], where: { currency: req.tenant.currency }, _sum: { amount: true }, _count: true }));
}));

module.exports = router;
