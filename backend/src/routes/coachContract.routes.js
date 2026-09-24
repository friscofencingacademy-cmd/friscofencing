const express = require('express');

const { create, list, deactivate } = require('../controllers/coachContract.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.post('/', requireAuth, requireRole(...ADMIN_ROLES), create);
router.get('/', requireAuth, requireRole(...ADMIN_ROLES), list);
router.post('/:id/deactivate', requireAuth, requireRole(...ADMIN_ROLES), deactivate);

module.exports = router;
