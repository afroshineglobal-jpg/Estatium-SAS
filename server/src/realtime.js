'use strict';
/**
 * Socket.IO with authentication and tenant-namespaced rooms.
 * Fixes the legacy server where any anonymous client could join any room, receive every broadcast,
 * fire fake emergency alerts, and read visitor entry codes.
 */
const { Server } = require('socket.io');
const prisma = require('./config/prisma');
const { verifyTenantToken } = require('./utils/tokens');
const { getTenant } = require('./middleware/auth.middleware');
const { originAllowed } = require('./middleware/security');

const rooms = {
  tenant: (tid) => `t:${tid}`,
  user:   (tid, uid) => `t:${tid}:u:${uid}`,
  role:   (tid, role) => `t:${tid}:r:${role}`,
  chat:   (tid, room) => `t:${tid}:c:${room}`,
};
const STAFF = ['ADMIN', 'SECURITY_ADMIN'];

function attachRealtime(server, app) {
  const io = new Server(server, { cors: { origin: (o, cb) => cb(null, originAllowed(o)), credentials: true } });

  io.use(async (socket, next) => {
    try {
      const decoded = verifyTenantToken(socket.handshake.auth?.token || '');
      const tenant = await getTenant(decoded.tid);
      if (!tenant || ['DELETED', 'EXPIRED'].includes(tenant.status)) return next(new Error('unauthorized'));
      const user = await prisma.forTenant(tenant.id).user.findFirst({ where: { id: decoded.sub } });
      if (!user || !user.isActive || user.tokenVersion !== decoded.tv) return next(new Error('unauthorized'));
      const resident = user.role === 'RESIDENT' ? await prisma.forTenant(tenant.id).resident.findFirst({ where: { userId: user.id }, select: { unitId: true } }) : null;
      socket.data = { tenantId: tenant.id, userId: user.id, role: user.role, unitId: resident?.unitId || null };
      next();
    } catch { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    const { tenantId: tid, userId, role } = socket.data;
    socket.join([rooms.tenant(tid), rooms.user(tid, userId), rooms.role(tid, role)]);

    const allowedChat = (room) => room === 'general' || room === 'announcements' || (typeof room === 'string' && room === `unit-${socket.data.unitId}`) || (STAFF.includes(role) && /^unit-[0-9a-f-]{36}$/i.test(room));
    socket.on('join-room', (room) => { if (allowedChat(room)) socket.join(rooms.chat(tid, room)); });
    socket.on('leave-room', (room) => { if (typeof room === 'string') socket.leave(rooms.chat(tid, room)); });
    // Client-originated 'send-message' / 'emergency-sos' broadcasts were removed: they go through the REST API (authz + persistence).
  });

  app.set('io', io);
  return io;
}

module.exports = { attachRealtime, rooms };
