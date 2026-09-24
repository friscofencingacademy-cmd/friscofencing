const express = require('express');

const { create, listMine } = require('../controllers/student.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('parent'), listMine);
router.post('/', requireAuth, requireRole('parent', ...ADMIN_ROLES), create);

module.exports = router;
