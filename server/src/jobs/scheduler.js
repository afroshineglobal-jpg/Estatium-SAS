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

async function runOnce(now = new Date()) {
  return prisma.system.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
    if (!locked) return { skipped: 'another instance holds the lock' };
    const billing = await B.runBillingCycle(now);
    const overdueBills = await markOverdueBills(now);
    return { billing, overdueBills };
  }, { timeout: 10 * 60 * 1000, maxWait: 10000 });
}

function start() {
  const tick = async () => { try { const r = await runOnce(); console.log('[jobs]', JSON.stringify(r)); } catch (e) { console.error('[jobs] run failed:', e.message); } };
  setTimeout(tick, 30 * 1000).unref();
  setInterval(tick, HOUR).unref();
}

module.exports = { start, runOnce, markOverdueBills };
