const express = require('express');

const { login, register, me, logout } = require('../controllers/auth.controller');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

// Public — the first unauthenticated entry point in this app (parent
// self-signup). No requireAuth.
router.post('/register', register);
router.post('/login', login);
router.get('/me', requireAuth, me);
router.post('/logout', logout);

module.exports = router;
