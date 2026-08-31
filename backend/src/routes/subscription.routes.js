const express = require('express');

const {
  list,
  cancel,
  reactivate,
  changeSchedule,
  chargePreview,
  charge,
  recordPayment,
} = require('../controllers/subscription.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin', 'superadmin'), list);
router.post('/:id/cancel', requireAuth, requireRole('parent', 'admin', 'superadmin'), cancel);
router.post('/:id/reactivate', requireAuth, requireRole('parent', 'admin', 'superadmin'), reactivate);
router.patch('/:id/schedule', requireAuth, requireRole('admin', 'superadmin'), changeSchedule);
// Manual Charge button (docs/plans/manual-charge-and-pdf-invoice-plan.md) —
// superadmin only, since this triggers a real charge with no confirmation
// step beyond the dialog itself, same sensitivity class as /admin/settings.
router.get('/:id/charge-preview', requireAuth, requireRole('superadmin'), chargePreview);
router.post('/:id/charge', requireAuth, requireRole('superadmin'), charge);
// Manual/offline payment recording (docs/plans/payment-airtight-plan.md
// D5) — same sensitivity class and role gate as the card Charge action.
router.post('/:id/record-payment', requireAuth, requireRole('superadmin'), recordPayment);

module.exports = router;
