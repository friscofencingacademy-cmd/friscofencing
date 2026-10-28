const express = require('express');

const { create, listMine, reschedule, cancel } = require('../controllers/trialClass.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('parent'), listMine);
router.post('/', requireAuth, requireRole('parent', ...ADMIN_ROLES), create);
// docs/plans/trial-cancel-reschedule-plan.md — a parent may change only their
// own child's trial (the service checks ownership); an admin may change any.
router.patch('/:id', requireAuth, requireRole('parent', ...ADMIN_ROLES), reschedule);
router.delete('/:id', requireAuth, requireRole('parent', ...ADMIN_ROLES), cancel);

module.exports = router;
