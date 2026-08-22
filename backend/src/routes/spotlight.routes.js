const express = require('express');

const {
  create,
  list,
  getById,
  update,
  remove,
  listPublic,
} = require('../controllers/spotlight.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

// Literal-path route registered BEFORE `/:id` below.
router.get('/public', listPublic);
router.get('/', requireAuth, requireRole('admin', 'superadmin'), list);
router.get('/:id', requireAuth, requireRole('admin', 'superadmin'), getById);
router.post('/', requireAuth, requireRole('admin', 'superadmin'), create);
router.put('/:id', requireAuth, requireRole('admin', 'superadmin'), update);
router.delete('/:id', requireAuth, requireRole('admin', 'superadmin'), remove);

module.exports = router;
