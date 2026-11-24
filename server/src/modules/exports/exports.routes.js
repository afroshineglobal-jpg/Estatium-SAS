'use strict';
/**
 * Data exports (CSV, opens in Excel). Nothing here changes data. Records of people who moved out or left stay available
 * forever: these endpoints are how the estate extracts history later (residents, visitors, guest vehicles, vehicle
 * movements, staff and staff attendance). Every download is written to the audit log.
 */
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { audit } = require('../../utils/audit');
const { toCsv } = require('../../utils/csvExport');
const H = require('../../utils/http');

const MAX_ROWS = 100000;
const unitLabel = (u) => (u ? `${u.block?.name || ''}-${u.unitNumber}` : '');
const iso = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '');   // UTC, opens as a date in Excel
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function range(q) {
  const out = {};
  if (q.from) out.gte = H.date(q.from, 'from');
  if (q.to) { const t = H.date(q.to, 'to'); t.setUTCDate(t.getUTCDate() + 1); out.lt = t; }         // "to" is inclusive of that whole day
  return Object.keys(out).length ? out : undefined;
}
async function send(req, res, name, rows, columns, what) {
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'DATA_EXPORTED', entity: 'Export', after: { what, rows: rows.length, query: req.query } });
  const stamp = new Date().toISOString().slice(0, 10);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-${stamp}.csv"`, 'Cache-Control': 'no-store' });
  res.send(toCsv(rows, columns));
}
const base = [authenticate, authorize('ADMIN')];
const gate = [authenticate, authorize('ADMIN', 'SECURITY_ADMIN')];

router.get('/residents.csv', ...base, H.wrap(async (req, res) => {
  const st = req.query.status || 'all';
  const where = st === 'all' ? {} : { isActive: H.oneOf(st, ['active', 'vacated'], 'status') === 'active' };
  const rows = await prisma.resident.findMany({ where, include: { user: { select: { name: true, email: true, phone: true } }, unit: { include: { block: true } }, members: true, vehicles: true }, orderBy: { createdAt: 'asc' }, take: MAX_ROWS });
  await send(req, res, 'residents', rows, [
    ['Name', (r) => r.user?.name], ['Email', (r) => r.user?.email], ['Phone', (r) => r.user?.phone], ['Unit', (r) => unitLabel(r.unit)], ['Type', (r) => r.residentType],
    ['Status', (r) => (r.isActive ? 'Living here' : 'Moved out')], ['Move-in date', (r) => day(r.moveInDate)], ['Move-out date', (r) => day(r.moveOutDate)], ['Move-out note', (r) => r.moveOutNote],
    ['Family members', (r) => r.members.map((m) => `${m.name} (${m.relation})`).join('; ')], ['Vehicles', (r) => r.vehicles.map((v) => v.plateNumber).join('; ')],
  ], 'residents');
}));

// Visitors of one resident (or the whole estate); vehiclesOnly=1 gives the guest-vehicle history only.
router.get('/visitors.csv', ...gate, H.wrap(async (req, res) => {
  const where = {};
  if (req.query.residentId) where.residentId = H.requireId(req.query.residentId, 'residentId');
  const rg = range(req.query); if (rg) where.createdAt = rg;
  if (req.query.vehiclesOnly === '1') where.vehicleNumber = { not: null };
  const rows = await prisma.visitor.findMany({ where, include: { resident: { include: { user: { select: { name: true } }, unit: { include: { block: true } } } } }, orderBy: { createdAt: 'asc' }, take: MAX_ROWS });
  await send(req, res, req.query.vehiclesOnly === '1' ? 'guest-vehicles' : 'visitors', rows, [
    ['Date registered (UTC)', (v) => iso(v.createdAt)], ['Visitor', (v) => v.name], ['Phone', (v) => v.phone], ['Type', (v) => v.visitorType], ['Purpose', (v) => v.purpose],
    ['Visiting (resident)', (v) => v.resident?.user?.name], ['Unit', (v) => unitLabel(v.resident?.unit)], ['Resident status', (v) => (v.resident?.isActive ? 'Living here' : 'Moved out')],
    ['Guest vehicle plate', (v) => v.vehicleNumber], ['Pre-approved', (v) => v.preApproved], ['Status', (v) => v.status], ['Entry time (UTC)', (v) => iso(v.entryTime)], ['Exit time (UTC)', (v) => iso(v.exitTime)], ['Guard note', (v) => v.guardNote],
  ], 'visitors');
}));

// Entry/exit log of registered resident vehicles.
router.get('/vehicle-movements.csv', ...gate, H.wrap(async (req, res) => {
  const where = {};
  if (req.query.residentId) where.vehicle = { residentId: H.requireId(req.query.residentId, 'residentId') };
  const rg = range(req.query); if (rg) where.timestamp = rg;
  const rows = await prisma.vehicleLog.findMany({ where, include: { vehicle: { include: { resident: { include: { user: { select: { name: true } }, unit: { include: { block: true } } } } } } }, orderBy: { timestamp: 'asc' }, take: MAX_ROWS });
  await send(req, res, 'vehicle-movements', rows, [
    ['Time (UTC)', (l) => iso(l.timestamp)], ['Movement', (l) => l.action], ['Plate', (l) => l.vehicle?.plateNumber], ['Vehicle', (l) => [l.vehicle?.make, l.vehicle?.model, l.vehicle?.color].filter(Boolean).join(' ')],
    ['Owner', (l) => l.vehicle?.resident?.user?.name], ['Unit', (l) => unitLabel(l.vehicle?.resident?.unit)], ['Owner status', (l) => (l.vehicle?.resident?.isActive ? 'Living here' : 'Moved out')], ['Guard note', (l) => l.guardNote],
  ], 'vehicle-movements');
}));

router.get('/staff.csv', ...base, H.wrap(async (req, res) => {
  const rows = await prisma.staffMember.findMany({ include: { user: { select: { name: true, email: true, phone: true, lastLoginAt: true } } }, orderBy: { createdAt: 'asc' }, take: MAX_ROWS });
  await send(req, res, 'staff', rows, [
    ['Name', (s) => s.user?.name], ['Email', (s) => s.user?.email], ['Phone', (s) => s.user?.phone], ['Role', (s) => s.staffType], ['Employed by', (s) => s.employedBy],
    ['Status', (s) => s.status], ['Reason', (s) => s.statusNote], ['Status changed (UTC)', (s) => iso(s.statusChangedAt)], ['Left on', (s) => day(s.leftAt)], ['Added on', (s) => day(s.createdAt)],
    ['Access from', (s) => s.accessStart], ['Access until', (s) => s.accessEnd], ['Last sign-in (UTC)', (s) => iso(s.user?.lastLoginAt)],
  ], 'staff');
}));

router.get('/staff-attendance.csv', ...base, H.wrap(async (req, res) => {
  const where = {};
  if (req.query.staffId) where.staffId = H.requireId(req.query.staffId, 'staffId');
  const rg = range(req.query); if (rg) where.timestamp = rg;
  const rows = await prisma.attendanceLog.findMany({ where, include: { staff: { include: { user: { select: { name: true } } } } }, orderBy: { timestamp: 'asc' }, take: MAX_ROWS });
  await send(req, res, 'staff-attendance', rows, [['Time (UTC)', (a) => iso(a.timestamp)], ['Staff', (a) => a.staff?.user?.name], ['Role', (a) => a.staff?.staffType], ['Action', (a) => a.action]], 'staff-attendance');
}));

module.exports = router;
