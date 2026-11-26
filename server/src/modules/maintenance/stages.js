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

module.exports = { STAGES, KEYS, label, FINISHED, append };
