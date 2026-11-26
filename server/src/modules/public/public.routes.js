'use strict';
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { wrap, notFound } = require('../../utils/http');
const { publicLimiter, registrationLimiter } = require('../../middleware/security');
const R = require('../registration/registration.service');

// GET /api/public/tenants/:slug — lets the login page show the estate name; reveals nothing else.
router.get('/tenants/:slug', publicLimiter, wrap(async (req, res) => {
  const t = await prisma.system.tenant.findUnique({ where: { slug: String(req.params.slug).toLowerCase() }, select: { slug: true, name: true, status: true } });
  if (!t || t.status === 'DELETED') throw notFound('Estate');
  res.json({ slug: t.slug, name: t.name });
}));

// Resident self-registration (no account yet). The invitation code is the only key; an estate that has not
// switched registration on answers exactly like an unknown code.
router.get('/registration/:code', publicLimiter, wrap(async (req, res) => res.json(await R.publicInfo(req.params.code))));
router.post('/registration/:code', registrationLimiter, wrap(async (req, res) => res.status(201).json(await R.submit(req.params.code, req.body || {}, req))));
router.get('/registration/:code/status/:token', publicLimiter, wrap(async (req, res) => res.json(await R.publicStatus(req.params.code, req.params.token))));
module.exports = router;
