'use strict';
/**
 * Background jobs (billing cycle, overdue bills). Safe to run on every app instance: a PostgreSQL
 * transaction-level advisory lock guarantees only one instance executes a run at a time.
 * Disable with RUN_JOBS=false (e.g. on web-only replicas) and run `node -e "require('./src/jobs/scheduler').runOnce()"` from cron instead.
 */
const prisma = require('../config/prisma');
const B = require('../modules/platform/billing.service');

const LOCK_KEY = 727301;
const HOUR = 3600 * 1000;

async function markOverdueBills(now) {
  const tenants = await prisma.system.tenant.findMany({ where: { status: { in: ['TRIAL', 'ACTIVE', 'SUSPENDED'] } }, select: { id: true } });
  let n = 0;
  for (const t of tenants) {
    try {
      const r = await prisma.withTenant(t.id, () => prisma.bill.updateMany({ where: { status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: now } }, data: { status: 'OVERDUE' } }));
      n += r.count;
    } catch (e) { console.error(`[jobs] overdue ${t.id}:`, e.message); }
  }
  return n;
}

/** Monthly maintenance invoices for estates that switched on automatic billing (Settings > Billing). Idempotent per resident per month. */
async function generateMonthlyMaintenance(now) {
  const Inv = require('../billing/invoice'); const { notifyMany } = require('../utils/notify');
  const tenants = await prisma.system.tenant.findMany({ where: { status: { in: ['TRIAL', 'ACTIVE'] } }, select: { id: true, currency: true } });
  let made = 0;
  for (const t of tenants) {
    try {
      made += await prisma.withTenant(t.id, async () => {
        const cfg = await Inv.loadConfig(prisma);
        if (!cfg.monthly.auto || !(cfg.monthly.amount > 0) || now.getUTCDate() < cfg.monthly.day) return 0;
        const ym = now.toISOString().slice(0, 7); const monthName = now.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + cfg.monthly.dueDays));
        const residents = await prisma.resident.findMany({ where: { isActive: true }, select: { id: true, userId: true } });
        if (!residents.length) return 0;
        const p = Inv.price(cfg, 'MAINTENANCE', cfg.monthly.amount); const startedAt = new Date(Date.now() - 1000);
        const r = await prisma.bill.createMany({ skipDuplicates: true, data: residents.map((x) => ({ residentId: x.id, title: `Maintenance charge ${monthName}`, ...p, currency: t.currency, dueDate: due, type: 'MAINTENANCE', sourceType: 'MONTHLY', sourceId: `${ym}:${x.id}` })) });
        if (r.count) { const fresh = await prisma.bill.findMany({ where: { sourceType: 'MONTHLY', sourceId: { startsWith: `${ym}:` }, createdAt: { gte: startedAt } }, select: { resident: { select: { userId: true } } } }); await notifyMany(fresh.map((b) => b.resident.userId), '💰 New Invoice', `Your maintenance invoice for ${monthName} is ready.`, 'BILLING', {}); }
        return r.count;
      });
    } catch (e) { console.error(`[jobs] monthly maintenance ${t.id}:`, e.message); }
  }
  return made;
}

async function runOnce(now = new Date()) {
  return prisma.system.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
    if (!locked) return { skipped: 'another instance holds the lock' };
    const billing = await B.runBillingCycle(now);
    const overdueBills = await markOverdueBills(now);
    let monthlyInvoices = 0; try { monthlyInvoices = await generateMonthlyMaintenance(now); } catch (e) { console.error('[jobs] monthly maintenance failed:', e.message); }
    let selfiesPurged = 0; try { selfiesPurged = await require('../modules/registration/registration.service').purgeSelfies(now); } catch (e) { console.error('[jobs] selfie purge failed:', e.message); }
    return { billing, overdueBills, monthlyInvoices, selfiesPurged };
  }, { timeout: 10 * 60 * 1000, maxWait: 10000 });
}

function start() {
  const tick = async () => { try { const r = await runOnce(); console.log('[jobs]', JSON.stringify(r)); } catch (e) { console.error('[jobs] run failed:', e.message); } };
  setTimeout(tick, 30 * 1000).unref();
  setInterval(tick, HOUR).unref();
}

module.exports = { start, runOnce, markOverdueBills, generateMonthlyMaintenance };
