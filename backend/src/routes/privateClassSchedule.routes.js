const express = require('express');

const {
  create,
  listMine,
  listAll,
  remove,
  listPublic,
  listAvailableDates,
} = require('../controllers/privateClassSchedule.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

// Literal-path routes registered BEFORE any `/:id`-style route.
router.get('/public', listPublic);
router.get('/mine', requireAuth, requireRole('coach'), listMine);

router.post('/', requireAuth, requireRole('coach', ...ADMIN_ROLES), create);
router.get('/', requireAuth, requireRole(...ADMIN_ROLES), listAll);
// Public: bookable dates only, never who booked them.
router.get('/:id/available-dates', listAvailableDates);
router.delete('/:id', requireAuth, requireRole('coach', ...ADMIN_ROLES), remove);

module.exports = router;
