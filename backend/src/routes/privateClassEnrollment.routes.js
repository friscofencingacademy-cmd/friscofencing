const express = require('express');

const {
  create,
  listMine,
  listAll,
  cancel,
} = require('../controllers/privateClassEnrollment.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('parent'), listMine);

router.post('/', requireAuth, requireRole('parent'), create);
router.get('/', requireAuth, requireRole(...ADMIN_ROLES), listAll);
router.post('/:id/cancel', requireAuth, requireRole('parent', ...ADMIN_ROLES), cancel);

module.exports = router;
