'use strict';
process.env.DATABASE_URL ||= 'postgresql://x:y@127.0.0.1:5432/x'; process.env.JWT_SECRET ||= 'a'.repeat(40); process.env.PLATFORM_JWT_SECRET ||= 'b'.repeat(40);
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/modules/registration/registration.service');

const jpeg = (n) => { const b = Buffer.alloc(n, 1); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return 'data:image/jpeg;base64,' + b.toString('base64'); };

test('codes are 8 chars from the unambiguous alphabet and normalise', () => {
  for (let i = 0; i < 200; i++) assert.match(R.genCode(), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(R.normCode(' ab3d-k7mq '), 'AB3DK7MQ');
  assert.equal(R.showCode('AB3DK7MQ'), 'AB3D-K7MQ');
  assert.equal(R.showCode(null), null);
});

test('selfie validation: accepts JPEG, rejects everything else', () => {
  assert.equal(R.parseSelfie(jpeg(5000)).length, 5000);
  assert.throws(() => R.parseSelfie(jpeg(100)), /too small/);
  assert.throws(() => R.parseSelfie(jpeg(500 * 1024)), /too large/);
  assert.throws(() => R.parseSelfie('data:image/png;base64,AAAA'), /JPEG/);
  assert.throws(() => R.parseSelfie(undefined), /JPEG/);
  const fake = 'data:image/jpeg;base64,' + Buffer.alloc(3000, 7).toString('base64');   // right header text, wrong magic bytes
  assert.throws(() => R.parseSelfie(fake), /not a valid JPEG/);
});
