#!/usr/bin/env node
/**
 * One-shot migration: legacy single-tenant SQLite  ->  multi-tenant PostgreSQL.
 *
 *   DATABASE_URL=postgres://owner:pw@host/estatium \
 *   node scripts/migrate-sqlite-to-postgres.js \
 *        --sqlite ./prisma/estate.db --slug greenville --currency NGN --timezone Africa/Lagos [--dry-run]
 *
 * What it does (all inside ONE PostgreSQL transaction — either everything lands or nothing does):
 *   1. creates the Tenant + an ACTIVE (or TRIAL) Subscription on --plan (default "standard")
 *   2. copies every table, stamping tenantId, converting Float->Decimal(14,2), epoch-ms->timestamp,
 *      0/1->boolean, JSON strings->jsonb, Poll.votes JSON -> PollVote rows, Parcel OTP -> sha256
 *   3. repairs legacy data that the new constraints would reject (duplicate exit codes, overlapping
 *      amenity bookings, over-paid bills) and REPORTS every repair
 *   4. flags accounts that still use a documented default/demo password (mustChangePassword = true)
 *   5. verifies row counts + money totals source vs target, then COMMITs (or ROLLBACKs on --dry-run)
 *
 * The SQLite file is opened read-only and is never modified. Rollback after commit:
 *   UPDATE "Tenant" SET status='DELETED' WHERE slug='<slug>'; SELECT platform_purge_tenant('<tenant id>', true);
 */
'use strict';
const crypto = require('crypto');
const { Client } = require('pg');
const Database = require('better-sqlite3');
let bcrypt = null; try { bcrypt = require('bcryptjs'); } catch { /* weak-password check is skipped */ }

// ─── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2);
    if (k === 'dry-run' || k === 'skip-weak-password-check' || k === 'trial') out[k] = true;
    else out[k] = argv[++i];
  }
  return out;
}
const args = parseArgs(process.argv);
const need = (k) => { if (!args[k]) { console.error(`Missing --${k}`); process.exit(2); } return args[k]; };

const SQLITE_PATH = need('sqlite');
const SLUG        = need('slug').toLowerCase();
const CURRENCY    = (args.currency || 'NGN').toUpperCase();
const TIMEZONE    = args.timezone || 'UTC';
const PLAN_CODE   = args.plan || 'standard';
const DRY_RUN     = !!args['dry-run'];
const DB_URL      = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

// Passwords documented in the public README / seed.js / hard-coded in routes. Anyone using these must change them.
const KNOWN_WEAK = ['Admin@123','Security@123','Finance@123','Maint@123','Guard@123','Resident@123','Welcome@123','Staff@123','Password@123'];

// ─── helpers ─────────────────────────────────────────────────────────────────
const warnings = [];
const warn = (m) => { warnings.push(m); };
const ts = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' || /^\d+$/.test(String(v)) ? new Date(Number(v)) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();     // ISO/UTC string => no client-TZ drift
};
const bool = (v) => v === 1 || v === '1' || v === true;
const money = (v, ctx) => {
  if (v === null || v === undefined) return null;
  const n = Number(v); if (!Number.isFinite(n)) { warn(`${ctx}: non-numeric amount ${v} -> NULL`); return null; }
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) warn(`${ctx}: amount ${n} rounded to 2dp`);
  return (Math.round(n * 100) / 100).toFixed(2);
};
const json = (v) => { if (v === null || v === undefined || v === '') return null; try { return JSON.stringify(JSON.parse(v)); } catch { return JSON.stringify(String(v)); } };
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const enumOr = (v, allowed, fallback, ctx) => {
  if (allowed.includes(v)) return v;
  warn(`${ctx}: unknown value "${v}" -> "${fallback}"`); return fallback;
};
const E = {
  role: ['ADMIN','SECURITY_ADMIN','FINANCE_ADMIN','MAINTENANCE_MANAGER','RESIDENT','GUARD'],
  residentType: ['OWNER','TENANT'],
  visitorStatus: ['PENDING','APPROVED','DENIED','INSIDE','EXITED'],
  visitorType: ['GUEST','DELIVERY','SERVICE','DOMESTIC'],
  parcelStatus: ['PENDING','COLLECTED'],
  bookingStatus: ['PENDING','APPROVED','REJECTED','CANCELLED'],
  billStatus: ['UNPAID','PARTIAL','PAID','OVERDUE','WAIVED','VOID'],
  billType: ['MAINTENANCE','UTILITY','PENALTY','AMENITY','ONE_TIME'],
  payMethod: ['CASH','BANK_TRANSFER','ONLINE'],
  taskStatus: ['PENDING','IN_PROGRESS','DONE'],
  maintStatus: ['OPEN','ASSIGNED','IN_PROGRESS','COMPLETED','CLOSED'],
  priority: ['LOW','MEDIUM','HIGH','URGENT'],
  emStatus: ['ACTIVE','ACKNOWLEDGED','RESOLVED'],
  severity: ['LOW','MEDIUM','HIGH','CRITICAL'],
  adStatus: ['PENDING','APPROVED','REJECTED','EXPIRED'],
};

async function insertRows(pg, table, cols, rows) {
  if (!rows.length) return 0;
  const per = Math.max(1, Math.min(500, Math.floor(60000 / cols.length)));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params = []; const tuples = chunk.map(r => '(' + cols.map(c => { params.push(r[c] === undefined ? null : r[c]); return `$${params.length}`; }).join(',') + ')');
    await pg.query(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES ${tuples.join(',')}`, params);
  }
  return rows.length;
}

// ─── main ────────────────────────────────────────────────────────────────────
(async () => {
  const lite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  const all = (t) => lite.prepare(`SELECT * FROM "${t}"`).all();
  const src = {}; const tables = ['User','Block','Unit','Resident','FamilyMember','Visitor','Parcel','Amenity','AmenitySlot','AmenityBooking','Bill','Payment','Vehicle','VehicleLog','StaffMember','AttendanceLog','Task','MaintenanceRequest','EmergencyReport','Notice','Message','Poll','Guard','Notification','Advertisement','Setting'];
  for (const t of tables) { try { src[t] = all(t); } catch (e) { src[t] = []; warn(`source table ${t} missing (${e.message}) -> treated as empty`); } }

  const pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  const T = crypto.randomUUID();
  const counts = {};
  try {
    await pg.query('BEGIN');
    await pg.query(`SET LOCAL TIME ZONE 'UTC'`);
    await pg.query(`SELECT set_config('app.tenant_id', $1, true)`, [T]);   // keeps working when connected as the RLS-bound app role

    // 0. preconditions
    const cur = await pg.query(`SELECT code FROM "Currency" WHERE code=$1`, [CURRENCY]);
    if (!cur.rowCount) throw new Error(`Currency ${CURRENCY} is not in "Currency". Seed it first (sql/003_seed_reference.sql).`);
    const plan = await pg.query(`SELECT id, "trialDays" FROM "Plan" WHERE code=$1`, [PLAN_CODE]);
    if (!plan.rowCount) throw new Error(`Plan "${PLAN_CODE}" not found`);
    const dup = await pg.query(`SELECT 1 FROM "Tenant" WHERE slug=$1`, [SLUG]);
    if (dup.rowCount) throw new Error(`Tenant "${SLUG}" already exists. To redo: mark it DELETED and run platform_purge_tenant(<id>, true).`);

    const setting = Object.fromEntries(src.Setting.map(s => [s.key, s.value]));
    const name = args.name || setting.estate_name || SLUG;

    // 1. tenant + subscription
    const status = args.trial ? 'TRIAL' : 'ACTIVE';
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const trialEnds   = args.trial ? new Date(now.getTime() + plan.rows[0].trialDays * 86400000) : null;
    await pg.query(`INSERT INTO "Tenant"(id, slug, name, status, currency, timezone, "contactEmail", address, "trialEndsAt", "activatedAt", "updatedAt")
                    VALUES ($1,$2,$3,$4::"TenantStatus",$5,$6,$7,$8,$9,$10,now())`,
      [T, SLUG, name, status, CURRENCY, TIMEZONE, setting.admin_email || null, setting.estate_address || null, trialEnds && trialEnds.toISOString(), status === 'ACTIVE' ? now.toISOString() : null]);
    const SUB = crypto.randomUUID();
    await pg.query(`INSERT INTO "Subscription"(id,"tenantId","planId",status,currency,"trialEndsAt","currentPeriodStart","currentPeriodEnd","updatedAt")
                    VALUES ($1,$2,$3,$4::"SubscriptionStatus",$5,$6,$7,$8,now())`,
      [SUB, T, plan.rows[0].id, status, CURRENCY, trialEnds && trialEnds.toISOString(), periodStart.toISOString(), periodEnd.toISOString()]);
    await pg.query(`INSERT INTO "SubscriptionEvent"(id,"subscriptionId","tenantId",type,data,"actorType") VALUES ($1,$2,$3,'CREATED',$4::jsonb,'SYSTEM')`,
      [crypto.randomUUID(), SUB, T, JSON.stringify({ migratedFrom: 'sqlite', file: SQLITE_PATH })]);

    // 2. weak/default password detection
    const weak = new Set();
    if (bcrypt && !args['skip-weak-password-check']) {
      for (const u of src.User) if (KNOWN_WEAK.some(p => { try { return bcrypt.compareSync(p, u.password); } catch { return false; } })) weak.add(u.id);
    } else if (!bcrypt) warn('bcryptjs not installed: default-password check skipped');

    // 3. copy, FK order
    const base = { tenantId: T };
    counts.User = await insertRows(pg, 'User', ['id','tenantId','email','password','role','name','phone','avatar','isActive','fcmToken','mustChangePassword','createdAt','updatedAt'],
      src.User.map(u => ({ ...base, id: u.id, email: String(u.email).toLowerCase(), password: u.password, role: enumOr(u.role, E.role, 'RESIDENT', `User ${u.email} role`), name: u.name, phone: u.phone, avatar: u.avatar, isActive: bool(u.isActive), fcmToken: u.fcmToken, mustChangePassword: weak.has(u.id), createdAt: ts(u.createdAt), updatedAt: ts(u.updatedAt) || ts(u.createdAt) })));
    counts.Block = await insertRows(pg, 'Block', ['id','tenantId','name'], src.Block.map(b => ({ ...base, id: b.id, name: b.name })));
    counts.Unit = await insertRows(pg, 'Unit', ['id','tenantId','blockId','unitNumber','floor','isOccupied'], src.Unit.map(u => ({ ...base, id: u.id, blockId: u.blockId, unitNumber: u.unitNumber, floor: u.floor, isOccupied: bool(u.isOccupied) })));
    counts.Resident = await insertRows(pg, 'Resident', ['id','tenantId','userId','unitId','residentType','moveInDate','moveOutDate','isActive','createdAt'],
      src.Resident.map(r => ({ ...base, id: r.id, userId: r.userId, unitId: r.unitId, residentType: enumOr(r.residentType, E.residentType, 'TENANT', `Resident ${r.id}`), moveInDate: ts(r.moveInDate), moveOutDate: ts(r.moveOutDate), isActive: bool(r.isActive), createdAt: ts(r.createdAt) })));
    counts.FamilyMember = await insertRows(pg, 'FamilyMember', ['id','tenantId','residentId','name','relation','phone','photo','createdAt'], src.FamilyMember.map(f => ({ ...base, ...f, createdAt: ts(f.createdAt) })));

    // visitors: entry/exit codes are now unique per tenant -> null out legacy collisions (and report)
    const seenEntry = new Set(), seenExit = new Set();
    counts.Visitor = await insertRows(pg, 'Visitor', ['id','tenantId','residentId','name','phone','photo','purpose','visitorType','status','entryCode','exitCode','entryTime','exitTime','leaveAtGate','denialNote','vehicleNumber','preApproved','expectedDate','guardNote','createdAt'],
      src.Visitor.map(v => {
        let entry = v.entryCode, exit = v.exitCode;
        if (entry && seenEntry.has(entry)) { warn(`Visitor ${v.id}: duplicate entryCode -> NULL`); entry = null; } else if (entry) seenEntry.add(entry);
        if (exit && seenExit.has(exit))   { warn(`Visitor ${v.id}: duplicate exitCode -> NULL`);  exit = null;  } else if (exit)  seenExit.add(exit);
        return { ...base, id: v.id, residentId: v.residentId, name: v.name, phone: v.phone, photo: v.photo, purpose: v.purpose, visitorType: enumOr(v.visitorType, E.visitorType, 'GUEST', `Visitor ${v.id}`), status: enumOr(v.status, E.visitorStatus, 'EXITED', `Visitor ${v.id}`), entryCode: entry, exitCode: exit, entryTime: ts(v.entryTime), exitTime: ts(v.exitTime), leaveAtGate: bool(v.leaveAtGate), denialNote: v.denialNote, vehicleNumber: v.vehicleNumber, preApproved: bool(v.preApproved), expectedDate: ts(v.expectedDate), guardNote: v.guardNote, createdAt: ts(v.createdAt) };
      }));
    counts.Parcel = await insertRows(pg, 'Parcel', ['id','tenantId','unitId','senderName','carrier','description','photo','status','loggedAt','collectedAt','otpHash','notifiedAt'],
      src.Parcel.map(p => ({ ...base, id: p.id, unitId: p.unitId, senderName: p.senderName, carrier: p.carrier, description: p.description, photo: p.photo, status: enumOr(p.status, E.parcelStatus, 'PENDING', `Parcel ${p.id}`), loggedAt: ts(p.loggedAt), collectedAt: ts(p.collectedAt), otpHash: p.otp ? sha256(p.otp) : null, notifiedAt: ts(p.notifiedAt) })));

    counts.Amenity = await insertRows(pg, 'Amenity', ['id','tenantId','name','description','capacity','pricePerHour','isActive','image'], src.Amenity.map(a => ({ ...base, id: a.id, name: a.name, description: a.description, capacity: a.capacity, pricePerHour: money(a.pricePerHour, `Amenity ${a.name} price`), isActive: bool(a.isActive), image: a.image })));
    counts.AmenitySlot = await insertRows(pg, 'AmenitySlot', ['id','tenantId','amenityId','dayOfWeek','startTime','endTime','isAvailable'], src.AmenitySlot.map(s => ({ ...base, ...s, isAvailable: bool(s.isAvailable) })));

    // bookings: legacy code had a race, so overlaps may exist. Insert oldest first; a booking that
    // collides with the exclusion constraint is migrated as CANCELLED (kept for history, blocks nothing).
    let bookingOk = 0;
    for (const b of src.AmenityBooking.slice().sort((x, y) => Number(x.createdAt) - Number(y.createdAt))) {
      const day = ts(b.date)?.slice(0, 10);
      const startAt = day && `${day}T${b.startTime}:00.000Z`, endAt = day && `${day}T${b.endTime}:00.000Z`;
      if (!day || Number.isNaN(Date.parse(startAt)) || Number.isNaN(Date.parse(endAt)) || Date.parse(endAt) <= Date.parse(startAt)) { warn(`AmenityBooking ${b.id}: unparseable times (${b.startTime}-${b.endTime}) -> skipped`); continue; }
      const row = (status, notes) => ({ ...base, id: b.id, amenityId: b.amenityId, userId: b.userId, date: ts(b.date), startTime: b.startTime, endTime: b.endTime, startAt, endAt, status, totalAmount: money(b.totalAmount, `Booking ${b.id}`), notes, createdAt: ts(b.createdAt) });
      const cols = ['id','tenantId','amenityId','userId','date','startTime','endTime','startAt','endAt','status','totalAmount','notes','createdAt'];
      await pg.query('SAVEPOINT bk');
      try { await insertRows(pg, 'AmenityBooking', cols, [row(enumOr(b.status, E.bookingStatus, 'CANCELLED', `Booking ${b.id}`), b.notes)]); bookingOk++; await pg.query('RELEASE SAVEPOINT bk'); }
      catch (e) {
        await pg.query('ROLLBACK TO SAVEPOINT bk');
        if (e.code !== '23P01') throw e;
        warn(`AmenityBooking ${b.id}: overlapped an existing booking -> migrated as CANCELLED`);
        await insertRows(pg, 'AmenityBooking', cols, [row('CANCELLED', `${b.notes || ''} [migrated: overlapped an earlier booking]`.trim())]); bookingOk++;
        await pg.query('RELEASE SAVEPOINT bk');
      }
    }
    counts.AmenityBooking = bookingOk;

    // bills + payments
    const paidByBill = new Map(); for (const p of src.Payment) paidByBill.set(p.billId, (paidByBill.get(p.billId) || 0) + Number(p.amount || 0));
    let paidWithoutPayment = 0;
    counts.Bill = await insertRows(pg, 'Bill', ['id','tenantId','residentId','title','amount','amountPaid','currency','dueDate','status','type','description','paidAt','createdAt'],
      src.Bill.map(b => {
        const amount = Number(money(b.amount, `Bill ${b.id}`) ?? 0); let paid = paidByBill.get(b.id) || 0; let status = enumOr(b.status, E.billStatus, 'UNPAID', `Bill ${b.id}`);
        if (paid > amount) { warn(`Bill ${b.id}: payments (${paid}) exceed amount (${amount}) -> amountPaid clamped`); paid = amount; }
        if (status === 'PAID' && paid === 0) { paidWithoutPayment++; warn(`Bill ${b.id} ("${b.title}"): marked PAID but has NO payment record (legacy self-service hole) -> kept PAID, amountPaid 0 — review`); }
        if (status === 'UNPAID' && paid > 0 && paid < amount) status = 'PARTIAL';
        return { ...base, id: b.id, residentId: b.residentId, title: b.title, amount: amount.toFixed(2), amountPaid: paid.toFixed(2), currency: CURRENCY, dueDate: ts(b.dueDate), status, type: enumOr(b.type, E.billType, 'ONE_TIME', `Bill ${b.id}`), description: b.description, paidAt: ts(b.paidAt), createdAt: ts(b.createdAt) };
      }));
    const goodPayments = src.Payment.filter(p => { if (!(Number(p.amount) > 0)) { warn(`Payment ${p.id}: non-positive amount -> skipped`); return false; } return true; });
    counts.Payment = await insertRows(pg, 'Payment', ['id','tenantId','billId','amount','currency','method','status','reference','paidAt','notes'],
      goodPayments.map(p => ({ ...base, id: p.id, billId: p.billId, amount: money(p.amount, `Payment ${p.id}`), currency: CURRENCY, method: enumOr(p.method, E.payMethod, 'CASH', `Payment ${p.id}`), status: 'SUCCEEDED', reference: p.reference, paidAt: ts(p.paidAt), notes: p.notes })));

    counts.Vehicle = await insertRows(pg, 'Vehicle', ['id','tenantId','residentId','plateNumber','make','model','color','type','qrCode','isActive','createdAt'], src.Vehicle.map(v => ({ ...base, ...v, isActive: bool(v.isActive), createdAt: ts(v.createdAt) })));
    counts.VehicleLog = await insertRows(pg, 'VehicleLog', ['id','tenantId','vehicleId','action','timestamp','guardNote'], src.VehicleLog.map(v => ({ ...base, ...v, timestamp: ts(v.timestamp) })));
    counts.StaffMember = await insertRows(pg, 'StaffMember', ['id','tenantId','userId','staffType','employedBy','residentId','qrCode','accessStart','accessEnd','isActive','createdAt'], src.StaffMember.map(s => ({ ...base, ...s, isActive: bool(s.isActive), createdAt: ts(s.createdAt) })));
    counts.AttendanceLog = await insertRows(pg, 'AttendanceLog', ['id','tenantId','staffId','action','timestamp'], src.AttendanceLog.map(a => ({ ...base, ...a, timestamp: ts(a.timestamp) })));
    counts.Task = await insertRows(pg, 'Task', ['id','tenantId','staffId','title','description','status','dueDate','createdAt'], src.Task.map(t => ({ ...base, ...t, status: enumOr(t.status, E.taskStatus, 'PENDING', `Task ${t.id}`), dueDate: ts(t.dueDate), createdAt: ts(t.createdAt) })));
    counts.MaintenanceRequest = await insertRows(pg, 'MaintenanceRequest', ['id','tenantId','userId','title','description','category','priority','status','photo','assignedToId','estimatedCost','actualCost','completedAt','notes','createdAt'],
      src.MaintenanceRequest.map(m => ({ ...base, id: m.id, userId: m.userId, title: m.title, description: m.description, category: m.category, priority: enumOr(m.priority, E.priority, 'MEDIUM', `Maint ${m.id}`), status: enumOr(m.status, E.maintStatus, 'OPEN', `Maint ${m.id}`), photo: m.photo, assignedToId: m.assignedToId, estimatedCost: money(m.estimatedCost, `Maint ${m.id}`), actualCost: money(m.actualCost, `Maint ${m.id}`), completedAt: ts(m.completedAt), notes: m.notes, createdAt: ts(m.createdAt) })));
    counts.EmergencyReport = await insertRows(pg, 'EmergencyReport', ['id','tenantId','userId','type','description','location','status','severity','evidence','respondedAt','resolvedAt','resolution','createdAt'],
      src.EmergencyReport.map(e => ({ ...base, id: e.id, userId: e.userId, type: e.type, description: e.description, location: e.location, status: enumOr(e.status, E.emStatus, 'RESOLVED', `Emergency ${e.id}`), severity: enumOr(e.severity, E.severity, 'HIGH', `Emergency ${e.id}`), evidence: json(e.evidence), respondedAt: ts(e.respondedAt), resolvedAt: ts(e.resolvedAt), resolution: e.resolution, createdAt: ts(e.createdAt) })));
    counts.Notice = await insertRows(pg, 'Notice', ['id','tenantId','title','content','type','postedById','targetRole','isPinned','expiresAt','createdAt'],
      src.Notice.map(n => ({ ...base, ...n, targetRole: n.targetRole && E.role.includes(n.targetRole) ? n.targetRole : null, isPinned: bool(n.isPinned), expiresAt: ts(n.expiresAt), createdAt: ts(n.createdAt) })));
    counts.Message = await insertRows(pg, 'Message', ['id','tenantId','senderId','roomId','content','type','createdAt'], src.Message.map(m => ({ ...base, ...m, createdAt: ts(m.createdAt) })));
    counts.Poll = await insertRows(pg, 'Poll', ['id','tenantId','question','options','endsAt','createdAt'], src.Poll.map(p => ({ ...base, id: p.id, question: p.question, options: json(p.options) || '[]', endsAt: ts(p.endsAt), createdAt: ts(p.createdAt) })));
    const votes = [];
    for (const p of src.Poll) {
      let map = {}; try { map = JSON.parse(p.votes || '{}'); } catch { warn(`Poll ${p.id}: votes JSON unreadable -> no votes migrated`); }
      const voted = new Set();
      for (const [idx, users] of Object.entries(map)) for (const uid of users || []) {
        if (voted.has(uid)) { warn(`Poll ${p.id}: user ${uid} voted for several options (legacy bug) -> first kept`); continue; }
        voted.add(uid); votes.push({ ...base, id: crypto.randomUUID(), pollId: p.id, userId: uid, optionIndex: Number(idx) });
      }
    }
    counts.PollVote = await insertRows(pg, 'PollVote', ['id','tenantId','pollId','userId','optionIndex'], votes);
    counts.Guard = await insertRows(pg, 'Guard', ['id','tenantId','userId','gateId','shift'], src.Guard.map(g => ({ ...base, ...g })));
    counts.Notification = await insertRows(pg, 'Notification', ['id','tenantId','userId','title','body','type','data','isRead','createdAt'], src.Notification.map(n => ({ ...base, id: n.id, userId: n.userId, title: n.title, body: n.body, type: n.type, data: json(n.data), isRead: bool(n.isRead), createdAt: ts(n.createdAt) })));
    counts.Advertisement = await insertRows(pg, 'Advertisement', ['id','tenantId','title','content','imageUrl','linkUrl','advertiserName','type','placement','targetRole','startDate','endDate','isActive','impressions','clicks','status','createdAt'],
      src.Advertisement.map(a => ({ ...base, ...a, targetRole: a.targetRole && E.role.includes(a.targetRole) ? a.targetRole : null, startDate: ts(a.startDate), endDate: ts(a.endDate), isActive: bool(a.isActive), status: enumOr(a.status, E.adStatus, 'PENDING', `Ad ${a.id}`), createdAt: ts(a.createdAt) })));
    // legacy "currency" setting held a symbol ("₦"); currency is now a tenant property, so it is not copied.
    counts.Setting = await insertRows(pg, 'Setting', ['id','tenantId','key','value'], src.Setting.filter(s => s.key !== 'currency').map(s => ({ ...base, id: s.id, key: s.key, value: s.value })));

    await pg.query(`INSERT INTO "AuditLog"(id,"tenantId","actorType",action,entity,"entityId",after) VALUES ($1,$2,'SYSTEM','TENANT_MIGRATED_FROM_SQLITE','Tenant',$2,$3::jsonb)`,
      [crypto.randomUUID(), T, JSON.stringify({ counts, weakPasswordAccounts: weak.size, warnings: warnings.length })]);

    // 4. verification (source vs target)
    const problems = [];
    const expected = { ...Object.fromEntries(Object.entries(src).map(([k, v]) => [k, v.length])), PollVote: votes.length };
    expected.Setting = src.Setting.filter(s => s.key !== 'currency').length;
    expected.Payment = goodPayments.length;
    for (const [t, exp] of Object.entries(expected)) {
      const got = (await pg.query(`SELECT count(*)::int c FROM "${t}" WHERE "tenantId"=$1`, [T])).rows[0].c;
      if (got !== exp && !(t === 'AmenityBooking')) problems.push(`${t}: source ${exp} != target ${got}`);
    }
    const srcSum = src.Bill.reduce((s, b) => s + Math.round(Number(b.amount) * 100), 0);
    const dstSum = Math.round(Number((await pg.query(`SELECT COALESCE(sum(amount),0) s FROM "Bill" WHERE "tenantId"=$1`, [T])).rows[0].s) * 100);
    if (srcSum !== dstSum) problems.push(`Bill total: source ${srcSum / 100} != target ${dstSum / 100}`);
    if (problems.length) throw new Error('Verification failed:\n  ' + problems.join('\n  '));

    // 5. report
    console.log(`\n${DRY_RUN ? 'DRY RUN (will roll back)' : 'MIGRATION'}: tenant "${SLUG}" (${T}) status=${status} currency=${CURRENCY}`);
    console.table(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { rows: v }])));
    console.log(`Bill total ${CURRENCY} ${(dstSum / 100).toFixed(2)} — matches source`);
    if (weak.size) console.log(`\n${weak.size} account(s) still use a default/demo password -> mustChangePassword=true (they must change it at next login)`);
    if (paidWithoutPayment) console.log(`${paidWithoutPayment} bill(s) are PAID without any payment record — review manually.`);
    if (warnings.length) { console.log(`\n${warnings.length} data repair/notice(s):`); warnings.forEach(w => console.log('  - ' + w)); }

    await pg.query(DRY_RUN ? 'ROLLBACK' : 'COMMIT');
    console.log(DRY_RUN ? '\nRolled back (dry run). Nothing was written.' : '\nCommitted.');
  } catch (e) {
    try { await pg.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('\nMIGRATION FAILED — nothing was written.\n' + (e.stack || e));
    process.exitCode = 1;
  } finally {
    await pg.end(); lite.close();
  }
})();
