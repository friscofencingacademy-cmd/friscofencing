const express = require('express');

const { list, cancel, reactivate, changeSchedule } = require('../controllers/subscription.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin', 'superadmin'), list);
router.post('/:id/cancel', requireAuth, requireRole('parent', 'admin', 'superadmin'), cancel);
router.post('/:id/reactivate', requireAuth, requireRole('parent', 'admin', 'superadmin'), reactivate);
router.patch('/:id/schedule', requireAuth, requireRole('admin', 'superadmin'), changeSchedule);

module.exports = router;
