'use strict';
/**
 * Seed (Prisma). Idempotent.
 *   node prisma/seed.js                 -> reference data only (currencies, plans, FX)      <- production-safe
 *   SEED_DEMO=true node prisma/seed.js  -> + a demo estate "demo" with sample users (NEVER in production)
 * Demo passwords are random and printed once — there are no documented default credentials any more.
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { CURRENCIES, PLANS, FX_USD } = require('./reference-data');

const prisma = new PrismaClient();
const pw = () => `${crypto.randomBytes(9).toString('base64url')}Aa1`;

async function reference() {
  for (const c of CURRENCIES) await prisma.currency.upsert({ where: { code: c.code }, update: {}, create: c });
  for (const p of PLANS) {
    const { prices, ...plan } = p;
    const row = await prisma.plan.upsert({ where: { code: plan.code }, update: {}, create: plan });
    for (const [currency, unitAmount] of Object.entries(prices)) await prisma.planPrice.upsert({ where: { planId_currency: { planId: row.id, currency } }, update: {}, create: { planId: row.id, currency, unitAmount } });
  }
  if (!(await prisma.exchangeRate.count())) await prisma.exchangeRate.createMany({ data: Object.entries(FX_USD).map(([quote, rate]) => ({ base: 'USD', quote, rate: String(rate), source: 'seed' })) });
  console.log('✅ reference data: currencies, plans, prices, FX');
}

async function demo() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  if (await prisma.tenant.findUnique({ where: { slug: 'demo' } })) { console.log('ℹ️  demo estate already exists'); return; }
  const plan = await prisma.plan.findUnique({ where: { code: 'standard' } });
  const now = new Date(); const end = new Date(now.getTime() + 30 * 86400000);
  const tenant = await prisma.tenant.create({ data: { slug: 'demo', name: 'Demo Estate', status: 'ACTIVE', currency: 'USD', timezone: 'UTC', activatedAt: now } });
  await prisma.subscription.create({ data: { tenantId: tenant.id, planId: plan.id, status: 'ACTIVE', currency: 'USD', currentPeriodStart: now, currentPeriodEnd: end } });
  const db = prisma.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) { return query(args); } } } });   // plain client; tenantId set explicitly below

  const block = await db.block.create({ data: { tenantId: tenant.id, name: 'A' } });
  await db.unit.createMany({ data: Array.from({ length: 20 }, (_, i) => ({ tenantId: tenant.id, blockId: block.id, unitNumber: String(i + 1).padStart(3, '0') })) });
  const units = await db.unit.findMany({ where: { tenantId: tenant.id }, orderBy: { unitNumber: 'asc' } });
  const accounts = [['admin@demo.test', 'Demo Admin', 'ADMIN'], ['security@demo.test', 'Security Officer', 'SECURITY_ADMIN'], ['finance@demo.test', 'Finance Manager', 'FINANCE_ADMIN'], ['maintenance@demo.test', 'Maintenance Manager', 'MAINTENANCE_MANAGER'], ['guard@demo.test', 'Gate Guard', 'GUARD'], ['resident@demo.test', 'Demo Resident', 'RESIDENT']];
  const creds = [];
  for (const [email, name, role] of accounts) {
    const p = pw(); creds.push([email, p]);
    const user = await db.user.create({ data: { tenantId: tenant.id, email, name, role, password: await bcrypt.hash(p, 12) } });
    if (role === 'RESIDENT') await db.resident.create({ data: { tenantId: tenant.id, userId: user.id, unitId: units[0].id, residentType: 'OWNER' } });
    if (role === 'GUARD') await db.guard.create({ data: { tenantId: tenant.id, userId: user.id, shift: 'MORNING' } });
  }
  await db.setting.createMany({ data: [['estate_name', 'Demo Estate'], ['visitor_auto_expire_hours', '24'], ['max_family_members', '15']].map(([key, value]) => ({ tenantId: tenant.id, key, value })) });
  console.log('\n✅ demo estate created — log in with estate = "demo". Passwords are shown ONCE:');
  creds.forEach(([e, p]) => console.log(`   ${e.padEnd(26)} ${p}`));
}

(async () => {
  try { await reference(); if (process.env.SEED_DEMO === 'true') await demo(); }
  catch (e) { console.error(e); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
})();
