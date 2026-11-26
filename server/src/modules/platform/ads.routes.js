'use strict';
/**
 * Platform-owner advertising control: /api/platform/ads  (permission ads:manage = SUPER_OWNER only).
 * A campaign is ONE record. Where it runs is its `targeting` (see utils/adTargeting.js): whole countries/states/LGAs/cities/areas/localities,
 * ZIP prefixes, chosen estates, or individual flats. It is resolved when a resident opens the app, so estates that join later are covered.
 */
const router = require('express').Router();
const prisma = require('../../config/prisma');
const H = require('../../utils/http');
const { requirePerm: need } = require('./platform.auth');
const { audit } = require('../../utils/audit');
const T = require('../../utils/adTargeting');

const PAGES = ['/', '/residents', '/registrations', '/visitors', '/parcels', '/amenities', '/billing', '/vehicles', '/staff', '/maintenance', '/emergency', '/communication', '/analytics', '/subscription', '/settings', '/exports'];
const pagesList = (v) => { if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null; const a = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()); if (a.some((p) => !PAGES.includes(p))) throw H.bad('Unknown page in pages'); return [...new Set(a)].join(','); };
const url = (v, name) => { const s = H.str(v, { name, max: 700000 }); if (s && !/^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(s)) throw H.bad(`${name} must be an http(s) URL or an image`); return s; };
const A = (req) => ({ req, actorType: 'PLATFORM_USER', actorId: req.actor.id, actorEmail: req.actor.email });
const db = prisma.system;

const liveTenants = () => db.tenant.findMany({ where: { status: { in: ['TRIAL', 'ACTIVE'] } }, select: { id: true, name: true, slug: true, country: true, state: true, district: true, city: true, area: true, locality: true, postalCode: true }, orderBy: { name: 'asc' }, take: 1000 });

/** Estates / flats / people the targeting reaches. Counts only. */
async function reach(targeting) {
  const tenants = await liveTenants();
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const rows = await db.$queryRaw`SELECT * FROM platform_reach_units()`;
  const hit = new Set(); const r = { estates: 0, flats: 0, owners: 0, tenants: 0, family: 0 };
  for (const t of tenants) if (T.matchesEstate(targeting, t) || T.hasFlatsFor(targeting, t.id)) hit.add(t.id);
  for (const row of rows) { const t = byId.get(row.tenantId); if (!t || !T.matches(targeting, t, row.unitId)) continue; r.flats += 1; r.owners += row.owners; r.tenants += row.residents - row.owners; r.family += row.family; }
  r.estates = hit.size;
  return { ...r, residents: r.owners + r.tenants, estateNames: tenants.filter((t) => hit.has(t.id)).slice(0, 12).map((t) => t.name) };
}

router.get('/', need('ads:manage'), H.wrap(async (req, res) => {
  const rows = await db.adCampaign.findMany({ orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, title: true, content: true, advertiserName: true, linkUrl: true, imageUrl: true, placement: true, pages: true, startDate: true, endDate: true, status: true, targeting: true, impressions: true, clicks: true } });
  res.json(rows.map((r) => ({ ...r, imageUrl: r.imageUrl ? 'yes' : null, targetSummary: T.summarize(r.targeting) })));
}));

// Places that exist among live estates, with how many estates each covers: the picker only offers real places.
router.get('/places', need('ads:manage'), H.wrap(async (req, res) => {
  const tenants = await liveTenants();
  const count = (level, label) => {
    const m = new Map();
    for (const t of tenants) { const key = T.placeKey(level, t); if (!key) continue; const e = m.get(key) || { key, label: label(t), estates: 0 }; e.estates += 1; m.set(key, e); }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  };
  const sub = (t, v) => `${v}${t.state ? `, ${t.state}` : ''}`;
  res.json({
    countries: count('countries', (t) => t.country), states: count('states', (t) => sub({ state: t.country }, t.state)),
    districts: count('districts', (t) => sub(t, t.district)), cities: count('cities', (t) => sub(t, t.city)),
    areas: count('areas', (t) => sub(t, t.area)), localities: count('localities', (t) => sub(t, t.locality)),
    estates: tenants.map((t) => ({ id: t.id, label: t.name, sub: [t.locality, t.state].filter(Boolean).join(', ') })),
    postalCodes: [...new Set(tenants.map((t) => t.postalCode).filter(Boolean))].sort(),
  });
}));

router.get('/estates/:tenantId/flats', need('ads:manage'), H.wrap(async (req, res) => {
  const t = await db.tenant.findFirst({ where: { id: H.requireId(req.params.tenantId, 'tenantId') }, select: { id: true } });
  if (!t) throw H.notFound('Estate');
  const units = await prisma.forTenant(t.id).unit.findMany({ where: { isActive: true }, select: { id: true, unitNumber: true, block: { select: { name: true } } }, orderBy: [{ block: { name: 'asc' } }, { unitNumber: 'asc' }], take: 3000 });
  res.json(units.map((u) => ({ id: u.id, label: `${u.block?.name ? `${u.block.name}-` : ''}${u.unitNumber}` })));
}));

router.post('/reach', need('ads:manage'), H.wrap(async (req, res) => {
  let g; try { g = T.sanitize(req.body?.targeting); } catch { return res.json({ estates: 0, flats: 0, owners: 0, tenants: 0, residents: 0, family: 0, estateNames: [], empty: true }); }
  res.json(await reach(g));
}));

router.post('/', need('ads:manage'), H.wrap(async (req, res) => {
  const b = req.body || {};
  const startDate = H.date(b.startDate, 'startDate'), endDate = H.date(b.endDate, 'endDate');
  if (endDate < startDate) throw H.bad('endDate must be after startDate');
  let targeting; try { targeting = T.sanitize(b.targeting); } catch (e) { throw H.bad(e.message); }
  const data = { title: H.str(b.title, { name: 'title', required: true, max: 160 }), content: H.str(b.content, { max: 2000 }), imageUrl: url(b.imageUrl, 'imageUrl'), linkUrl: url(b.linkUrl, 'linkUrl'),
    advertiserName: H.str(b.advertiserName, { max: 120 }), placement: b.placement ? H.oneOf(b.placement, ['TOP', 'BOTTOM'], 'placement') : 'TOP', pages: pagesList(b.pages), startDate, endDate, status: 'ACTIVE', targeting, createdById: req.actor.id };
  if (!data.imageUrl && !data.content) throw H.bad('Add a picture or some text for the banner');
  const ad = await db.adCampaign.create({ data });
  const r = await reach(targeting);
  await audit({ ...A(req), action: 'AD_CREATED', entity: 'AdCampaign', entityId: ad.id, after: { title: data.title, startDate, endDate, targeting: T.summarize(targeting), estates: r.estates } });
  res.status(201).json({ id: ad.id, reach: r });
}));

router.post('/:id/stop', need('ads:manage'), H.wrap(async (req, res) => {
  const r = await db.adCampaign.updateMany({ where: { id: H.requireId(req.params.id) }, data: { status: 'STOPPED' } });
  if (!r.count) throw H.notFound('Advertisement');
  await audit({ ...A(req), action: 'AD_STOPPED', entity: 'AdCampaign', entityId: req.params.id });
  res.json({ stopped: true });
}));

router.get('/:id/stats', need('ads:manage'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const rows = await db.adCampaignStat.findMany({ where: { campaignId: id } });
  const names = new Map((await db.tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  res.json(rows.map((r) => ({ estate: names.get(r.tenantId) || r.tenantId, impressions: r.impressions, clicks: r.clicks })).sort((a, b) => b.impressions - a.impressions));
}));

router.delete('/:id', need('ads:manage'), H.wrap(async (req, res) => {
  const r = await db.adCampaign.deleteMany({ where: { id: H.requireId(req.params.id) } });
  if (!r.count) throw H.notFound('Advertisement');
  await audit({ ...A(req), action: 'AD_DELETED', entity: 'AdCampaign', entityId: req.params.id });
  res.json({ deleted: true });
}));

module.exports = router;
