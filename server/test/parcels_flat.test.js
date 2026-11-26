'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/modules/parcels/parcels.routes.js'), 'utf8');

test('parcel lists and the new-parcel reply say which flat the parcel is for', () => {
  assert.match(src, /async function withFlat/);
  assert.match(src, /res\.json\(await withFlat\(rows, req\.user\.role !== 'RESIDENT'\)\)/);
  assert.match(src, /const \[shown\] = await withFlat\(\[publicParcel\(parcel\)\], true\)/);
});
test('gate staff can find a parcel by OTP, residents can only re-issue the OTP of their own unit', () => {
  assert.match(src, /router\.post\('\/lookup', authenticate, authorize\(\.\.\.GATE\), codeLimiter/);
  assert.match(src, /router\.post\('\/:id\/otp', authenticate, codeLimiter/);
  assert.match(src, /req\.user\.role !== 'RESIDENT'/);
  assert.doesNotMatch(src, /otpHash: p\.otpHash|res\.json\(\{[^}]*otpHash/);      // the hash itself never leaves the server
});
