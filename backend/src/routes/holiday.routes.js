const express = require('express');

const { create, list, getById, update, remove } = require('../controllers/holiday.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

// Admin/superadmin only, on every route including list (D10) — coaches and
// parents never query holidays directly; they only see the effects through
// already-gated session endpoints (listUpcomingByClass, attendance, etc).
router.get('/', requireAuth, requireRole('admin', 'superadmin'), list);
router.get('/:id', requireAuth, requireRole('admin', 'superadmin'), getById);
router.post('/', requireAuth, requireRole('admin', 'superadmin'), create);
router.put('/:id', requireAuth, requireRole('admin', 'superadmin'), update);
router.delete('/:id', requireAuth, requireRole('admin', 'superadmin'), remove);

module.exports = router;
