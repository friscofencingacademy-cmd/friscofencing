const User = require('../models/user.model');
const { comparePassword, hashPassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');

// Standard practice: never reveal whether a login failed because the email
// wasn't found, the account has no password set (e.g. a student, who can't
// log in in this MVP), or the password was wrong. One generic message for
// all three cases.
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

async function login({ email, password }) {
  const normalizedEmail = String(email || '').toLowerCase().trim();

  const user = await User.findOne({ email: normalizedEmail });

  if (!user || !user.passwordHash) {
    const error = new Error(INVALID_CREDENTIALS_MESSAGE);
    error.status = 401;
    throw error;
  }

  const isMatch = await comparePassword(password, user.passwordHash);

  if (!isMatch) {
    const error = new Error(INVALID_CREDENTIALS_MESSAGE);
    error.status = 401;
    throw error;
  }

  const token = signToken({ id: user._id, role: user.role });

  return { token, user: user.toSafeJSON() };
}

// Public self-signup, parent-only. The unique+sparse index on User.email
// (user.model.js) is the race-safety backstop behind this pre-check — same
// two-layer duplicate-prevention pattern as price.service.js's
// assertNoExistingPrice.
async function register({ firstName, lastName, email, password }) {
  const normalizedEmail = String(email || '').toLowerCase().trim();

  const existing = await User.findOne({ email: normalizedEmail });

  if (existing) {
    const error = new Error('An account with this email already exists');
    error.status = 409;
    throw error;
  }

  const passwordHash = await hashPassword(password);

  const user = await User.create({
    role: 'parent',
    firstName,
    lastName,
    email: normalizedEmail,
    passwordHash,
  });

  const token = signToken({ id: user._id, role: user.role });

  return { token, user: user.toSafeJSON() };
}

module.exports = { login, register };
