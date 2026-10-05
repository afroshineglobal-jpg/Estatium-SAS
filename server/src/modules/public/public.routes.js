'use strict';
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { wrap, notFound } = require('../../utils/http');
const { publicLimiter } = require('../../middleware/security');

// GET /api/public/tenants/:slug — lets the login page show the estate name; reveals nothing else.
router.get('/tenants/:slug', publicLimiter, wrap(async (req, res) => {
  const t = await prisma.system.tenant.findUnique({ where: { slug: String(req.params.slug).toLowerCase() }, select: { slug: true, name: true, status: true } });
  if (!t || t.status === 'DELETED') throw notFound('Estate');
  res.json({ slug: t.slug, name: t.name });
}));
module.exports = router;
