const express = require('express');

const { create, preview, listMine, history, invoice } = require('../controllers/registration.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('parent'), listMine);
router.get('/preview', requireAuth, requireRole('parent'), preview);
// Payment history (docs/plans/payment-airtight-plan.md D10) — a literal
// route, registered here (before /:id/invoice) for the same reason /mine
// and /preview are: so /:id/invoice's `:id` param can never shadow or be
// shadowed by this literal path.
router.get('/history', requireAuth, requireRole('parent'), history);
router.post('/', requireAuth, requireRole('parent'), create);
// Registered after the literal routes above so /:id/invoice can never
// shadow or be shadowed by /mine, /preview, or /history (docs/plans/manual-
// charge-and-pdf-invoice-plan.md §2.4).
router.get('/:id/invoice', requireAuth, requireRole('parent', 'admin', 'superadmin'), invoice);

module.exports = router;
