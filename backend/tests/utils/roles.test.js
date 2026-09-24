const { ADMIN_ROLES, hasAdminRole } = require('../../src/utils/roles');
const { ROLES } = require('../../src/models/user.model');

describe('utils/roles', () => {
  it('ADMIN_ROLES is exactly admin + superadmin', () => {
    expect(ADMIN_ROLES).toEqual(['admin', 'superadmin']);
  });

  // User.ROLES is the source of truth for role NAMES; ADMIN_ROLES is the admin
  // policy over them. A typo here (or a renamed role) must fail loudly rather
  // than silently lock everyone out of admin routes.
  it('every ADMIN_ROLES entry is a real role in User.ROLES', () => {
    ADMIN_ROLES.forEach((role) => {
      expect(ROLES).toContain(role);
    });
  });

  describe('hasAdminRole', () => {
    it.each(['admin', 'superadmin'])('is true for %s', (role) => {
      expect(hasAdminRole({ role })).toBe(true);
    });

    it.each(['coach', 'parent', 'student'])('is false for %s', (role) => {
      expect(hasAdminRole({ role })).toBe(false);
    });

    it('is false for a missing user or a user with no role', () => {
      expect(hasAdminRole(undefined)).toBe(false);
      expect(hasAdminRole(null)).toBe(false);
      expect(hasAdminRole({})).toBe(false);
    });
  });
});
