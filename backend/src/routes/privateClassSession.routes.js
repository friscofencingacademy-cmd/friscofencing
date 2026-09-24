const express = require('express');

const {
  listMine,
  markAttendance,
  retryCharge,
} = require('../controllers/privateClassSession.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('coach'), listMine);

router.patch(
  '/:id/attendance',
  requireAuth,
  requireRole('coach', ...ADMIN_ROLES),
  markAttendance
);
router.post(
  '/:id/retry-charge',
  requireAuth,
  requireRole('coach', ...ADMIN_ROLES),
  retryCharge
);

module.exports = router;
