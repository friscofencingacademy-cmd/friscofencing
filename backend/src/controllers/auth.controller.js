const authService = require('../services/auth.service');

const COOKIE_NAME = 'accessToken';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches default JWT_EXPIRES_IN

async function login(req, res) {
  try {
    const { email, password } = req.body;
    const { token, user } = await authService.login({ email, password });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      // TODO: must become `true` once this runs over HTTPS (production).
      secure: false,
      maxAge: COOKIE_MAX_AGE_MS,
    });

    return res.status(200).json({ user });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Login failed' });
  }
}

async function register(req, res) {
  try {
    const { firstName, lastName, email, password } = req.body;
    const { token, user } = await authService.register({ firstName, lastName, email, password });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      // TODO: must become `true` once this runs over HTTPS (production).
      secure: false,
      maxAge: COOKIE_MAX_AGE_MS,
    });

    return res.status(201).json({ user });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Registration failed' });
  }
}

function me(req, res) {
  return res.status(200).json({ user: req.user });
}

function logout(req, res) {
  res.clearCookie(COOKIE_NAME);
  return res.status(200).json({ success: true });
}

module.exports = { login, register, me, logout };
