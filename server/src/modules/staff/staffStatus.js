'use strict';
/** Pure rules for staff status changes (kept separate so they are unit-tested without a database). */
const STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'LEFT'];
const LABELS = { ACTIVE: 'Active', SUSPENDED: 'Suspended', DEACTIVATED: 'Deactivated', LEFT: 'Left the job' };

/** @returns {{ok:boolean, error?:string, patch?:object, userPatch?:object}} */
function planStatusChange(current, next, { note, date, now = new Date() } = {}) {
  if (!STATUSES.includes(next)) return { ok: false, error: `status must be one of: ${STATUSES.join(', ')}` };
  if (current === next) return { ok: false, error: `This person is already ${LABELS[next].toLowerCase()}` };
  const text = typeof note === 'string' ? note.trim() : '';
  if (next !== 'ACTIVE' && text.length < 3) return { ok: false, error: 'Please give a reason (at least 3 characters)' };
  let leftAt = null;
  if (next === 'LEFT') { leftAt = date ? new Date(date) : now; if (Number.isNaN(leftAt.getTime())) return { ok: false, error: 'The leaving date is not valid' }; }
  const active = next === 'ACTIVE';
  return {
    ok: true,
    patch: { status: next, isActive: active, statusNote: active ? null : text, statusChangedAt: now, leftAt },
    userPatch: active ? { isActive: true, failedLogins: 0, lockedUntil: null } : { isActive: false, signOutEverywhere: true },   // inactive => cannot sign in; tokenVersion bump ends open sessions
  };
}
module.exports = { STATUSES, LABELS, planStatusChange };
