const express = require('express');

const {
  byScheduleId,
  byClassId,
  getById,
  markAttendance,
} = require('../controllers/groupClassSession.controller');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.get('/by-schedule/:scheduleId', requireAuth, byScheduleId);
router.get('/by-class/:classId', requireAuth, byClassId);
router.get('/:id', requireAuth, getById);
// No requireRole here (unlike other mutation routes) — the service does the
// fine-grained "admin OR this session's assigned coach" check and throws 403
// itself; a route-level role gate can't express "only if you're *this*
// session's coach", only "only if you're *a* coach".
router.patch('/:id/attendance', requireAuth, markAttendance);

module.exports = router;
