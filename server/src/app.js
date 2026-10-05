'use strict';
const env = require('./config/env');                      // validates secrets first: refuses to boot with a placeholder JWT secret
const express = require('express');
const http = require('http');
const morgan = require('morgan');
const crypto = require('crypto');
const { corsMiddleware, securityHeaders, apiLimiter } = require('./middleware/security');
const { toHttpError } = require('./utils/http');

function buildApp() {
  const app = express();
  const tp = env.TRUST_PROXY; app.set('trust proxy', tp === 'true' ? true : (Number.isNaN(Number(tp)) ? tp : Number(tp)));   // set TRUST_PROXY=1 behind nginx/ALB so req.ip (rate limits, audit) is the client
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(corsMiddleware);                                   // explicit allow-list (was origin:'*' + credentials)
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '1mb' }));                   // was 10 MB on every route
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use('/api', apiLimiter);

  // ─── routes ───────────────────────────────────────────────────────────────
  app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));
  app.use('/api/public',         require('./modules/public/public.routes'));
  app.use('/api/platform',       require('./modules/platform/platform.routes'));        // Super Owner portal (separate JWT)
  app.use('/api/auth',           require('./modules/auth/auth.routes'));
  app.use('/api/subscription',   require('./modules/subscription/subscription.routes'));
  app.use('/api/residents',      require('./modules/residents/residents.routes'));
  app.use('/api/visitors',       require('./modules/visitors/visitors.routes'));
  app.use('/api/parcels',        require('./modules/parcels/parcels.routes'));
  app.use('/api/amenities',      require('./modules/amenities/amenities.routes'));
  app.use('/api/billing',        require('./modules/billing/billing.routes'));
  app.use('/api/vehicles',       require('./modules/vehicles/vehicles.routes'));
  app.use('/api/staff',          require('./modules/staff/staff.routes'));
  app.use('/api/maintenance',    require('./modules/maintenance/maintenance.routes'));
  app.use('/api/emergency',      require('./modules/emergency/emergency.routes'));
  app.use('/api/communication',  require('./modules/communication/communication.routes'));
  app.use('/api/analytics',      require('./modules/analytics/analytics.routes'));
  app.use('/api/advertisements', require('./modules/advertisements/advertisements.routes'));
  app.use('/api/settings',       require('./modules/settings/settings.routes'));
  // NOTE: the unauthenticated POST /api/send-notification test route was removed (anyone could push arbitrary
  // notifications through your Firebase project). Pushes are sent only by server-side events via utils/notify.js.

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

  // ─── central error handler: never leaks Prisma/stack details ──────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body', code: 'BAD_JSON' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large', code: 'TOO_LARGE' });
    const he = toHttpError(err);
    if (he) return res.status(he.status).json({ error: he.message, ...(he.code ? { code: he.code } : {}) });
    const ref = crypto.randomUUID().slice(0, 8);
    console.error(`[${ref}] ${req.method} ${req.originalUrl}`, err?.stack || err);
    res.status(500).json({ error: 'Internal server error', ref });
  });
  return app;
}

function start() {
  const { attachRealtime } = require('./realtime');
  const app = buildApp();
  const server = http.createServer(app);
  attachRealtime(server, app);
  if (env.RUN_JOBS) require('./jobs/scheduler').start();
  server.listen(env.PORT, () => {
    console.log(`\n🏢 Estatium API (multi-tenant) on :${env.PORT}  env=${env.NODE_ENV}  rls=${env.ENABLE_RLS ? 'on' : 'off'}  jobs=${env.RUN_JOBS ? 'on' : 'off'}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start();
module.exports = { buildApp, start };
