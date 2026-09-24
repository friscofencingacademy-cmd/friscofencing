const express = require('express');

const { quote, create, listMine, listAll } = require('../controllers/privateClassEnrollment.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.get('/quote', requireAuth, requireRole('parent'), quote);
router.get('/mine', requireAuth, requireRole('parent'), listMine);

router.post('/', requireAuth, requireRole('parent'), create);
router.get('/', requireAuth, requireRole(...ADMIN_ROLES), listAll);

module.exports = router;
