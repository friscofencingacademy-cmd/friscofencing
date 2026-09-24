const express = require('express');

const { create, getById, getByStudent, update } = require('../controllers/evaluation.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

// admin/coach/superadmin only on every route — matches CKQ's actual
// enforced middleware exactly (its own route comments mention "Parent"
// access, but the real gate applied to every one of its routes is
// adminOrCoachOnly; followed the verified code, not the comment).
router.post('/', requireAuth, requireRole('coach', ...ADMIN_ROLES), create);
router.get('/student/:studentId', requireAuth, requireRole('coach', ...ADMIN_ROLES), getByStudent);
router.get('/:id', requireAuth, requireRole('coach', ...ADMIN_ROLES), getById);
router.put('/:id', requireAuth, requireRole('coach', ...ADMIN_ROLES), update);

module.exports = router;
