// The single source of truth for the admin *policy* — "who counts as an
// admin" (docs/plans/duplication-cleanup-plan.md B-D3). Role *names* live in
// user.model.js's ROLES; this is the subset the codebase treats as admin,
// used by route guards (requireRole) and service-layer checks alike.
//
// The helper is named hasAdminRole, not isAdmin, on purpose: call sites
// write `const isAdmin = hasAdminRole(user)`, and `const isAdmin =
// isAdmin(user)` would be a temporal-dead-zone ReferenceError.

const ADMIN_ROLES = ['admin', 'superadmin'];

function hasAdminRole(user) {
  return Boolean(user) && ADMIN_ROLES.includes(user.role);
}

module.exports = { ADMIN_ROLES, hasAdminRole };
