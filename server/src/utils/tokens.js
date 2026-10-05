'use strict';
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const signTenantToken = (user, tenant) => jwt.sign(
  { sub: user.id, tid: tenant.id, role: user.role, tv: user.tokenVersion },
  env.JWT_SECRET, { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN, audience: 'tenant', issuer: 'estatium' });

const verifyTenantToken = (t) => jwt.verify(t, env.JWT_SECRET, { algorithms: ['HS256'], audience: 'tenant', issuer: 'estatium' });

const signPlatformToken = (pu) => jwt.sign(
  { sub: pu.id, role: pu.role, tv: pu.tokenVersion },
  env.PLATFORM_JWT_SECRET, { algorithm: 'HS256', expiresIn: env.PLATFORM_JWT_EXPIRES_IN, audience: 'platform', issuer: 'estatium' });

const verifyPlatformToken = (t) => jwt.verify(t, env.PLATFORM_JWT_SECRET, { algorithms: ['HS256'], audience: 'platform', issuer: 'estatium' });

module.exports = { signTenantToken, verifyTenantToken, signPlatformToken, verifyPlatformToken };
