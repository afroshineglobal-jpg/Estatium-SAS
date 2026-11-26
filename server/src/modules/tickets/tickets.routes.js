'use strict';
/**
 * Feedback tickets raised by any estate user (usually residents) and answered by the platform owner.
 * Tickets are platform data: every query here filters by BOTH tenantId and userId, so a person only ever sees their own.
 */
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate } = require('../../middleware/auth.middleware');
const H = require('../../utils/http');
const C = require('./tickets.constants');
const db = prisma.system;

const mine = (req) => ({ tenantId: req.tenant.id, userId: req.user.id });

router.get('/', authenticate, H.wrap(async (req, res) => {
  const rows = await db.ticket.findMany({ where: mine(req), orderBy: { lastMessageAt: 'desc' }, take: 100,
    select: { id: true, subject: true, category: true, status: true, unreadForUser: true, createdAt: true, lastMessageAt: true } });
  res.json(rows.map((t) => ({ ...t, statusLabel: C.STATUS_LABEL[t.status] })));
}));

router.get('/unread', authenticate, H.wrap(async (req, res) => res.json({ count: await db.ticket.count({ where: { ...mine(req), unreadForUser: true } }) })));

router.post('/', authenticate, H.wrap(async (req, res) => {
  const b = req.body || {};
  const category = b.category ? H.oneOf(b.category, C.CATEGORIES, 'category') : 'IDEA';
  const subject = H.str(b.subject, { name: 'subject', required: true, max: 140 });
  const message = H.str(b.message, { name: 'message', required: true, max: 3000 });
  const since = new Date(Date.now() - 86400000);
  if (await db.ticket.count({ where: { ...mine(req), createdAt: { gte: since } } }) >= C.MAX_PER_DAY) throw H.conflict(`You can raise at most ${C.MAX_PER_DAY} tickets a day. Please add to an existing ticket instead.`, 'TICKET_LIMIT');
  const me = await prisma.resident.findFirst({ where: { userId: req.user.id }, include: { unit: { include: { block: true } } } });
  const unitLabel = me?.unit ? `${me.unit.block?.name ? `${me.unit.block.name}-` : ''}${me.unit.unitNumber}` : null;
  const t = await db.ticket.create({ data: { ...mine(req), userName: req.user.name || 'Resident', userRole: req.user.role, unitLabel, category, subject,
    messages: { create: { fromPlatform: false, authorName: req.user.name || 'Resident', body: message } } } });
  res.status(201).json({ id: t.id });
}));

router.get('/:id', authenticate, H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const t = await db.ticket.findFirst({ where: { id, ...mine(req) }, include: { messages: { orderBy: { createdAt: 'asc' }, take: 300 } } });
  if (!t) throw H.notFound('Ticket');
  if (t.unreadForUser) await db.ticket.update({ where: { id }, data: { unreadForUser: false } });
  res.json({ ...t, unreadForUser: false, statusLabel: C.STATUS_LABEL[t.status] });
}));

router.post('/:id/reply', authenticate, H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const body = H.str(req.body?.message, { name: 'message', required: true, max: 3000 });
  const t = await db.ticket.findFirst({ where: { id, ...mine(req) } });
  if (!t) throw H.notFound('Ticket');
  if (t.status === 'CLOSED') throw H.conflict('This ticket is closed. Please raise a new one.', 'TICKET_CLOSED');
  await db.$transaction([
    db.ticketMessage.create({ data: { ticketId: id, fromPlatform: false, authorName: req.user.name || 'Resident', body } }),
    db.ticket.update({ where: { id }, data: { unreadForPlatform: true, lastMessageAt: new Date(), status: t.status === 'DONE' ? 'OPEN' : t.status } }),
  ]);
  res.status(201).json({ success: true });
}));

module.exports = router;
