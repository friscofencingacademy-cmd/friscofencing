const express = require('express');

const { create, list, deactivate, updatePacks, quotePacks } = require('../controllers/coachContract.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.post('/', requireAuth, requireRole(...ADMIN_ROLES), create);
router.get('/', requireAuth, requireRole(...ADMIN_ROLES), list);
// Declared before any '/:id' route so 'pack-quotes' is never read as an id.
router.post('/pack-quotes', requireAuth, requireRole(...ADMIN_ROLES), quotePacks);
router.post('/:id/deactivate', requireAuth, requireRole(...ADMIN_ROLES), deactivate);
router.put('/:id/packs', requireAuth, requireRole(...ADMIN_ROLES), updatePacks);

module.exports = router;
