const express = require('express');

const {
  create,
  listMine,
  listAll,
  cancel,
} = require('../controllers/privateClassEnrollment.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('parent'), listMine);

router.post('/', requireAuth, requireRole('parent'), create);
router.get('/', requireAuth, requireRole('admin', 'superadmin'), listAll);
router.post('/:id/cancel', requireAuth, requireRole('parent', 'admin', 'superadmin'), cancel);

module.exports = router;
