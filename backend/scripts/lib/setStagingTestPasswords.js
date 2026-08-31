// Sets every login-capable user's password to one known value, for staging
// testing convenience (owner request, 2026-08-31) — so any real family's
// parent account, or any of the real coach accounts (each of which the
// legacy import gives its own distinct `ChangeMe-*` password —
// legacy-import.config.js), can be logged into directly without a reset
// flow. A migrated parent otherwise has NO password at all (runLegacyImport
// .js's own findOrCreateParent: "a migrated parent can't log in until they
// set a password via the real signup/reset flow" — correct for the real
// go-live import, useless for staging testing).
//
// 'student' is deliberately excluded — a student is a profile record, not
// a login-capable role in this system, regardless of environment.
//
// STAGING/LOCAL ONLY. This function has no opinion on staging vs.
// production itself, same discipline as wipeDatabase() — it must never be
// called without a guard already having run (the CLI wrapper's
// assertStagingOrLocal). Setting one shared, publicly-known password across
// every real family's account would be a severe incident if this ever ran
// against production.

const User = require('../../src/models/user.model');
const { hashPassword } = require('../../src/utils/password');

const LOGIN_CAPABLE_ROLES = ['parent', 'coach', 'admin', 'superadmin'];
const STAGING_TEST_PASSWORD = 'Test@123';

async function setStagingTestPasswords() {
  const passwordHash = await hashPassword(STAGING_TEST_PASSWORD);

  const result = await User.updateMany(
    { role: { $in: LOGIN_CAPABLE_ROLES } },
    { $set: { passwordHash } }
  );

  return { usersUpdated: result.modifiedCount, password: STAGING_TEST_PASSWORD };
}

module.exports = { setStagingTestPasswords, STAGING_TEST_PASSWORD, LOGIN_CAPABLE_ROLES };
