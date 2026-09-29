const express = require('express');

const { state, signIn } = require('../controllers/kiosk.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

// The front-desk sign-in tablet (docs/plans/kiosk-signin-plan.md K2). These two
// routes are the ONLY ones the `kiosk` role can use; admins may use them too
// (testing, or as a fallback). Everything admin-side stays ADMIN_ROLES-only,
// so a kiosk login can never reach it.
const KIOSK_ROLES = ['kiosk', ...ADMIN_ROLES];

router.get('/state', requireAuth, requireRole(...KIOSK_ROLES), state);
router.post('/sign-in', requireAuth, requireRole(...KIOSK_ROLES), signIn);

module.exports = router;
