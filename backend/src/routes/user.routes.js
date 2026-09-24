const express = require('express');

const { create, list, update, updatePassword, remove } = require('../controllers/user.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.get('/', requireAuth, requireRole(...ADMIN_ROLES), list);
router.post('/', requireAuth, requireRole(...ADMIN_ROLES), create);
router.put('/:id', requireAuth, requireRole(...ADMIN_ROLES), update);
router.put('/:id/password', requireAuth, requireRole(...ADMIN_ROLES), updatePassword);
router.delete('/:id', requireAuth, requireRole(...ADMIN_ROLES), remove);

module.exports = router;
