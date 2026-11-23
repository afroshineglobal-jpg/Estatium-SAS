'use strict';
// Regression: SubscriptionEvent has no actorEmail column, so spreading actorFields() (which includes
// actorEmail) into subscriptionEvent.create() makes Prisma throw and the whole operation 500s.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); }

test('subscriptionEvent.create never receives actorEmail', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  const model = schema.match(/model SubscriptionEvent \{[\s\S]*?\n\}/)[0];
  assert.ok(!/actorEmail/.test(model), 'schema changed: if SubscriptionEvent now has actorEmail, delete this test');
  const bad = [];
  for (const f of walk(path.join(__dirname, '../src')).filter((p) => p.endsWith('.js'))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/subscriptionEvent\.create/.test(l) && /actorFields\(|actorEmail/.test(l)) bad.push(`${path.relative(process.cwd(), f)}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(bad, []);
});
