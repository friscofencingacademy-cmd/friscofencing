const express = require('express');

const {
  byScheduleId,
  byClassId,
  getById,
  markAttendance,
  getEligibleStudents,
  addStudent,
  removeStudent,
} = require('../controllers/groupClassSession.controller');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.get('/by-schedule/:scheduleId', requireAuth, byScheduleId);
router.get('/by-class/:classId', requireAuth, byClassId);
router.get('/:id', requireAuth, getById);
// No requireRole on any mutation below (unlike other routes) — the service
// does the fine-grained "admin OR this session's assigned coach" check and
// throws 403 itself; a route-level role gate can't express "only if you're
// *this* session's coach", only "only if you're *a* coach".
router.patch('/:id/attendance', requireAuth, markAttendance);
router.get('/:id/eligible-students', requireAuth, getEligibleStudents);
router.post('/:id/students', requireAuth, addStudent);
router.delete('/:id/students/:studentId', requireAuth, removeStudent);

module.exports = router;
