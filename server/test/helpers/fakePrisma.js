'use strict';
/**
 * A tiny in-memory stand-in for @prisma/client, used ONLY by the HTTP-level tests.
 * It is deliberately dumb (equality/in/not/gt/lt/contains filters, increment updates, no relations),
 * but it faithfully runs the REAL client-extension hooks ($extends -> $allOperations), so the real
 * tenant-scope code, middleware and route handlers execute exactly as in production.
 */
const crypto = require('crypto');
const Decimal = require('decimal.js');

const MODELS = ['Tenant', 'Plan', 'PlanPrice', 'Subscription', 'SubscriptionEvent', 'SubscriptionCoupon', 'Coupon', 'Currency', 'Invoice', 'InvoiceLine', 'PlatformPayment', 'PlatformUser', 'AuditLog', 'UsageRecord', 'ExchangeRate',
  'User', 'Block', 'Unit', 'Resident', 'FamilyMember', 'Visitor', 'Parcel', 'Amenity', 'AmenitySlot', 'AmenityBooking', 'Bill', 'Payment', 'Vehicle', 'VehicleLog', 'StaffMember', 'AttendanceLog', 'Task',
  'MaintenanceRequest', 'EmergencyReport', 'Notice', 'Message', 'Poll', 'PollVote', 'Guard', 'Notification', 'Advertisement', 'Setting'];
const lower = (s) => s[0].toLowerCase() + s.slice(1);
const eq = (a, b) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : a === b);

function match(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return [].concat(v).every((w) => match(row, w));
    if (k === 'OR') return v.some((w) => match(row, w));
    if (k === 'NOT') return !match(row, v);
    if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Decimal)) {
      if ('some' in v || 'every' in v || 'none' in v) return true;                    // relation filters ignored
      return Object.entries(v).every(([op, x]) => {
        const val = row[k];
        switch (op) {
          case 'in': return x.some((y) => eq(val, y));
          case 'not': return x === null ? val != null : !eq(val, x);
          case 'notIn': return !x.some((y) => eq(val, y));
          case 'gt': return val > x; case 'gte': return val >= x; case 'lt': return val < x; case 'lte': return val <= x;
          case 'contains': return String(val ?? '').toLowerCase().includes(String(x).toLowerCase());
          case 'startsWith': return String(val ?? '').startsWith(x);
          case 'mode': return true;
          default: return true;
        }
      });
    }
    return eq(row[k], v);
  });
}

function applyData(row, data) {
  for (const [k, v] of Object.entries(data || {})) {
    if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Decimal)) {
      if ('increment' in v) row[k] = (Number(row[k]) || 0) + Number(v.increment);
      else if ('set' in v) row[k] = v.set;
      else if ('create' in v || 'connect' in v) { /* nested writes not simulated */ }
      else row[k] = v;
    } else row[k] = v;
  }
  return row;
}

const notFound = () => Object.assign(new Error('Record not found'), { code: 'P2025' });

function build(store) {
  const exec = (model, op, a = {}) => {
    const rows = (store[model] ||= []);
    switch (op) {
      case 'findFirst': case 'findFirstOrThrow': case 'findUnique': case 'findUniqueOrThrow': {
        const r = rows.find((x) => match(x, a.where)) ?? null; if (!r && op.endsWith('OrThrow')) throw notFound(); return r;
      }
      case 'findMany': return rows.filter((x) => match(x, a.where)).slice(0, a.take ?? 1e9);
      case 'count': return rows.filter((x) => match(x, a.where)).length;
      case 'create': { const r = { id: crypto.randomUUID(), createdAt: new Date(), ...applyData({}, a.data) }; rows.push(r); return r; }
      case 'createMany': { const list = [].concat(a.data); list.forEach((d) => rows.push({ id: crypto.randomUUID(), createdAt: new Date(), ...applyData({}, d) })); return { count: list.length }; }
      case 'update': { const r = rows.find((x) => match(x, a.where)); if (!r) throw notFound(); return applyData(r, a.data); }
      case 'updateMany': { const hit = rows.filter((x) => match(x, a.where)); hit.forEach((r) => applyData(r, a.data)); return { count: hit.length }; }
      case 'delete': { const i = rows.findIndex((x) => match(x, a.where)); if (i < 0) throw notFound(); return rows.splice(i, 1)[0]; }
      case 'deleteMany': { const keep = rows.filter((x) => !match(x, a.where)); const n = rows.length - keep.length; store[model] = keep; return { count: n }; }
      case 'upsert': { const r = rows.find((x) => match(x, a.where)); return r ? applyData(r, a.update) : exec(model, 'create', { data: a.create }); }
      case 'aggregate': return { _sum: {}, _count: rows.filter((x) => match(x, a.where)).length };
      case 'groupBy': return [];
      default: throw new Error(`fakePrisma: ${model}.${op} not implemented`);
    }
  };
  return exec;
}

class PrismaClient {
  constructor() { this.store = {}; this.exec = build(this.store); this._hooks = []; this._wire(); }
  _wire() {
    for (const m of MODELS) {
      this[lower(m)] = new Proxy({}, { get: (_t, op) => (args) => {
        const run = (a) => Promise.resolve().then(() => this.exec(m, op, a));
        return this._hooks.reduceRight((next, hook) => (a) => hook({ model: m, operation: op, args: a, query: next }), run)(args);
      } });
    }
  }
  $extends(ext) {
    const child = Object.create(this);                           // shares the store; adds its own hook chain
    child._hooks = [...this._hooks]; child._wire = this._wire; child.exec = this.exec;
    const hook = ext?.query?.$allModels?.$allOperations; if (hook) child._hooks.push(hook);
    child._wire();
    return child;
  }
  async $transaction(x) { return typeof x === 'function' ? x(this) : Promise.all(x); }
  async $executeRaw() { return 0; }
  async $queryRaw() { return []; }
  async $disconnect() {}
}

module.exports = { PrismaClient, Prisma: { Decimal }, MODELS };
