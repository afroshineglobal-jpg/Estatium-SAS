'use strict';
/** Super Owner portal permission model. `*` = everything, `x:*` = everything on resource x. */
const PERMISSIONS = [
  'tenants:read', 'tenants:create', 'tenants:update', 'tenants:suspend', 'tenants:activate', 'tenants:delete',
  'subscriptions:read', 'subscriptions:update', 'invoices:read', 'invoices:manage',
  'plans:read', 'plans:manage', 'coupons:read', 'coupons:manage', 'currencies:read', 'currencies:manage',
  'revenue:read', 'usage:read', 'audit:read', 'platform_users:manage',
];

const ROLE_PERMISSIONS = {
  SUPER_OWNER:   ['*'],
  BILLING_ADMIN: ['tenants:read', 'subscriptions:*', 'invoices:*', 'plans:*', 'coupons:*', 'currencies:read', 'revenue:read', 'usage:read', 'audit:read'],
  SUPPORT:       ['tenants:read', 'tenants:update', 'subscriptions:read', 'invoices:read', 'plans:read', 'coupons:read', 'currencies:read', 'usage:read', 'audit:read'],
  READ_ONLY:     ['tenants:read', 'subscriptions:read', 'invoices:read', 'plans:read', 'coupons:read', 'currencies:read', 'revenue:read', 'usage:read', 'audit:read'],
};

function can(role, permission) {
  const grants = ROLE_PERMISSIONS[role] || [];
  const [resource] = permission.split(':');
  return grants.includes('*') || grants.includes(permission) || grants.includes(`${resource}:*`);
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, can };
