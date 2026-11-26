'use strict';
/**
 * Ad targeting (pure functions, unit-tested without a database).
 *
 * targeting = { everywhere?: true, countries:[], states:[], districts:[], cities:[], areas:[], localities:[],
 *               postalCodes:[], estateIds:[], flats:{ [tenantId]: [unitId] } }
 * Place keys carry their parents so equal names in different places never clash:
 *   country  "Nigeria"                     state  "Nigeria|Lagos"
 *   district / city / area / locality      "Nigeria|Lagos|Ikeja"
 * An estate matches when ANY entry matches (a state entry covers every estate in that state, and so on).
 * A flat entry matches only that flat. No entries at all means nothing matches (use `everywhere`).
 */
const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
const LEVELS = [['countries', 'country'], ['states', 'state'], ['districts', 'district'], ['cities', 'city'], ['areas', 'area'], ['localities', 'locality']];

/** The key an estate has at a level, or null when the estate has no value there. */
function placeKey(level, t) {
  const c = norm(t.country), s = norm(t.state);
  if (level === 'countries') return c ? c : null;
  if (level === 'states') return c && s ? `${c}|${s}` : null;
  const v = norm({ districts: t.district, cities: t.city, areas: t.area, localities: t.locality }[level]);
  return c && s && v ? `${c}|${s}|${v}` : null;
}
const keyOf = (level, parts) => parts.map(norm).join('|');       // build a key from names: keyOf('states', ['Nigeria', 'Lagos'])

const list = (t, k) => (Array.isArray(t?.[k]) ? t[k] : []);

/** Does the estate (and, if `unitId` is given, that flat) fall inside the targeting? */
function matches(targeting, tenant, unitId = null) {
  const g = targeting || {};
  if (g.everywhere === true) return true;
  if (list(g, 'estateIds').includes(tenant.id)) return true;
  for (const [level] of LEVELS) { const key = placeKey(level, tenant); if (key && list(g, level).map(norm).includes(key)) return true; }
  const pc = norm(tenant.postalCode);
  if (pc && list(g, 'postalCodes').some((p) => norm(p) && pc.startsWith(norm(p)))) return true;
  const flats = g.flats && g.flats[tenant.id];
  if (unitId && Array.isArray(flats) && flats.includes(unitId)) return true;
  return false;
}

/** Estate-level match only (ignores individual flats). */
const matchesEstate = (targeting, tenant) => matches(targeting, tenant, null);
const hasFlatsFor = (targeting, tenantId) => Array.isArray(targeting?.flats?.[tenantId]) && targeting.flats[tenantId].length > 0;

function hasAnyTarget(g) {
  if (!g) return false;
  if (g.everywhere === true) return true;
  return LEVELS.some(([l]) => list(g, l).length) || list(g, 'postalCodes').length || list(g, 'estateIds').length || Object.values(g.flats || {}).some((a) => Array.isArray(a) && a.length);
}

/** Cleans what the browser sent: only known keys, short strings, bounded lists. Throws Error(message) on nonsense. */
function sanitize(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  if (g.everywhere === true) return { everywhere: true };
  const strs = (a, max = 200, len = 120) => [...new Set((Array.isArray(a) ? a : []).map((x) => String(x == null ? '' : x).trim()).filter(Boolean).map((x) => x.slice(0, len)))].slice(0, max);
  const out = {};
  for (const [level] of LEVELS) out[level] = strs(g[level]);
  out.postalCodes = strs(g.postalCodes, 100, 20);
  out.estateIds = strs(g.estateIds, 500, 60);
  out.flats = {};
  for (const [tid, units] of Object.entries(g.flats && typeof g.flats === 'object' ? g.flats : {}).slice(0, 200)) { const u = strs(units, 2000, 60); if (u.length) out.flats[String(tid).slice(0, 60)] = u; }
  if (!hasAnyTarget(out)) throw new Error('Choose where the banner should run, or pick "Everywhere"');
  return out;
}

/** One-line description for the campaign list. */
function summarize(g) {
  if (!g || !hasAnyTarget(g)) return 'No targets';
  if (g.everywhere) return 'Everywhere';
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  const parts = [];
  const names = { countries: ['country', 'countries'], states: ['state', 'states'], districts: ['LGA/district', 'LGAs/districts'], cities: ['city', 'cities'], areas: ['area', 'areas'], localities: ['locality', 'localities'] };
  for (const [l, [one, many]] of Object.entries(names)) if (n(g[l])) parts.push(`${n(g[l])} ${n(g[l]) > 1 ? many : one}`);
  if (n(g.postalCodes)) parts.push(`${n(g.postalCodes)} ZIP`);
  if (n(g.estateIds)) parts.push(`${n(g.estateIds)} estate${n(g.estateIds) > 1 ? 's' : ''}`);
  const flats = Object.values(g.flats || {}).reduce((s, a) => s + n(a), 0); if (flats) parts.push(`${flats} flat${flats > 1 ? 's' : ''}`);
  return parts.join(', ');
}

module.exports = { norm, placeKey, keyOf, matches, matchesEstate, hasFlatsFor, hasAnyTarget, sanitize, summarize, LEVELS };
