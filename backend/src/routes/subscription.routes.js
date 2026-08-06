const express = require('express');

const { cancel } = require('../controllers/subscription.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.post('/:id/cancel', requireAuth, requireRole('parent', 'admin', 'superadmin'), cancel);

module.exports = router;
