const express = require('express');

const { create, list, update, updatePassword, remove } = require('../controllers/user.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin', 'superadmin'), list);
router.post('/', requireAuth, requireRole('admin', 'superadmin'), create);
router.put('/:id', requireAuth, requireRole('admin', 'superadmin'), update);
router.put('/:id/password', requireAuth, requireRole('admin', 'superadmin'), updatePassword);
router.delete('/:id', requireAuth, requireRole('admin', 'superadmin'), remove);

module.exports = router;
