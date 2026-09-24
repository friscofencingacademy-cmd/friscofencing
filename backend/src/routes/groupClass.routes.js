const express = require('express');

const { create, list, getById, update, remove } = require('../controllers/groupClass.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.get('/', requireAuth, list);
router.get('/:id', requireAuth, getById);
router.post('/', requireAuth, requireRole(...ADMIN_ROLES), create);
router.put('/:id', requireAuth, requireRole(...ADMIN_ROLES), update);
router.delete('/:id', requireAuth, requireRole(...ADMIN_ROLES), remove);

module.exports = router;
