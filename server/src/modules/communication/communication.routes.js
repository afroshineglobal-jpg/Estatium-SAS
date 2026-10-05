'use strict';
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { rooms } = require('../../realtime');
const H = require('../../utils/http');

const POSTERS = ['ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN'];
const STAFF = ['ADMIN', 'SECURITY_ADMIN'];

/** Who may read/write which chat room: general+announcements = everyone, unit-<id> = that unit's residents + admins. */
async function assertRoomAccess(req, roomId) {
  if (roomId === 'general' || roomId === 'announcements') return;
  const m = /^unit-([0-9a-f-]{36})$/i.exec(roomId || '');
  if (!m) throw H.bad('Unknown room');
  if (STAFF.includes(req.user.role)) return;
  const mine = req.user.role === 'RESIDENT' && await prisma.resident.findFirst({ where: { userId: req.user.id, unitId: m[1] } });
  if (!mine) throw H.forbidden('You are not part of that room');
}

router.get('/notices', authenticate, H.wrap(async (req, res) => {
  const now = new Date();
  res.json(await prisma.notice.findMany({
    where: { AND: [{ OR: [{ type: 'PUBLIC' }, { targetRole: req.user.role }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], take: 50,
  }));
}));

router.post('/notices', authenticate, authorize(...POSTERS), H.wrap(async (req, res) => {
  const b = req.body || {};
  const notice = await prisma.notice.create({ data: {
    title: H.str(b.title, { name: 'title', required: true, max: 160 }), content: H.str(b.content, { name: 'content', required: true, max: 5000 }), type: b.type ? H.oneOf(b.type, ['PUBLIC', 'PRIVATE'], 'type') : 'PUBLIC',
    postedById: req.user.id, targetRole: b.targetRole ? H.oneOf(b.targetRole, ['ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN', 'MAINTENANCE_MANAGER', 'RESIDENT', 'GUARD'], 'targetRole') : null, isPinned: !!b.isPinned, expiresAt: b.expiresAt ? H.date(b.expiresAt, 'expiresAt') : null,
  } });
  const io = req.app.get('io');
  io.to(notice.targetRole ? rooms.role(req.tenant.id, notice.targetRole) : rooms.tenant(req.tenant.id)).emit('new-notice', notice);     // tenant-scoped, role-targeted
  res.status(201).json(notice);
}));

router.delete('/notices/:id', authenticate, authorize('ADMIN'), H.wrap(async (req, res) => {
  const r = await prisma.notice.deleteMany({ where: { id: H.requireId(req.params.id) } });
  if (!r.count) throw H.notFound('Notice');
  res.json({ success: true });
}));

router.get('/messages/:roomId', authenticate, H.wrap(async (req, res) => {
  await assertRoomAccess(req, req.params.roomId);
  const messages = await prisma.message.findMany({ where: { roomId: req.params.roomId }, include: { sender: { select: { name: true, role: true, avatar: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(messages.reverse());
}));

router.post('/messages', authenticate, H.wrap(async (req, res) => {
  const roomId = H.str(req.body?.roomId, { name: 'roomId', required: true, max: 60 }); await assertRoomAccess(req, roomId);
  const message = await prisma.message.create({ data: { senderId: req.user.id, roomId, content: H.str(req.body?.content, { name: 'content', required: true, max: 2000 }), type: 'TEXT' }, include: { sender: { select: { name: true, role: true, avatar: true } } } });
  req.app.get('io').to(rooms.chat(req.tenant.id, roomId)).emit('new-message', message);
  res.status(201).json(message);
}));

// Polls. Votes live in PollVote (unique per user per poll) and are re-assembled into the legacy { optionIndex: [userId] } shape.
async function pollView(poll) {
  const votes = await prisma.pollVote.findMany({ where: { pollId: poll.id }, select: { userId: true, optionIndex: true } });
  const map = {}; for (const v of votes) (map[v.optionIndex] ||= []).push(v.userId);
  return { ...poll, votes: map };
}

router.get('/polls', authenticate, H.wrap(async (req, res) => {
  const polls = await prisma.poll.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
  const votes = await prisma.pollVote.findMany({ where: { pollId: { in: polls.map((p) => p.id) } }, select: { pollId: true, userId: true, optionIndex: true } });
  res.json(polls.map((p) => { const map = {}; votes.filter((v) => v.pollId === p.id).forEach((v) => (map[v.optionIndex] ||= []).push(v.userId)); return { ...p, votes: map }; }));
}));

router.post('/polls', authenticate, authorize('ADMIN'), H.wrap(async (req, res) => {
  const options = Array.isArray(req.body?.options) ? req.body.options.map((o) => H.str(o, { max: 120, required: true, name: 'option' })) : [];
  if (options.length < 2 || options.length > 10) throw H.bad('A poll needs 2-10 options');
  res.status(201).json(await prisma.poll.create({ data: { question: H.str(req.body?.question, { name: 'question', required: true, max: 300 }), options, endsAt: req.body?.endsAt ? H.date(req.body.endsAt, 'endsAt') : null } }));
}));

router.post('/polls/:id/vote', authenticate, H.wrap(async (req, res) => {
  const poll = await prisma.poll.findFirst({ where: { id: H.requireId(req.params.id) } });
  if (!poll) throw H.notFound('Poll');
  if (poll.endsAt && poll.endsAt < new Date()) throw H.conflict('This poll has ended', 'POLL_ENDED');
  const optionIndex = H.int(req.body?.optionIndex, { min: 0, max: poll.options.length - 1, name: 'optionIndex' });
  await prisma.pollVote.upsert({ where: { pollId_userId: { pollId: poll.id, userId: req.user.id } }, create: { pollId: poll.id, userId: req.user.id, optionIndex }, update: { optionIndex } });   // changing your vote replaces it
  res.json(await pollView(poll));
}));

module.exports = router;
