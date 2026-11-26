'use strict';
const CATEGORIES = ['IDEA', 'PROBLEM', 'QUESTION', 'OTHER'];
const STATUSES = ['OPEN', 'IN_REVIEW', 'PLANNED', 'DONE', 'CLOSED'];
const STATUS_LABEL = { OPEN: 'Received', IN_REVIEW: 'Under review', PLANNED: 'Planned', DONE: 'Done', CLOSED: 'Closed' };
const MAX_PER_DAY = 5;
module.exports = { CATEGORIES, STATUSES, STATUS_LABEL, MAX_PER_DAY };
