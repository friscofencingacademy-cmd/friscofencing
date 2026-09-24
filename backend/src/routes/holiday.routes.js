const express = require('express');

const { create, list, getById, update, remove } = require('../controllers/holiday.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

// Admin/superadmin only, on every route including list (D10) — coaches and
// parents never query holidays directly; they only see the effects through
// already-gated session endpoints (listUpcomingByClass, attendance, etc).
router.get('/', requireAuth, requireRole(...ADMIN_ROLES), list);
router.get('/:id', requireAuth, requireRole(...ADMIN_ROLES), getById);
router.post('/', requireAuth, requireRole(...ADMIN_ROLES), create);
router.put('/:id', requireAuth, requireRole(...ADMIN_ROLES), update);
router.delete('/:id', requireAuth, requireRole(...ADMIN_ROLES), remove);

module.exports = router;
