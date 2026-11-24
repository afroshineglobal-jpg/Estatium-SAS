'use strict';
/**
 * Platform-owner advertising control: /api/platform/ads  (permission ads:manage = SUPER_OWNER only).
 * An ad belongs to ONE estate (tenant-scoped, RLS-protected); "all estates" creates one copy per live estate.
 */
const router = require('express').Router();
const prisma = require('../../config/prisma');
const H = require('../../utils/http');
const { requirePerm: need } = require('./platform.auth');
const { audit } = require('../../utils/audit');

const ROLES = ['ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN', 'MAINTENANCE_MANAGER', 'RESIDENT', 'GUARD', 'STAFF'];
const PAGES = ['/', '/residents', '/registrations', '/visitors', '/parcels', '/amenities', '/billing', '/vehicles', '/staff', '/maintenance', '/emergency', '/communication', '/analytics', '/subscription', '/settings', '/exports'];
const pagesList = (v) => { if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null; const a = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()); if (a.some((p) => !PAGES.includes(p))) throw H.bad('Unknown page in pages'); return [...new Set(a)].join(','); };
const url = (v, name) => { const s = H.str(v, { name, max: 700000 }); if (s && !/^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(s)) throw H.bad(`${name} must be an http(s) URL or an image`); return s; };
const A = (req) => ({ req, actorType: 'PLATFORM_USER', actorId: req.actor.id, actorEmail: req.actor.email });
const db = prisma.system;

async function liveTenants() { return db.tenant.findMany({ where: { status: { in: ['TRIAL', 'ACTIVE'] } }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 }); }
async function oneTenant(id) { const t = await db.tenant.findFirst({ where: { id: H.requireId(id, 'tenantId') }, select: { id: true, name: true } }); if (!t) throw H.notFound('Estate'); return t; }

router.get('/', need('ads:manage'), H.wrap(async (req, res) => {
  const tenants = req.query.tenantId ? [await oneTenant(req.query.tenantId)] : await liveTenants();
  const out = [];
  for (const t of tenants) {
    const rows = await prisma.forTenant(t.id).advertisement.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, title: true, content: true, advertiserName: true, linkUrl: true, startDate: true, endDate: true, status: true, isActive: true, impressions: true, clicks: true, targetRole: true, imageUrl: true, placement: true, pages: true } });
    rows.forEach((r) => out.push({ ...r, imageUrl: r.imageUrl ? 'yes' : null, tenantId: t.id, tenantName: t.name }));
  }
  res.json(out);
}));

router.post('/', need('ads:manage'), H.wrap(async (req, res) => {
  const b = req.body || {};
  const startDate = H.date(b.startDate, 'startDate'), endDate = H.date(b.endDate, 'endDate');
  if (endDate < startDate) throw H.bad('endDate must be after startDate');
  const data = { title: H.str(b.title, { name: 'title', required: true, max: 160 }), content: H.str(b.content, { max: 2000 }), imageUrl: url(b.imageUrl, 'imageUrl'), linkUrl: url(b.linkUrl, 'linkUrl'),
    advertiserName: H.str(b.advertiserName, { max: 120 }), type: 'BANNER', placement: b.placement ? H.oneOf(b.placement, ['TOP', 'BOTTOM'], 'placement') : 'TOP', pages: pagesList(b.pages), targetRole: b.targetRole ? H.oneOf(b.targetRole, ROLES, 'targetRole') : null, startDate, endDate, status: 'APPROVED', isActive: true };
  if (!data.imageUrl && !data.content) throw H.bad('Add a picture or some text for the banner');
  const targets = b.tenantId === 'ALL' ? await liveTenants() : [await oneTenant(b.tenantId)];
  const ids = [];
  for (const t of targets) { const ad = await prisma.forTenant(t.id).advertisement.create({ data }); ids.push(ad.id); await audit({ ...A(req), tenantId: t.id, action: 'AD_CREATED', entity: 'Advertisement', entityId: ad.id, after: { title: data.title, startDate, endDate } }); }
  res.status(201).json({ created: ids.length });
}));

router.post('/:id/stop', need('ads:manage'), H.wrap(async (req, res) => {
  const t = await oneTenant(req.body?.tenantId);
  const r = await prisma.forTenant(t.id).advertisement.updateMany({ where: { id: H.requireId(req.params.id) }, data: { status: 'EXPIRED', isActive: false } });
  if (!r.count) throw H.notFound('Advertisement');
  await audit({ ...A(req), tenantId: t.id, action: 'AD_STOPPED', entity: 'Advertisement', entityId: req.params.id });
  res.json({ stopped: true });
}));

router.delete('/:id', need('ads:manage'), H.wrap(async (req, res) => {
  const t = await oneTenant(req.query.tenantId);
  const r = await prisma.forTenant(t.id).advertisement.deleteMany({ where: { id: H.requireId(req.params.id) } });
  if (!r.count) throw H.notFound('Advertisement');
  await audit({ ...A(req), tenantId: t.id, action: 'AD_DELETED', entity: 'Advertisement', entityId: req.params.id });
  res.json({ deleted: true });
}));

module.exports = router;
