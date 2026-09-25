const express = require('express');

const { create, list, deactivate, revise, preview } = require('../controllers/coachContract.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.post('/', requireAuth, requireRole(...ADMIN_ROLES), create);
router.get('/', requireAuth, requireRole(...ADMIN_ROLES), list);
// Declared before any '/:id' route so 'preview' is never read as an id.
router.post('/preview', requireAuth, requireRole(...ADMIN_ROLES), preview);
router.post('/:id/revisions', requireAuth, requireRole(...ADMIN_ROLES), revise);
router.post('/:id/deactivate', requireAuth, requireRole(...ADMIN_ROLES), deactivate);

module.exports = router;
