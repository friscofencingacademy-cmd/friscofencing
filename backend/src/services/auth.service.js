const User = require('../models/user.model');
const { comparePassword } = require('../utils/password');
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

module.exports = { login };
