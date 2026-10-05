'use strict';
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const H = require('../../utils/http');

// Whitelist: only these keys exist for a tenant admin. Currency is a platform-managed tenant property, not a free-text setting.
const SCHEMA = {
  estate_name: (v) => H.str(v, { required: true, max: 120, name: 'estate_name' }),
  estate_address: (v) => H.str(v, { max: 300, name: 'estate_address' }) || '',
  maintenance_charge: (v) => H.money(v, { name: 'maintenance_charge', allowZero: true }),
  security_contact: (v) => H.str(v, { max: 40, name: 'security_contact' }) || '',
  admin_email: (v) => H.str(v, { max: 200, name: 'admin_email' }) || '',
  visitor_auto_expire_hours: (v) => String(H.int(v, { min: 1, max: 720, name: 'visitor_auto_expire_hours' })),
  max_family_members: (v) => String(H.int(v, { min: 1, max: 100, name: 'max_family_members' })),
};

router.get('/', authenticate, H.wrap(async (req, res) => {
  const map = {}; (await prisma.setting.findMany()).forEach((s) => { if (SCHEMA[s.key]) map[s.key] = s.value; });
  res.json({ ...map, currency: req.tenant.currency, currency_locked: true });
}));

router.put('/', authenticate, authorize('ADMIN'), H.wrap(async (req, res) => {
  const entries = Object.entries(req.body || {}).filter(([k]) => k !== 'currency' && k !== 'currency_locked');
  for (const [k] of entries) if (!SCHEMA[k]) throw H.bad(`Unknown setting "${k}"`);
  const clean = entries.map(([k, v]) => [k, SCHEMA[k](v)]);
  await Promise.all(clean.map(([key, value]) => prisma.setting.upsert({ where: { tenantId_key: { tenantId: req.tenant.id, key } }, create: { key, value }, update: { value } })));
  res.json({ success: true });
}));

module.exports = router;
