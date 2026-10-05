'use strict';
// Every Prisma model that carries a `tenantId` and is protected by the tenant scope + PostgreSQL RLS.
// Keep in sync with prisma/schema.prisma and sql/002_rls_and_constraints.sql (test/tenantModels.test.js checks it).
module.exports = new Set([
  'User', 'Block', 'Unit', 'Resident', 'FamilyMember', 'Visitor', 'Parcel', 'Amenity', 'AmenitySlot',
  'AmenityBooking', 'Bill', 'Payment', 'Vehicle', 'VehicleLog', 'StaffMember', 'AttendanceLog', 'Task',
  'MaintenanceRequest', 'EmergencyReport', 'Notice', 'Message', 'Poll', 'PollVote', 'Guard',
  'Notification', 'Advertisement', 'Setting',
]);
