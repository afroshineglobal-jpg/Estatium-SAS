'use strict';
/** Validated, typed environment. The server refuses to boot with a weak/placeholder secret. */
require('dotenv').config();

const isTest = process.env.NODE_ENV === 'test';
const PLACEHOLDER = /(change[-_ ]?me|change[-_ ]in|your[-_ ]|secret[-_ ]key|example|placeholder|default|password)/i;
const hint = `Generate one with:  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`;

function secret(name) {
  const v = process.env[name];
  if (isTest) return v || 'test-secret-test-secret-test-secret-123456';
  if (!v) throw new Error(`${name} is required. ${hint}`);
  if (v.length < 32) throw new Error(`${name} must be at least 32 characters. ${hint}`);
  if (PLACEHOLDER.test(v)) throw new Error(`${name} looks like a placeholder/default value. ${hint}`);
  return v;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 3001),
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: secret('JWT_SECRET'),
  PLATFORM_JWT_SECRET: secret('PLATFORM_JWT_SECRET'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  PLATFORM_JWT_EXPIRES_IN: process.env.PLATFORM_JWT_EXPIRES_IN || '4h',
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
  TENANT_BASE_DOMAIN: (process.env.TENANT_BASE_DOMAIN || '').toLowerCase(),   // e.g. estatium.app -> greenville.estatium.app
  TRUST_PROXY: process.env.TRUST_PROXY || '0',
  ENABLE_RLS: process.env.ENABLE_RLS === 'true',
  PLATFORM_ALLOWED_IPS: (process.env.PLATFORM_ALLOWED_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
  RUN_JOBS: process.env.RUN_JOBS !== 'false',
  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
};

if (!isTest) {
  if (!env.DATABASE_URL || !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) throw new Error('DATABASE_URL must be a postgresql:// URL (SQLite is no longer supported).');
  if (env.JWT_SECRET === env.PLATFORM_JWT_SECRET) throw new Error('PLATFORM_JWT_SECRET must differ from JWT_SECRET.');
}
module.exports = env;
