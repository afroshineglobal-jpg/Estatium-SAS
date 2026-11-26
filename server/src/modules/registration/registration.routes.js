'use strict';
/** Estate-admin side of resident self-registration  —  /api/registrations  (ADMIN only). */
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { wrap } = require('../../utils/http');
const R = require('./registration.service');

router.use(authenticate, authorize('ADMIN'));
router.get('/settings', wrap(async (req, res) => res.json(await R.getSettings(req))));
router.post('/settings', wrap(async (req, res) => res.json(await R.updateSettings(req, { enabled: req.body?.enabled }))));
router.get('/', wrap(async (req, res) => res.json(await R.list(req.query.status))));
router.get('/:id/selfie', wrap(async (req, res) => {
  const file = await R.selfieFile(req.params.id);
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(file);
}));
router.post('/:id/approve', wrap(async (req, res) => res.json(await R.approve(req.params.id, req))));
router.post('/:id/reject', wrap(async (req, res) => res.json(await R.reject(req.params.id, req.body?.reason, req))));
module.exports = router;
