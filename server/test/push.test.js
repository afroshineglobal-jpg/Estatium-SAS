'use strict';
process.env.DATABASE_URL ||= 'postgresql://x:y@127.0.0.1:5432/x'; process.env.JWT_SECRET ||= 'a'.repeat(40); process.env.PLATFORM_JWT_SECRET ||= 'b'.repeat(40);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('alert kinds: visitor doorbell, emergency siren, everything else message', () => {
  const { kindOf } = require('../src/utils/webpush');
  assert.equal(kindOf('VISITOR'), 'VISITOR'); assert.equal(kindOf('EMERGENCY'), 'EMERGENCY');
  for (const t of ['GENERAL', 'NOTICE', 'PARCEL', 'BILLING', 'MAINTENANCE', undefined]) assert.equal(kindOf(t), 'MESSAGE');
});
test('web push stays off (and harmless) when no VAPID keys are configured', async () => {
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  const wp = require('../src/utils/webpush');
  assert.equal(wp.enabled(), false); assert.equal(wp.publicKey(), null);
  assert.deepEqual(await wp.send({ endpoint: 'https://x', p256dh: 'a', auth: 'b' }, { kind: 'VISITOR' }), { ok: false, gone: false });
});
test('migration 009 is idempotent, tenant-isolated, and purge knows the table', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/009_push_subscriptions.sql'), 'utf8');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/); assert.match(sql, /forbid_tenant_change/);
  assert.match(sql, /DELETE FROM "PushSubscription"\s+WHERE "tenantId" = p_tenant/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE/i);
});
