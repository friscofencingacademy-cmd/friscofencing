const express = require('express');

const { create, preview, listMine } = require('../controllers/registration.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('parent'), listMine);
router.get('/preview', requireAuth, requireRole('parent'), preview);
router.post('/', requireAuth, requireRole('parent'), create);

module.exports = router;
