const express = require('express');

const { listPublic, listMine, listAll } = require('../controllers/calendar.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

// docs/plans/calendar-view-plan.md §1.5.
router.get('/public', listPublic);
router.get('/mine', requireAuth, requireRole('parent'), listMine);
router.get('/', requireAuth, requireRole(...ADMIN_ROLES), listAll);

module.exports = router;
