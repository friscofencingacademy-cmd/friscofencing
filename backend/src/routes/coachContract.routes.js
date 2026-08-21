const express = require('express');

const { create, list, deactivate } = require('../controllers/coachContract.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.post('/', requireAuth, requireRole('admin', 'superadmin'), create);
router.get('/', requireAuth, requireRole('admin', 'superadmin'), list);
router.post('/:id/deactivate', requireAuth, requireRole('admin', 'superadmin'), deactivate);

module.exports = router;
