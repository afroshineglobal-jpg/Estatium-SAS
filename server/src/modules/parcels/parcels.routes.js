'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const prisma = require('../../config/prisma');
const env = require('../../config/env');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { codeLimiter } = require('../../middleware/security');
const { notify } = require('../../utils/notify');
const H = require('../../utils/http');

const GATE = ['GUARD', 'SECURITY_ADMIN', 'ADMIN'];
const MAX_OTP_ATTEMPTS = 5;
const genOTP = () => String(crypto.randomInt(100000, 1000000));
// OTPs are stored as keyed hashes; the plaintext only ever exists in the resident's notification.
const hashOtp = (tenantId, parcelId, otp) => crypto.createHmac('sha256', env.JWT_SECRET).update(`${tenantId}:${parcelId}:${otp}`).digest('hex');
const publicParcel = ({ otpHash, otpAttempts, ...p }) => p;                    // eslint-disable-line no-unused-vars

router.get('/', authenticate, H.wrap(async (req, res) => {
  const where = {};
  if (req.user.role === 'RESIDENT') {
    const resident = await prisma.resident.findFirst({ where: { userId: req.user.id } });
    if (!resident) return res.json([]);                // previously: no resident profile => ALL parcels leaked
    where.unitId = resident.unitId;
  }
  res.json((await prisma.parcel.findMany({ where, orderBy: { loggedAt: 'desc' }, take: 100 })).map(publicParcel));
}));

router.post('/', authenticate, authorize(...GATE), H.wrap(async (req, res) => {
  const b = req.body || {};
  const unitId = H.requireId(b.unitId, 'unitId');
  if (!(await prisma.unit.findFirst({ where: { id: unitId } }))) throw H.notFound('Unit');
  const id = crypto.randomUUID(); const otp = genOTP();
  const parcel = await prisma.parcel.create({ data: { id, unitId, senderName: H.str(b.senderName, { max: 120 }), carrier: H.str(b.carrier, { max: 80 }), description: H.str(b.description, { max: 300 }), otpHash: hashOtp(req.tenant.id, id, otp), notifiedAt: new Date() } });
  const residents = await prisma.resident.findMany({ where: { unitId, isActive: true }, select: { userId: true } });
  await Promise.all(residents.map((r) => notify(r.userId, '📦 Parcel Arrived', `A parcel from ${parcel.senderName || 'an unknown sender'} is at the gate. OTP: ${otp}`, 'PARCEL', { parcelId: id })));
  res.status(201).json({ ...publicParcel(parcel), otp });           // the guard sees the OTP once, at logging time (legacy behaviour)
}));

// Collect: the resident of that unit or gate staff, with the OTP; 5 wrong tries lock the parcel for staff override.
router.put('/:id/collect', authenticate, codeLimiter, H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const otp = H.str(req.body?.otp, { name: 'otp', required: true, max: 12 });
  const parcel = await prisma.parcel.findFirst({ where: { id } });
  if (!parcel) throw H.notFound('Parcel');
  if (parcel.status === 'COLLECTED') throw H.conflict('Parcel was already collected', 'ALREADY_COLLECTED');
  if (req.user.role === 'RESIDENT') {
    const mine = await prisma.resident.findFirst({ where: { userId: req.user.id, unitId: parcel.unitId } });
    if (!mine) throw H.forbidden('This parcel is not for your unit');
  } else if (!GATE.includes(req.user.role)) throw H.forbidden();
  if (parcel.otpAttempts >= MAX_OTP_ATTEMPTS) throw new H.HttpError(423, 'Too many wrong OTP attempts — ask the security office to release this parcel', 'LOCKED');

  const given = Buffer.from(hashOtp(req.tenant.id, id, otp)); const want = Buffer.from(parcel.otpHash || '');
  if (!parcel.otpHash || given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    await prisma.parcel.update({ where: { id }, data: { otpAttempts: { increment: 1 } } });
    throw H.bad('Invalid OTP', 'INVALID_OTP');
  }
  const r = await prisma.parcel.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'COLLECTED', collectedAt: new Date() } });
  if (!r.count) throw H.conflict('Parcel was already collected', 'ALREADY_COLLECTED');
  res.json(publicParcel(await prisma.parcel.findFirst({ where: { id } })));
}));

module.exports = router;
