const express = require('express');

const { create, list, getById } = require('../controllers/auditRun.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

// Superadmin-only — this surfaces real payment/Stripe-test-run data (see
// docs/plans/audit-system-plan.md, D6). No admin/coach/parent access.
router.post('/', requireAuth, requireRole('superadmin'), create);
router.get('/', requireAuth, requireRole('superadmin'), list);
router.get('/:id', requireAuth, requireRole('superadmin'), getById);

module.exports = router;
