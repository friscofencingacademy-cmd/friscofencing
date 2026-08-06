const express = require('express');

const { save, getMine } = require('../controllers/paymentMethod.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('parent'), getMine);
router.post('/', requireAuth, requireRole('parent'), save);

module.exports = router;
