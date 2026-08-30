const express = require('express');

const { create, preview, listMine, invoice } = require('../controllers/registration.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('parent'), listMine);
router.get('/preview', requireAuth, requireRole('parent'), preview);
router.post('/', requireAuth, requireRole('parent'), create);
// Registered after the literal routes above so /:id/invoice can never
// shadow or be shadowed by /mine or /preview (docs/plans/manual-charge-
// and-pdf-invoice-plan.md §2.4).
router.get('/:id/invoice', requireAuth, requireRole('parent', 'admin', 'superadmin'), invoice);

module.exports = router;
