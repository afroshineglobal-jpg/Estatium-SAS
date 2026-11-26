'use strict';
process.env.DATABASE_URL ||= 'postgresql://x:y@127.0.0.1:5432/x'; process.env.JWT_SECRET ||= 'a'.repeat(40); process.env.PLATFORM_JWT_SECRET ||= 'b'.repeat(40);
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempPassword } = require('../src/utils/credentials');
const H = require('../src/utils/http');

test('temporary passwords satisfy the password policy and are unique', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) { const p = tempPassword(); assert.doesNotThrow(() => H.password(p), p); assert.ok(!/^[-_]/.test(p)); seen.add(p); }
  assert.equal(seen.size, 300);
});
