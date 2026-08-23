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

const router = express.Router();

router.get('/', requireAuth, list);
// Literal-path routes registered BEFORE the /:id route below — otherwise
// Express would match "mine"/"public" as an :id param value instead of
// these dedicated routes.
router.get('/mine', requireAuth, requireRole('coach'), mine);
router.get('/public', listPublic);
router.get('/:id', requireAuth, getById);
router.post('/', requireAuth, requireRole('admin', 'superadmin'), create);
router.put('/:id', requireAuth, requireRole('admin', 'superadmin'), update);
router.delete('/:id', requireAuth, requireRole('admin', 'superadmin'), remove);

module.exports = router;
