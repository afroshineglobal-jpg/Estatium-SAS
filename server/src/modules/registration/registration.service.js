'use strict';
/**
 * Resident self-registration.
 *   PUBLIC (no account yet): estate info by invitation code, submit a request, check its status.
 *   ESTATE ADMIN: list, view selfie, approve (creates the account), reject, manage the invitation code.
 * Everything tenant-scoped runs inside prisma.withTenant(...) so RLS + the tenant scope apply even on public routes.
 * The applicant picks their OWN password: it is hashed at submit and becomes the account password on approval.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const env = require('../../config/env');
const H = require('../../utils/http');

const CONSENT_VERSION = '2026-11-v1';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';           // no 0/O/1/I/L
const MAX_OPEN_REQUESTS = 300;                                  // flood guard per estate
const MAX_SELFIE_BYTES = 400 * 1024;
const SELFIE_KEEP_DAYS = 30;                                    // after approval; rejected selfies are deleted at once
const OPEN = ['PENDING', 'NEEDS_INFO'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const genCode = () => Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const showCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : null);
const notOpen = () => H.notFound('Registration');             // identical answer for wrong code / disabled / deleted estate

// ── selfie storage (private folder, never served statically) ────────────────────────────────────
const root = () => path.resolve(env.UPLOAD_DIR);
function selfieAbs(rel) {
  const abs = path.resolve(root(), rel);
  if (!abs.startsWith(root() + path.sep)) throw new Error('Unsafe path');
  return abs;
}
function parseSelfie(dataUrl) {
  if (typeof dataUrl !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw H.bad('Please take or choose a photo of yourself (JPEG)', 'BAD_SELFIE');
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (buf.length < 1000) throw H.bad('The photo is too small', 'BAD_SELFIE');
  if (buf.length > MAX_SELFIE_BYTES) throw H.bad('The photo is too large. Please try again.', 'BAD_SELFIE');
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw H.bad('The photo is not a valid JPEG image', 'BAD_SELFIE');
  return buf;
}
async function saveSelfie(tenantId, id, buf) {
  const rel = path.join('registrations', tenantId, `${id}.jpg`);
  const abs = selfieAbs(rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(abs, buf, { mode: 0o600 });
  return rel;
}
const removeSelfie = async (rel) => { if (!rel) return; try { await fs.promises.unlink(selfieAbs(rel)); } catch (e) { if (e.code !== 'ENOENT') console.warn('[registration] selfie delete failed:', e.message); } };

// ── lookups ───────────────────────────────────────────────────────────────────────────────────────
async function tenantByCode(code, { requireEnabled = true } = {}) {
  const c = normCode(code);
  if (c.length !== 8) throw notOpen();
  const prisma = require('../../config/prisma');
  const t = await prisma.system.tenant.findUnique({ where: { registrationCode: c }, select: { id: true, name: true, slug: true, status: true, registrationEnabled: true } });
  if (!t || t.status === 'DELETED' || (requireEnabled && !t.registrationEnabled)) throw notOpen();
  return t;
}

// ── PUBLIC ────────────────────────────────────────────────────────────────────────────────────────
async function publicInfo(code) {
  const prisma = require('../../config/prisma');
  const t = await tenantByCode(code);
  const units = await prisma.forTenant(t.id).unit.findMany({ where: { isActive: true }, include: { block: true }, orderBy: [{ block: { name: 'asc' } }, { unitNumber: 'asc' }], take: 3000 });
  return { estate: { name: t.name }, consentVersion: CONSENT_VERSION, units: units.map((u) => ({ id: u.id, label: `${u.block.name} - ${u.unitNumber}` })) };
}

async function submit(code, b, req) {
  const prisma = require('../../config/prisma'); const { audit } = require('../../utils/audit'); const { notifyMany } = require('../../utils/notify');
  const t = await tenantByCode(code);
  if (b?.website) return { trackingToken: crypto.randomBytes(18).toString('base64url'), status: 'PENDING' };   // bot trap: pretend success, store nothing
  const name = H.str(b.name, { name: 'name', required: true, min: 2, max: 120 });
  const email = H.str(b.email, { name: 'email', required: true, max: 200 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw H.bad('Please enter a valid email address');
  const phone = H.str(b.phone, { name: 'phone', max: 40 });
  const residentType = H.oneOf(b.residentType || 'TENANT', ['OWNER', 'TENANT'], 'residentType');
  const unitId = H.requireId(b.unitId, 'unit');
  const password = H.password(b.password);
  if (b.consent !== true) throw H.bad('You must accept the privacy notice to register', 'CONSENT_REQUIRED');
  const selfie = parseSelfie(b.selfie);
  const passwordHash = await bcrypt.hash(password, 12);

  return prisma.withTenant(t.id, async () => {
    const unit = await prisma.unit.findFirst({ where: { id: unitId, isActive: true }, include: { block: true } });
    if (!unit) throw H.bad('Please choose your unit from the list');
    const cannot = () => H.conflict('This email cannot be used to register. If you already have an account, please sign in.', 'EMAIL_UNAVAILABLE');
    if (await prisma.user.findFirst({ where: { email } })) throw cannot();
    if ((await prisma.registrationRequest.count({ where: { status: { in: OPEN } } })) >= MAX_OPEN_REQUESTS) throw H.conflict('Registration is temporarily unavailable. Please contact your estate administrator.', 'REGISTRATION_BUSY');
    const id = crypto.randomUUID(); const trackingToken = crypto.randomBytes(24).toString('base64url');
    const selfiePath = await saveSelfie(t.id, id, selfie);
    try {
      await prisma.registrationRequest.create({ data: { id, trackingToken, name, email, phone, residentType, unitId, passwordHash, selfiePath, consentAt: new Date(), consentVersion: CONSENT_VERSION, ip: req?.ip || null } });
    } catch (e) { await removeSelfie(selfiePath); if (e.code === 'P2002') throw cannot(); throw e; }
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    await notifyMany(admins.map((a) => a.id), 'New registration request', `${name} wants to join (${unit.block.name} - ${unit.unitNumber}).`, 'GENERAL', { registrationId: id });
    await audit({ req, tenantId: t.id, actorType: 'PUBLIC', action: 'REGISTRATION_SUBMITTED', entity: 'RegistrationRequest', entityId: id });
    return { trackingToken, status: 'PENDING' };
  });
}

async function publicStatus(code, token) {
  const prisma = require('../../config/prisma');
  const t = await tenantByCode(code, { requireEnabled: false });
  if (typeof token !== 'string' || token.length < 20 || token.length > 80) throw H.notFound('Request');
  return prisma.withTenant(t.id, async () => {
    const r = await prisma.registrationRequest.findFirst({ where: { trackingToken: token }, select: { status: true, reviewNote: true, createdAt: true, reviewedAt: true } });
    if (!r) throw H.notFound('Request');
    return { estate: t.name, status: r.status, note: r.status === 'REJECTED' || r.status === 'NEEDS_INFO' ? r.reviewNote : null, submittedAt: r.createdAt, decidedAt: r.reviewedAt };
  });
}

// ── ESTATE ADMIN (called inside an authenticated tenant request: prisma.* is already tenant-scoped) ──
async function getSettings(req) {
  const prisma = require('../../config/prisma');
  const t = await prisma.system.tenant.findUnique({ where: { id: req.tenant.id }, select: { registrationCode: true, registrationEnabled: true } });
  return { enabled: t.registrationEnabled, code: showCode(t.registrationCode) };
}
async function updateSettings(req, { enabled, regenerate }) {
  const prisma = require('../../config/prisma'); const { audit } = require('../../utils/audit');
  const cur = await prisma.system.tenant.findUnique({ where: { id: req.tenant.id }, select: { registrationCode: true, registrationEnabled: true } });
  const data = {};
  if (typeof enabled === 'boolean') data.registrationEnabled = enabled;
  if (regenerate === true || (!cur.registrationCode && data.registrationEnabled)) {
    for (let i = 0; i < 5; i++) {
      try { await prisma.system.tenant.update({ where: { id: req.tenant.id }, data: { ...data, registrationCode: genCode() } }); break; }
      catch (e) { if (e.code !== 'P2002' || i === 4) throw e; }
    }
  } else if (Object.keys(data).length) await prisma.system.tenant.update({ where: { id: req.tenant.id }, data });
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'REGISTRATION_SETTINGS_CHANGED', entity: 'Tenant', entityId: req.tenant.id, after: { enabled, regenerated: regenerate === true } });
  return getSettings(req);
}

async function list(status) {
  const prisma = require('../../config/prisma');
  const where = status ? { status: H.oneOf(status, ['PENDING', 'APPROVED', 'REJECTED', 'NEEDS_INFO'], 'status') } : {};
  const rows = await prisma.registrationRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, include: { unit: { include: { block: true } } } });
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, residentType: r.residentType, unit: r.unit ? `${r.unit.block.name} - ${r.unit.unitNumber}` : null, status: r.status, reviewNote: r.reviewNote, hasSelfie: !!r.selfiePath, createdAt: r.createdAt, reviewedAt: r.reviewedAt }));
}

async function selfieFile(id) {
  const prisma = require('../../config/prisma');
  const r = await prisma.registrationRequest.findFirst({ where: { id: H.requireId(id) }, select: { selfiePath: true } });
  if (!r || !r.selfiePath) throw H.notFound('Photo');
  const abs = selfieAbs(r.selfiePath);
  if (!fs.existsSync(abs)) throw H.notFound('Photo');
  return abs;
}

async function approve(id, req) {
  const prisma = require('../../config/prisma'); const { audit } = require('../../utils/audit'); const { notify } = require('../../utils/notify');
  id = H.requireId(id);
  const r = await prisma.registrationRequest.findFirst({ where: { id } });
  if (!r) throw H.notFound('Request');
  if (!OPEN.includes(r.status)) throw H.conflict(`This request is already ${r.status.toLowerCase()}`, 'ALREADY_DECIDED');
  const claim = await prisma.registrationRequest.updateMany({ where: { id, status: { in: OPEN } }, data: { status: 'APPROVED', reviewedById: req.user.id, reviewedAt: new Date() } });   // idempotent: a double click cannot create two accounts
  if (!claim.count) throw H.conflict('This request was just decided by someone else', 'ALREADY_DECIDED');
  let user;
  try {
    const unit = r.unitId && await prisma.unit.findFirst({ where: { id: r.unitId, isActive: true } });
    if (!unit) throw H.bad('The unit this person chose no longer exists. Reject the request and ask them to apply again.', 'UNIT_GONE');
    if (await prisma.user.findFirst({ where: { email: r.email } })) throw H.conflict('An account with this email already exists', 'EMAIL_UNAVAILABLE');
    user = await prisma.user.create({ data: { name: r.name, email: r.email, phone: r.phone, password: r.passwordHash, role: 'RESIDENT', mustChangePassword: false,
      resident: { create: { tenantId: req.tenant.id, unitId: r.unitId, residentType: r.residentType, moveInDate: new Date() } } }, include: { resident: true } });
    await prisma.registrationRequest.update({ where: { id }, data: { createdUserId: user.id } });
  } catch (e) {
    await prisma.registrationRequest.updateMany({ where: { id, status: 'APPROVED', createdUserId: null }, data: { status: 'PENDING', reviewedById: null, reviewedAt: null } });
    throw e;
  }
  await notify(user.id, 'Welcome to the Estate!', 'Your registration was approved. You can now sign in.', 'GENERAL');
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'REGISTRATION_APPROVED', entity: 'RegistrationRequest', entityId: id, after: { userId: user.id } });
  return { id, status: 'APPROVED', userId: user.id };
}

async function reject(id, reason, req) {
  const prisma = require('../../config/prisma'); const { audit } = require('../../utils/audit');
  id = H.requireId(id);
  const note = H.str(reason, { name: 'reason', required: true, min: 3, max: 300 });
  const r = await prisma.registrationRequest.findFirst({ where: { id } });
  if (!r) throw H.notFound('Request');
  const claim = await prisma.registrationRequest.updateMany({ where: { id, status: { in: OPEN } }, data: { status: 'REJECTED', reviewNote: note, reviewedById: req.user.id, reviewedAt: new Date(), selfiePath: null } });
  if (!claim.count) throw H.conflict(`This request is already ${r.status.toLowerCase()}`, 'ALREADY_DECIDED');
  await removeSelfie(r.selfiePath);                              // a rejected applicant's photo is deleted at once
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'REGISTRATION_REJECTED', entity: 'RegistrationRequest', entityId: id, after: { reason: note } });
  return { id, status: 'REJECTED' };
}

/** Daily job: delete selfies of approved requests after SELFIE_KEEP_DAYS (privacy: keep personal data no longer than needed). */
async function purgeSelfies(now = new Date()) {
  const prisma = require('../../config/prisma');
  const cutoff = new Date(now.getTime() - SELFIE_KEEP_DAYS * 86400000);
  const tenants = await prisma.system.tenant.findMany({ where: { status: { in: ['TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED'] } }, select: { id: true } });
  let n = 0;
  for (const t of tenants) {
    try {
      await prisma.withTenant(t.id, async () => {
        const rows = await prisma.registrationRequest.findMany({ where: { selfiePath: { not: null }, status: { not: 'PENDING' }, reviewedAt: { lt: cutoff } }, select: { id: true, selfiePath: true }, take: 500 });
        for (const r of rows) { await removeSelfie(r.selfiePath); await prisma.registrationRequest.updateMany({ where: { id: r.id }, data: { selfiePath: null } }); n++; }
      });
    } catch (e) { console.error(`[jobs] selfie purge ${t.id}:`, e.message); }
  }
  return n;
}

module.exports = { publicInfo, submit, publicStatus, getSettings, updateSettings, list, selfieFile, approve, reject, purgeSelfies, normCode, genCode, showCode, parseSelfie, CONSENT_VERSION };
