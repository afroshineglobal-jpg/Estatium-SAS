'use strict';
/**
 * Bulk resident import from CSV (estate admin onboarding).
 *   check()  -> validates every row against the database, writes NOTHING
 *   run()    -> creates each valid row independently (one bad row never blocks the others)
 * Runs inside the request's tenant context (prisma.* is tenant-scoped + RLS), so it can only ever touch this estate.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const H = require('../../utils/http');
const { parseCsv, toObjects } = require('../../utils/csv');

const MAX_ROWS = 150;                       // keeps one request well under the proxy timeout (bcrypt is CPU-bound)
const MAX_CHARS = 300000;
const ALIASES = {
  name: ['full name', 'fullname', 'resident name', 'nome', 'ad soyad', 'isim'],
  email: ['e-mail', 'email address', 'mail', 'e-posta'],
  phone: ['mobile', 'telephone', 'phone number', 'tel', 'telefone', 'telefon', 'celular'],
  block: ['building', 'tower', 'wing', 'bloco', 'blok'],
  unit: ['unit number', 'unitnumber', 'flat', 'apartment', 'house', 'unidade', 'daire'],
  type: ['resident type', 'residenttype', 'owner or tenant', 'tipo'],
};
const TYPE_MAP = { owner: 'OWNER', proprietario: 'OWNER', eigentumer: 'OWNER', sahip: 'OWNER', tenant: 'TENANT', inquilino: 'TENANT', mieter: 'TENANT', kiraci: 'TENANT', renter: 'TENANT' };
const fold = (s) => String(s || '').toLowerCase().replace(/\u0131/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const key = (blockId, unit) => `${blockId}\u0000${String(unit).trim().toLowerCase()}`;
const tempPassword = () => `${crypto.randomBytes(9).toString('base64url').replace(/^[-_]+/, 'x')}Aa1`;   // never starts with - or _ (safe in spreadsheets)

function readRows(csv) {
  if (typeof csv !== 'string' || !csv.trim()) throw H.bad('Choose a CSV file first');
  if (csv.length > MAX_CHARS) throw H.bad('The file is too large. Import at most 150 residents at a time.');
  const { header, objects } = toObjects(parseCsv(csv, { maxRows: 5000 }), ALIASES);
  for (const need of ['name', 'email', 'unit']) if (!header.includes(need)) throw H.bad(`The file needs a "${need}" column. Download the template to see the expected columns.`, 'MISSING_COLUMN');
  if (!objects.length) throw H.bad('The file has a header but no residents');
  if (objects.length > MAX_ROWS) throw H.bad(`The file has ${objects.length} residents. Import at most ${MAX_ROWS} at a time.`, 'TOO_MANY_ROWS');
  return objects;
}

async function loadContext(emails) {
  const prisma = require('../../config/prisma');   // lazy: the pure rules above stay testable without a database client
  const [blocks, units, users] = await Promise.all([
    prisma.block.findMany({ select: { id: true, name: true } }),
    prisma.unit.findMany({ select: { id: true, blockId: true, unitNumber: true, isActive: true } }),
    prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } }),
  ]);
  return {
    blocks, blockByName: new Map(blocks.map((b) => [fold(b.name), b])),
    unitByKey: new Map(units.map((u) => [key(u.blockId, u.unitNumber), u])),
    taken: new Set(users.map((u) => u.email.toLowerCase())),
  };
}

/** Pure per-row validation/normalisation + lookups against the preloaded context. */
function evaluate(rows, ctx, { createMissing }) {
  const seen = new Map(); const out = [];
  for (const r of rows) {
    const e = { line: r._line, name: (r.name || '').trim(), email: (r.email || '').trim().toLowerCase(), phone: (r.phone || '').trim() || null, block: (r.block || '').trim(), unit: (r.unit || '').trim(), error: null, willCreateUnit: false, willCreateBlock: false };
    const rt = (r.type || '').trim();
    e.residentType = rt ? TYPE_MAP[fold(rt)] : 'TENANT';
    if (!e.name || e.name.length > 120) e.error = 'Name is required (max 120 characters)';
    else if (!EMAIL_RE.test(e.email) || e.email.length > 200) e.error = 'Email is missing or not valid';
    else if (e.phone && e.phone.length > 40) e.error = 'Phone is too long';
    else if (!e.unit || e.unit.length > 40) e.error = 'Unit is required';
    else if (!e.residentType) e.error = 'Type must be OWNER or TENANT (or empty for TENANT)';
    else if (seen.has(e.email)) e.error = `Email appears twice in the file (first on line ${seen.get(e.email)})`;
    else if (ctx.taken.has(e.email)) e.error = 'This email already has an account in this estate';
    if (!e.error) {
      seen.set(e.email, e.line);
      let block = null;
      if (e.block) block = ctx.blockByName.get(fold(e.block)) || null;
      else if (ctx.blocks.length === 1) block = ctx.blocks[0];
      else if (!e.block && ctx.blocks.length === 0 && createMissing) e.block = 'Main';
      else if (!e.block) e.error = 'Block is required';
      if (!e.error) {
        if (!block) { if (createMissing) { e.willCreateBlock = true; e.willCreateUnit = true; } else e.error = `Block "${e.block}" does not exist`; }
        else {
          e.blockId = block.id; e.blockName = block.name;
          const u = ctx.unitByKey.get(key(block.id, e.unit));
          if (!u) { if (createMissing) e.willCreateUnit = true; else e.error = `Unit "${e.unit}" does not exist in block "${block.name}"`; }
          else if (!u.isActive) e.error = `Unit "${e.unit}" is deactivated`;
          else e.unitId = u.id;
        }
      }
    }
    out.push(e);
  }
  return out;
}

const publicRow = (e, extra = {}) => ({ line: e.line, name: e.name, email: e.email, block: e.blockName || e.block || '', unit: e.unit, type: e.residentType, status: e.error ? 'error' : 'ok', error: e.error, willCreateUnit: e.willCreateUnit, willCreateBlock: e.willCreateBlock, ...extra });

async function check(csv, { createMissing = false } = {}) {
  const rows = readRows(csv);
  const ctx = await loadContext([...new Set(rows.map((r) => (r.email || '').trim().toLowerCase()).filter(Boolean))]);
  const ev = evaluate(rows, ctx, { createMissing });
  return { summary: { total: ev.length, ok: ev.filter((e) => !e.error).length, errors: ev.filter((e) => e.error).length, unitsToCreate: ev.filter((e) => !e.error && e.willCreateUnit).length }, rows: ev.map((e) => publicRow(e)) };
}

async function run(csv, { createMissing = false } = {}, req) {
  const prisma = require('../../config/prisma'); const { audit } = require('../../utils/audit');
  const rows = readRows(csv);
  const ctx = await loadContext([...new Set(rows.map((r) => (r.email || '').trim().toLowerCase()).filter(Boolean))]);
  const ev = evaluate(rows, ctx, { createMissing });
  const blockCache = new Map(ctx.blocks.map((b) => [fold(b.name), b]));
  const result = []; let created = 0; let unitsCreated = 0;
  for (const e of ev) {
    if (e.error) { result.push(publicRow(e, { status: 'error' })); continue; }
    try {
      let { blockId, unitId } = e;
      if (e.willCreateBlock || e.willCreateUnit) {
        if (!blockId) {
          const name = e.block || 'Main'; let b = blockCache.get(fold(name));
          if (!b) { b = await prisma.block.create({ data: { name: name.slice(0, 60) } }); blockCache.set(fold(name), b); }
          blockId = b.id; e.blockName = b.name;
        }
        const existing = ctx.unitByKey.get(key(blockId, e.unit));
        if (existing) unitId = existing.id;
        else { const u = await prisma.unit.create({ data: { blockId, unitNumber: e.unit } }); unitId = u.id; ctx.unitByKey.set(key(blockId, e.unit), { id: u.id, blockId, unitNumber: e.unit, isActive: true }); unitsCreated++; }
      }
      const pw = tempPassword();
      await prisma.user.create({ data: { name: e.name, email: e.email, phone: e.phone, password: await bcrypt.hash(pw, 10), role: 'RESIDENT', mustChangePassword: true,
        resident: { create: { tenantId: req.tenant.id, unitId, residentType: e.residentType, moveInDate: new Date() } } } });
      ctx.taken.add(e.email); created++;
      result.push(publicRow(e, { status: 'created', temporaryPassword: pw }));
    } catch (err) {
      const mapped = H.toHttpError(err);
      result.push(publicRow(e, { status: 'error', error: mapped ? mapped.message : 'Could not create this resident' }));
      if (!mapped) console.error('[import] row failed:', err.message);
    }
  }
  const summary = { total: ev.length, created, failed: result.filter((r) => r.status === 'error').length, unitsCreated };
  await audit({ req, tenantId: req.tenant.id, actorType: 'TENANT_USER', actorId: req.user.id, actorEmail: req.user.email, action: 'RESIDENTS_IMPORTED', entity: 'Resident', after: summary });
  return { summary, rows: result };
}

module.exports = { check, run, evaluate, readRows, MAX_ROWS };
