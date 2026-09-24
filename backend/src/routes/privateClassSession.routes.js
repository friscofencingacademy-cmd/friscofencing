const express = require('express');

const { book, listMine, listAll, markAttendance, cancel } = require('../controllers/privateClassSession.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('coach'), listMine);

router.post('/', requireAuth, requireRole('parent'), book);
router.get('/', requireAuth, requireRole(...ADMIN_ROLES), listAll);
router.patch('/:id/attendance', requireAuth, requireRole('coach', ...ADMIN_ROLES), markAttendance);
router.post('/:id/cancel', requireAuth, requireRole('parent', 'coach', ...ADMIN_ROLES), cancel);

module.exports = router;
