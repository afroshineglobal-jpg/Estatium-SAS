'use strict';
/** Stages of a maintenance request, in the order a resident sees them. REJECTED is a side exit. */
const STAGES = [
  { key: 'OPEN', label: 'Request received' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'ASSIGNED', label: 'Person allocated for inspection' },
  { key: 'IN_PROGRESS', label: 'Work in progress' },
  { key: 'AWAITING_PARTS', label: 'Awaiting parts' },
  { key: 'FIXED', label: 'Fixed' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'REJECTED', label: 'Declined' },
];
const KEYS = STAGES.map((s) => s.key);
const label = (k) => STAGES.find((s) => s.key === k)?.label || k;
const FINISHED = ['COMPLETED', 'CLOSED', 'REJECTED'];
const MAX_TIMELINE = 100;

/** Returns a new timeline with one more entry (oldest dropped past 100). */
function append(timeline, entry) {
  const list = Array.isArray(timeline) ? timeline : [];
  return [...list, { at: new Date().toISOString(), status: entry.status, note: entry.note || null, by: entry.by || null }].slice(-MAX_TIMELINE);
}

/** Payment state of a request from its invoices (voided / waived ones ignored): NONE | PENDING | PARTIAL | PAID, plus totals. */
function billingOf(bills) {
  const live = (bills || []).filter((b) => !['VOID', 'WAIVED'].includes(b.status));
  if (!live.length) return { status: 'NONE', count: 0, total: 0, paid: 0, overdue: false };
  const total = live.reduce((s, b) => s + Number(b.amount), 0); const paid = live.reduce((s, b) => s + Number(b.amountPaid), 0);
  const status = paid >= total - 0.005 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING';
  return { status, count: live.length, total: Math.round(total * 100) / 100, paid: Math.round(paid * 100) / 100, overdue: live.some((b) => b.status === 'OVERDUE') };
}

module.exports = { STAGES, KEYS, label, FINISHED, append, billingOf };
