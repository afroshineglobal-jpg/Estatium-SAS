'use strict';
/** Small validation + error helpers shared by all routes. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; this.expose = true; } }
const bad = (msg, code = 'BAD_REQUEST') => new HttpError(400, msg, code);
const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`, 'NOT_FOUND');
const forbidden = (msg = 'Forbidden') => new HttpError(403, msg, 'FORBIDDEN');
const conflict = (msg, code = 'CONFLICT') => new HttpError(409, msg, code);

const isId = (v) => typeof v === 'string' && UUID.test(v);
const requireId = (v, name = 'id') => { if (!isId(v)) throw bad(`Invalid ${name}`); return v; };
const oneOf = (v, list, name = 'value') => { if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`); return v; };
const str = (v, { max = 255, min = 0, name = 'field', required = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${name} is required`); return null; }
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  const t = v.trim(); if (t.length < min || t.length > max) throw bad(`${name} must be ${min}-${max} characters`);
  return t;
};
/** Positive money as a decimal string with <= 2 dp ("1500", "1500.5"); rejects NaN/negative/huge/exponent. */
const money = (v, { name = 'amount', allowZero = false } = {}) => {
  const s = typeof v === 'number' ? String(v) : v;
  if (typeof s !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(s.trim())) throw bad(`${name} must be a number with at most 2 decimals`);
  const t = s.trim(); if (!allowZero && Number(t) <= 0) throw bad(`${name} must be greater than 0`);
  return t;
};
const hhmm = (v, name = 'time') => { if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad(`${name} must be HH:MM (24h)`); return v; };
const date = (v, name = 'date') => { const d = new Date(v); if (!v || Number.isNaN(d.getTime())) throw bad(`${name} is not a valid date`); return d; };
const int = (v, { min = 0, max = 1e6, name = 'number' } = {}) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be an integer between ${min} and ${max}`); return n; };
const password = (v) => {
  if (typeof v !== 'string' || v.length < 10 || v.length > 128 || !/[a-z]/.test(v) || !/[A-Z]/.test(v) || !/\d/.test(v)) {
    throw bad('Password must be 10-128 characters and include upper-case, lower-case and a digit', 'WEAK_PASSWORD');
  }
  return v;
};

/** Express wrapper: forwards rejected promises to the central error handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Translate Prisma / PostgreSQL errors into safe HTTP responses (never leak internals). */
function toHttpError(err) {
  if (err instanceof HttpError || (err && err.expose && err.status)) return err;
  if (err?.code === 'P2002') return conflict('A record with the same unique value already exists', 'DUPLICATE');
  if (err?.code === 'P2025') return notFound();
  if (err?.code === 'P2003') return bad('Referenced record does not exist', 'BAD_REFERENCE');
  const m = String(err?.message || '');
  if (/amenity_booking_no_overlap/.test(m)) return conflict('That time slot is already booked', 'SLOT_TAKEN');
  if (/UNIT_CAP_EXCEEDED/.test(m)) return conflict('Your subscription does not allow more units. Contact the platform owner to upgrade.', 'UNIT_CAP_EXCEEDED');
  if (/bill_amounts_ck/.test(m)) return conflict('Payment would exceed the bill amount', 'OVERPAYMENT');
  if (/Tenant context required|Tenant context missing/.test(m)) return new HttpError(500, 'Internal server error', 'NO_TENANT_CONTEXT');
  if (err?.status && err.status < 500) return new HttpError(err.status, err.message, err.code);
  return null;
}

module.exports = { HttpError, bad, notFound, forbidden, conflict, isId, requireId, oneOf, str, money, hhmm, date, int, password, wrap, toHttpError };
