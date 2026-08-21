const express = require('express');

const {
  listMine,
  markAttendance,
  retryCharge,
} = require('../controllers/privateClassSession.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('coach'), listMine);

router.patch(
  '/:id/attendance',
  requireAuth,
  requireRole('coach', 'admin', 'superadmin'),
  markAttendance
);
router.post(
  '/:id/retry-charge',
  requireAuth,
  requireRole('coach', 'admin', 'superadmin'),
  retryCharge
);

module.exports = router;
