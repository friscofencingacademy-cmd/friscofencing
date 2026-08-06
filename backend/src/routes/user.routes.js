const express = require('express');

const { list } = require('../controllers/user.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin', 'superadmin'), list);

module.exports = router;
