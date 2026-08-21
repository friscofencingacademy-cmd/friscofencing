const express = require('express');

const {
  create,
  listMine,
  listAll,
  remove,
  listPublic,
} = require('../controllers/privateClassSchedule.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

// Literal-path routes registered BEFORE any `/:id`-style route.
router.get('/public', listPublic);
router.get('/mine', requireAuth, requireRole('coach'), listMine);

router.post('/', requireAuth, requireRole('coach', 'admin', 'superadmin'), create);
router.get('/', requireAuth, requireRole('admin', 'superadmin'), listAll);
router.delete('/:id', requireAuth, requireRole('coach', 'admin', 'superadmin'), remove);

module.exports = router;
