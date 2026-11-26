'use strict';
/** Platform owner side of feedback tickets: /api/platform/tickets (permission tickets:manage). */
const router = require('express').Router();
const prisma = require('../../config/prisma');
const H = require('../../utils/http');
const { requirePerm: need } = require('./platform.auth');
const { audit } = require('../../utils/audit');
const { notify } = require('../../utils/notify');
const C = require('../tickets/tickets.constants');
const db = prisma.system;

const A = (req) => ({ req, actorType: 'PLATFORM_USER', actorId: req.actor.id, actorEmail: req.actor.email });
const tell = (t, title, body) => prisma.withTenant(t.tenantId, () => notify(t.userId, title, body, 'GENERAL', { ticketId: t.id })).catch(() => {});

router.get('/', need('tickets:manage'), H.wrap(async (req, res) => {
  const where = {}; if (req.query.status) where.status = H.oneOf(req.query.status, C.STATUSES, 'status');
  const rows = await db.ticket.findMany({ where, orderBy: [{ unreadForPlatform: 'desc' }, { lastMessageAt: 'desc' }], take: 300, include: { tenant: { select: { name: true } } } });
  res.json(rows.map((t) => ({ id: t.id, subject: t.subject, category: t.category, status: t.status, statusLabel: C.STATUS_LABEL[t.status], estate: t.tenant?.name, userName: t.userName, userRole: t.userRole, unitLabel: t.unitLabel, unread: t.unreadForPlatform, createdAt: t.createdAt, lastMessageAt: t.lastMessageAt })));
}));

router.get('/summary', need('tickets:manage'), H.wrap(async (req, res) => res.json({ unread: await db.ticket.count({ where: { unreadForPlatform: true } }), open: await db.ticket.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }) })));

router.get('/:id', need('tickets:manage'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const t = await db.ticket.findFirst({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' }, take: 300 }, tenant: { select: { name: true } } } });
  if (!t) throw H.notFound('Ticket');
  if (t.unreadForPlatform) await db.ticket.update({ where: { id }, data: { unreadForPlatform: false } });
  res.json({ ...t, estate: t.tenant?.name, tenant: undefined, unreadForPlatform: false, statusLabel: C.STATUS_LABEL[t.status] });
}));

router.post('/:id/reply', need('tickets:manage'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id);
  const body = H.str(req.body?.message, { name: 'message', required: true, max: 3000 });
  const t = await db.ticket.findFirst({ where: { id } });
  if (!t) throw H.notFound('Ticket');
  const status = req.body?.status ? H.oneOf(req.body.status, C.STATUSES, 'status') : (t.status === 'OPEN' ? 'IN_REVIEW' : t.status);
  await db.$transaction([
    db.ticketMessage.create({ data: { ticketId: id, fromPlatform: true, authorName: 'Estatium team', body } }),
    db.ticket.update({ where: { id }, data: { status, unreadForUser: true, unreadForPlatform: false, lastMessageAt: new Date() } }),
  ]);
  await tell(t, '💬 Reply from the Estatium team', `"${t.subject}": ${body.slice(0, 120)}`);
  await audit({ ...A(req), action: 'TICKET_REPLIED', entity: 'Ticket', entityId: id, tenantId: t.tenantId });
  res.status(201).json({ success: true });
}));

router.put('/:id/status', need('tickets:manage'), H.wrap(async (req, res) => {
  const id = H.requireId(req.params.id); const status = H.oneOf(req.body?.status, C.STATUSES, 'status');
  const t = await db.ticket.findFirst({ where: { id } });
  if (!t) throw H.notFound('Ticket');
  await db.ticket.update({ where: { id }, data: { status, unreadForUser: status !== t.status ? true : t.unreadForUser, unreadForPlatform: false } });
  if (status !== t.status) await tell(t, '📌 Ticket update', `"${t.subject}" is now: ${C.STATUS_LABEL[status]}`);
  await audit({ ...A(req), action: 'TICKET_STATUS', entity: 'Ticket', entityId: id, tenantId: t.tenantId, after: { status } });
  res.json({ success: true });
}));

module.exports = router;
