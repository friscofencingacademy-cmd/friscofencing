const express = require('express');

const {
  create,
  list,
  mine,
  getById,
  update,
  remove,
  listPublic,
} = require('../controllers/groupClassSchedule.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.get('/', requireAuth, list);
// Literal-path routes registered BEFORE the /:id route below — otherwise
// Express would match "mine"/"public" as an :id param value instead of
// these dedicated routes.
router.get('/mine', requireAuth, requireRole('coach'), mine);
router.get('/public', listPublic);
router.get('/:id', requireAuth, getById);
router.post('/', requireAuth, requireRole(...ADMIN_ROLES), create);
router.put('/:id', requireAuth, requireRole(...ADMIN_ROLES), update);
router.delete('/:id', requireAuth, requireRole(...ADMIN_ROLES), remove);

module.exports = router;
