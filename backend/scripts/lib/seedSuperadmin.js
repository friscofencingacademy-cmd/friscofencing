// Extracted from scripts/seed-superadmin.js (which is now a thin CLI
// wrapper around this) on its second use — scripts/refreshStagingData.js
// needs the same idempotent create-if-missing logic without spawning a
// second process or a second Mongo connection.

const User = require('../../src/models/user.model');
const { hashPassword } = require('../../src/utils/password');

async function seedSuperadmin({ email, password, firstName, lastName }) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });

  if (existing) {
    return { superadmin: existing, created: false };
  }

  const passwordHash = await hashPassword(password);
  const superadmin = await User.create({
    role: 'superadmin',
    firstName,
    lastName,
    email: normalizedEmail,
    passwordHash,
  });

  return { superadmin, created: true };
}

module.exports = { seedSuperadmin };
