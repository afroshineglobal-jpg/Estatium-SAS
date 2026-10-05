'use strict';
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

function originAllowed(origin) {
  if (!origin) return true;                                   // curl / server-to-server / same-origin
  if (env.CORS_ORIGINS.includes(origin)) return true;
  if (env.TENANT_BASE_DOMAIN) {
    try { const h = new URL(origin).hostname; if (h === env.TENANT_BASE_DOMAIN || h.endsWith('.' + env.TENANT_BASE_DOMAIN)) return true; } catch { /* invalid origin */ }
  }
  return false;
}

const corsMiddleware = cors({ origin: (origin, cb) => cb(null, originAllowed(origin)), credentials: true, maxAge: 600 });
const securityHeaders = helmet({ crossOriginResourcePolicy: { policy: 'same-site' } });   // CSP on (the API only returns JSON)

const limiter = (windowMs, limit, message, keyFn) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message, code: 'RATE_LIMITED' },
  ...(keyFn ? { keyGenerator: keyFn } : {}),
});

const apiLimiter    = limiter(60 * 1000, 600, 'Too many requests, slow down.');
const loginLimiter  = limiter(15 * 60 * 1000, 20, 'Too many login attempts. Try again in 15 minutes.',
  (req) => `${req.ip}|${String(req.body?.tenant || req.headers['x-tenant'] || '').toLowerCase()}|${String(req.body?.email || '').toLowerCase()}`);
const codeLimiter   = limiter(60 * 1000, 20, 'Too many code attempts. Wait a minute.', (req) => `${req.user?.id || req.ip}`);
const publicLimiter = limiter(60 * 1000, 60, 'Too many requests.');

module.exports = { corsMiddleware, securityHeaders, apiLimiter, loginLimiter, codeLimiter, publicLimiter, originAllowed };
