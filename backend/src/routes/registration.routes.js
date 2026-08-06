const express = require('express');

const { create, listMine } = require('../controllers/registration.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('parent'), listMine);
router.post('/', requireAuth, requireRole('parent'), create);

module.exports = router;
