'use strict';
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { Prisma } = prisma;
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { notify } = require('../../utils/notify');
const H = require('../../utils/http');

const STAFF = ['ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN', 'MAINTENANCE_MANAGER', 'GUARD'];
const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const dayOf = (v) => { const s = String(v); const m = s.match(/^\d{4}-\d{2}-\d{2}/); if (m) return m[0]; return H.date(v, 'date').toISOString().slice(0, 10); };
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00.000Z`);          // estate wall-clock stored as naive UTC (matches the exclusion constraint)

router.get('/', authenticate, H.wrap(async (req, res) => res.json(await prisma.amenity.findMany({ where: { isActive: true }, include: { slots: true } }))));
router.get('/all', authenticate, authorize('ADMIN'), H.wrap(async (req, res) => res.json(await prisma.amenity.findMany({ include: { slots: true }, orderBy: { name: 'asc' } }))));

function amenityData(b, partial) {
  const d = {};
  if (!partial || b.name !== undefined) d.name = H.str(b.name, { name: 'name', required: true, max: 120 });
  if (b.description !== undefined) d.description = H.str(b.description, { max: 500 });
  if (b.capacity !== undefined) d.capacity = b.capacity === '' || b.capacity === null ? null : H.int(b.capacity, { min: 1, max: 100000, name: 'capacity' });
  if (b.pricePerHour !== undefined) d.pricePerHour = b.pricePerHour === '' || b.pricePerHour === null ? null : H.money(b.pricePerHour, { name: 'pricePerHour', allowZero: true });
  if (b.isActive !== undefined) d.isActive = !!b.isActive;
  if (b.image !== undefined) d.image = H.str(b.image, { max: 700000 });
  return d;                                              // whitelist: no more {...req.body} mass assignment
}
router.post('/', authenticate, authorize('ADMIN'), H.wrap(async (req, res) => res.status(201).json(await prisma.amenity.create({ data: amenityData(req.body || {}, false) }))));
router.put('/:id', authenticate, authorize('ADMIN'), H.wrap(async (req, res) => res.json(await prisma.amenity.update({ where: { id: H.requireId(req.params.id) }, data: amenityData(req.body || {}, true) }))));

router.get('/bookings', authenticate, H.wrap(async (req, res) => {
  const where = {};
  if (req.user.role === 'RESIDENT') where.userId = req.user.id;
  if (req.query.amenityId) where.amenityId = H.requireId(req.query.amenityId, 'amenityId');
  if (req.query.date) { const d = at(dayOf(req.query.date), '00:00'); where.date = { gte: d, lt: new Date(d.getTime() + 86400000) }; }
  res.json(await prisma.amenityBooking.findMany({ where, include: { amenity: true, user: { select: { name: true } } }, orderBy: { date: 'asc' }, take: 1000 }));
}));

// Calendar for one amenity. Neighbours' names are only shown to staff.
router.get('/:id/availability', authenticate, H.wrap(async (req, res) => {
  const [y, m] = (req.query.month || new Date().toISOString().slice(0, 7)).split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw H.bad('month must be YYYY-MM');
  const staff = STAFF.includes(req.user.role);
  res.json(await prisma.amenityBooking.findMany({
    where: { amenityId: H.requireId(req.params.id), status: { in: ['PENDING', 'APPROVED'] }, date: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } },
    select: { id: true, date: true, startTime: true, endTime: true, status: true, ...(staff ? { user: { select: { name: true } } } : {}) }, orderBy: { date: 'asc' },
  }));
}));

router.post('/bookings', authenticate, authorize('RESIDENT', 'ADMIN'), H.wrap(async (req, res) => {
  const b = req.body || {};
  const amenity = await prisma.amenity.findFirst({ where: { id: H.requireId(b.amenityId, 'amenityId'), isActive: true } });
  if (!amenity) throw H.notFound('Amenity');
  const startTime = H.hhmm(b.startTime, 'startTime'), endTime = H.hhmm(b.endTime, 'endTime');
  const mins = minutes(endTime) - minutes(startTime);
  if (mins <= 0) throw H.bad('End time must be after start time');
  if (mins > 12 * 60) throw H.bad('A booking cannot exceed 12 hours');
  const day = dayOf(b.date);
  if (at(day, '23:59').getTime() < Date.now() - 86400000) throw H.bad('Cannot book in the past');

  // friendly message first; the DB exclusion constraint is the authority (two concurrent requests cannot both win)
  const clash = await prisma.amenityBooking.findFirst({ where: { amenityId: amenity.id, status: { in: ['PENDING', 'APPROVED'] }, startAt: { lt: at(day, endTime) }, endAt: { gt: at(day, startTime) } } });
  if (clash) throw H.conflict(`Time slot conflicts with an existing booking (${clash.startTime}–${clash.endTime}). Please choose a different time.`, 'SLOT_TAKEN');

  const total = amenity.pricePerHour ? amenity.pricePerHour.mul(new Prisma.Decimal(mins).div(60)).toDecimalPlaces(2) : new Prisma.Decimal(0);
  const booking = await prisma.amenityBooking.create({ data: { amenityId: amenity.id, userId: req.user.id, date: at(day, '00:00'), startTime, endTime, startAt: at(day, startTime), endAt: at(day, endTime), totalAmount: total, notes: H.str(b.notes, { max: 300 }) } });
  await notify(req.user.id, '📅 Booking Submitted', `${amenity.name} booking pending approval.`, 'GENERAL');
  res.status(201).json(booking);
}));

// Resident cancels their own booking
router.put('/bookings/:id/cancel', authenticate, H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const where = { id, status: { in: ['PENDING', 'APPROVED'] }, ...(req.user.role === 'RESIDENT' ? { userId: req.user.id } : {}) };
  const r = await prisma.amenityBooking.updateMany({ where, data: { status: 'CANCELLED' } });
  if (!r.count) throw H.notFound('Booking');
  res.json({ success: true });
}));

// Admin decision. Idempotent: the bill is keyed on the booking, so re-approving can never bill twice.
router.put('/bookings/:id/status', authenticate, authorize('ADMIN'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const status = H.oneOf(req.body?.status, ['APPROVED', 'REJECTED', 'CANCELLED'], 'status');
  const current = await prisma.amenityBooking.findFirst({ where: { id }, include: { amenity: true } });
  if (!current) throw H.notFound('Booking');
  if (current.status === status) return res.json(current);
  if (current.status !== 'PENDING' && !(current.status === 'APPROVED' && status === 'CANCELLED')) throw H.conflict(`Booking is already ${current.status}`, 'BAD_TRANSITION');
  const booking = await prisma.amenityBooking.update({ where: { id }, data: { status }, include: { amenity: true } });
  await notify(booking.userId, 'Booking Update', status === 'APPROVED' ? `✅ Your ${booking.amenity.name} booking is approved!` : `❌ Your ${booking.amenity.name} booking was ${status === 'REJECTED' ? 'rejected' : 'cancelled'}.`, 'GENERAL');

  if (status === 'APPROVED' && booking.totalAmount && booking.totalAmount.gt(0)) {
    const resident = await prisma.resident.findFirst({ where: { userId: booking.userId } });
    if (resident) await prisma.bill.createMany({ skipDuplicates: true, data: [{ residentId: resident.id, title: `${booking.amenity.name} Booking`, amount: booking.totalAmount, currency: req.tenant.currency, dueDate: booking.date, type: 'AMENITY', sourceType: 'AMENITY_BOOKING', sourceId: booking.id }] });
  }
  res.json(booking);
}));

module.exports = router;
