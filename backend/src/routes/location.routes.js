const express = require('express');

const {
  create,
  list,
  getById,
  update,
  remove,
  listPublic,
} = require('../controllers/location.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

// Literal-path route registered BEFORE `/:id` below.
router.get('/public', listPublic);
router.get('/', requireAuth, list);
router.get('/:id', requireAuth, getById);
router.post('/', requireAuth, requireRole(...ADMIN_ROLES), create);
router.put('/:id', requireAuth, requireRole(...ADMIN_ROLES), update);
router.delete('/:id', requireAuth, requireRole(...ADMIN_ROLES), remove);

module.exports = router;
