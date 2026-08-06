const express = require('express');

const { create, list, getById, update, remove } = require('../controllers/level.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/', requireAuth, list);
router.get('/:id', requireAuth, getById);
router.post('/', requireAuth, requireRole('admin', 'superadmin'), create);
router.put('/:id', requireAuth, requireRole('admin', 'superadmin'), update);
router.delete('/:id', requireAuth, requireRole('admin', 'superadmin'), remove);

module.exports = router;
