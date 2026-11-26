'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const T = require('../src/utils/adTargeting');

const lagos = { id: 't1', country: 'Nigeria', state: 'Lagos', district: 'Ikeja', city: 'Lagos', area: 'GRA', locality: 'Alausa', postalCode: '100271' };
const abuja = { id: 't2', country: 'Nigeria', state: 'Federal Capital Territory', district: 'Bwari', city: 'Abuja', area: '', locality: 'Kubwa', postalCode: '901101' };
const mumbai = { id: 't3', country: 'India', state: 'Maharashtra', district: 'Mumbai Suburban', city: 'Mumbai', area: '', locality: 'Andheri', postalCode: '400053' };
const key = T.keyOf;

test('a country, state or smaller place covers every estate inside it, case and spacing ignored', () => {
  assert.equal(T.matches({ countries: ['nigeria'] }, lagos), true);
  assert.equal(T.matches({ countries: ['Nigeria'] }, mumbai), false);
  assert.equal(T.matches({ states: [key('states', ['Nigeria', ' lagos '])] }, lagos), true);
  assert.equal(T.matches({ states: [key('states', ['Nigeria', 'Lagos'])] }, abuja), false);
  assert.equal(T.matches({ districts: [key('districts', ['Nigeria', 'Lagos', 'Ikeja'])] }, lagos), true);
  assert.equal(T.matches({ localities: [key('localities', ['Nigeria', 'Lagos', 'Alausa'])] }, lagos), true);
});

test('equal names in different states or countries never clash', () => {
  const a = { id: 'a', country: 'Nigeria', state: 'Lagos', locality: 'Central' }, b = { id: 'b', country: 'Nigeria', state: 'Kano', locality: 'Central' };
  const g = { localities: [key('localities', ['Nigeria', 'Lagos', 'Central'])] };
  assert.equal(T.matches(g, a), true); assert.equal(T.matches(g, b), false);
});

test('ZIP prefixes, chosen estates and single flats', () => {
  assert.equal(T.matches({ postalCodes: ['1002'] }, lagos), true);
  assert.equal(T.matches({ postalCodes: ['1002'] }, abuja), false);
  assert.equal(T.matches({ estateIds: ['t3'] }, mumbai), true);
  const g = { flats: { t1: ['u1', 'u2'] } };
  assert.equal(T.matches(g, lagos, 'u1'), true); assert.equal(T.matches(g, lagos, 'u9'), false); assert.equal(T.matches(g, lagos, null), false);
  assert.equal(T.hasFlatsFor(g, 't1'), true); assert.equal(T.hasFlatsFor(g, 't2'), false);
});

test('"everywhere" matches all; an empty target matches nothing and is refused', () => {
  assert.equal(T.matches({ everywhere: true }, mumbai), true);
  assert.equal(T.matches({}, lagos), false);
  assert.throws(() => T.sanitize({ states: [] }), /Choose where/);
  assert.deepEqual(T.sanitize({ everywhere: true, states: ['x'] }), { everywhere: true });
});

test('sanitize keeps only known keys, trims, de-duplicates and bounds the lists', () => {
  const g = T.sanitize({ states: [' A|B ', 'A|B'], evil: 1, estateIds: ['e'], flats: { t1: ['u1', 'u1', ''] } });
  assert.deepEqual(g.states, ['A|B']); assert.deepEqual(g.flats, { t1: ['u1'] }); assert.equal(g.evil, undefined);
  assert.equal(T.sanitize({ states: Array.from({ length: 500 }, (_, i) => `n${i}`) }).states.length, 200);
});

test('summary line', () => {
  assert.equal(T.summarize({ everywhere: true }), 'Everywhere');
  assert.equal(T.summarize({ states: ['a|b', 'a|c'], cities: ['x'], flats: { t: ['1', '2'] } }), '2 states, 1 city, 2 flats');
});

test('migration 012: campaign tables, per-estate stats and the reach function (counts only, estate-isolated reads stay with RLS tables)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/012_ad_campaigns.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "AdCampaign"/); assert.match(sql, /CREATE TABLE IF NOT EXISTS "AdCampaignStat"/);
  assert.match(sql, /platform_reach_units\(\)/); assert.match(sql, /SECURITY DEFINER/); assert.match(sql, /REVOKE ALL ON FUNCTION platform_reach_units\(\) FROM PUBLIC/);
  assert.doesNotMatch(sql, /name|email|phone/i.source ? /"user"|"email"|"phone"/ : /x/);          // no personal data leaves the function
  assert.doesNotMatch(sql, /DROP|TRUNCATE/i);
});
