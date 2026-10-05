'use strict';
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { notifyByRole, notify } = require('../../utils/notify');
const { rooms } = require('../../realtime');
const H = require('../../utils/http');

const RESPONDERS = ['ADMIN', 'SECURITY_ADMIN', 'GUARD'];

router.get('/', authenticate, H.wrap(async (req, res) => {
  const where = RESPONDERS.includes(req.user.role) ? {} : { userId: req.user.id };    // residents see only their own reports (and not other people's phone numbers)
  res.json(await prisma.emergencyReport.findMany({ where, include: { user: { select: { name: true, phone: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }));
}));

// SOS: persist, answer immediately, THEN fan out — response time no longer grows with the number of guards/admins.
router.post('/', authenticate, H.wrap(async (req, res) => {
  const b = req.body || {};
  const type = H.str(b.type, { name: 'type', required: true, max: 40 });
  const report = await prisma.emergencyReport.create({ data: { userId: req.user.id, type, description: H.str(b.description, { max: 1000 }), location: H.str(b.location, { max: 200 }), severity: b.severity ? H.oneOf(b.severity, ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], 'severity') : 'HIGH' } });
  res.status(201).json(report);

  try {
    const io = req.app.get('io'); const tid = req.tenant.id;
    const staffRooms = RESPONDERS.map((r) => rooms.role(tid, r));
    io.to(staffRooms).emit('emergency-alert', { report, user: { name: req.user.name, phone: req.user.phone } });                 // responders get the full picture
    io.to(rooms.tenant(tid)).except(staffRooms).emit('emergency-alert', { report: { type: report.type, description: report.description, location: report.location, severity: report.severity }, user: { name: req.user.name } });
    await Promise.all(['GUARD', 'ADMIN', 'SECURITY_ADMIN'].map((role) => notifyByRole(role, '🚨 EMERGENCY!', `${type} at ${report.location || 'estate'}. ${report.description || ''}`.trim(), 'EMERGENCY', { reportId: report.id })));
  } catch (e) { console.error('[emergency] fan-out failed:', e.message); }
}));

router.put('/:id', authenticate, authorize(...RESPONDERS), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const status = H.oneOf(req.body?.status, ['ACKNOWLEDGED', 'RESOLVED'], 'status');
  const data = { status, resolution: H.str(req.body?.resolution, { max: 1000 }) };
  if (status === 'ACKNOWLEDGED') data.respondedAt = new Date(); else data.resolvedAt = new Date();
  const report = await prisma.emergencyReport.update({ where: { id }, data });
  await notify(report.userId, '✅ Emergency Update', `Your ${report.type} report is now ${status}.`, 'EMERGENCY');
  res.json(report);
}));

module.exports = router;
