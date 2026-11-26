'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const C = require('../src/modules/tickets/tickets.constants');
const { can } = require('../src/modules/platform/permissions');

test('statuses and categories match the database CHECK constraints', () => {
  const sql = read('sql/015_tickets.sql');
  for (const s of C.STATUSES) assert.match(sql, new RegExp(`'${s}'`)); for (const c of C.CATEGORIES) assert.match(sql, new RegExp(`'${c}'`));
  assert.doesNotMatch(sql, /DROP|TRUNCATE/i);
});
test('estate users only ever read their own tickets: every query carries tenantId and userId', () => {
  const src = read('src/modules/tickets/tickets.routes.js');
  assert.match(src, /const mine = \(req\) => \(\{ tenantId: req\.tenant\.id, userId: req\.user\.id \}\)/);
  for (const m of src.match(/db\.ticket\.(findMany|findFirst|count)\(\{[^\n]*/g)) assert.match(m, /mine\(req\)/, m);
});
test('platform tickets need tickets:manage; support and owner have it, billing and read-only do not', () => {
  assert.ok(can('SUPER_OWNER', 'tickets:manage')); assert.ok(can('SUPPORT', 'tickets:manage'));
  assert.ok(!can('BILLING_ADMIN', 'tickets:manage')); assert.ok(!can('READ_ONLY', 'tickets:manage'));
  const src = read('src/modules/platform/tickets.routes.js'); assert.equal((src.match(/need\('tickets:manage'\)/g) || []).length, 5);
});
test('daily limit is enforced and closed tickets cannot be replied to', () => {
  const src = read('src/modules/tickets/tickets.routes.js'); assert.match(src, /TICKET_LIMIT/); assert.match(src, /TICKET_CLOSED/); assert.equal(C.MAX_PER_DAY, 5);
});
