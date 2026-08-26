const express = require('express');

const { get, update } = require('../controllers/setting.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

// Superadmin-only — same bar as /audit-runs (docs/plans/audit-system-plan.md,
// D6). These values change the charge on every future registration
// immediately, with no confirmation step, so this is a stricter gate than a
// regular admin's Price/Level CRUD.
router.get('/', requireAuth, requireRole('superadmin'), get);
router.patch('/', requireAuth, requireRole('superadmin'), update);

module.exports = router;
