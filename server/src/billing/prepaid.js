'use strict';
/**
 * Manual prepaid billing — PURE rules (no I/O, unit-tested).
 *
 * "Paid through" is the last paid day, inclusive, in UTC. Access ends at the START of the next UTC day.
 * Countdown is COMPUTED from dates at read time, never stored, so it cannot go stale.
 *
 *   no end date                      -> UNPAID   (full access, no countdown)
 *   > 90 days left                   -> ACTIVE
 *   61..90                           -> APPROACHING
 *   31..60                           -> DUE_SOON
 *   1..30                            -> URGENT
 *   expired, within grace (30 days)  -> GRACE     (full access + warning)
 *   expired, past grace              -> READ_ONLY (view + SOS only; paying lifts it at once)
 *
 * The end date is the paid-through date when there is one, otherwise the trial end (so every estate
 * has either a paid date or an explicit trial end). There is never a hard lock-out and never deletion.
 */
const DAY = 86400000;
const DEFAULT_THRESHOLDS = [90, 60, 30];
const DEFAULT_GRACE_DAYS = 30;

const startOfNextUtcDay = (d) => { const x = new Date(d); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() + 1)); };
const toDay = (v) => { const d = new Date(v); if (Number.isNaN(d.getTime())) throw new Error('Invalid date'); return d; };

/** @returns {{state:string, source:'PAID'|'TRIAL'|null, daysLeft:number|null, graceDaysLeft:number|null, readOnly:boolean, expiresAt:Date|null, readOnlyFrom:Date|null}} */
function prepaidState({ paidThrough = null, trialEndsAt = null, now = new Date(), graceDays = DEFAULT_GRACE_DAYS, thresholds = DEFAULT_THRESHOLDS } = {}) {
  const [t1, t2, t3] = thresholds;
  let source = null; let expiresAt = null;
  if (paidThrough) { source = 'PAID'; expiresAt = startOfNextUtcDay(toDay(paidThrough)); }
  else if (trialEndsAt) { source = 'TRIAL'; expiresAt = toDay(trialEndsAt); }
  if (!expiresAt) return { state: 'UNPAID', source: null, daysLeft: null, graceDaysLeft: null, readOnly: false, expiresAt: null, readOnlyFrom: null };

  const readOnlyFrom = new Date(expiresAt.getTime() + graceDays * DAY);
  const t = new Date(now).getTime();
  if (t < expiresAt.getTime()) {
    const daysLeft = Math.ceil((expiresAt.getTime() - t) / DAY);
    const state = daysLeft > t1 ? 'ACTIVE' : daysLeft > t2 ? 'APPROACHING' : daysLeft > t3 ? 'DUE_SOON' : 'URGENT';
    return { state, source, daysLeft, graceDaysLeft: null, readOnly: false, expiresAt, readOnlyFrom };
  }
  if (t < readOnlyFrom.getTime()) {
    return { state: 'GRACE', source, daysLeft: 0, graceDaysLeft: Math.ceil((readOnlyFrom.getTime() - t) / DAY), readOnly: false, expiresAt, readOnlyFrom };
  }
  return { state: 'READ_ONLY', source, daysLeft: 0, graceDaysLeft: 0, readOnly: true, expiresAt, readOnlyFrom };
}

/** Latest day covered by the non-voided ledger entries (inclusive), or null. Entries may overlap or leave gaps:
 *  the explicit periodTo of the latest-ending payment wins - a gap is the operator's decision, not inferred. */
function paidThroughFromLedger(payments) {
  let best = null;
  for (const p of payments) {
    if (p.status === 'VOIDED') continue;
    const to = toDay(p.periodTo);
    if (!best || to > best) best = to;
  }
  return best;
}

module.exports = { prepaidState, paidThroughFromLedger, DEFAULT_THRESHOLDS, DEFAULT_GRACE_DAYS, startOfNextUtcDay };
