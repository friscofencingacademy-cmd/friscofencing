const express = require('express');

const { create, getById, getByStudent, update } = require('../controllers/evaluation.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

// admin/coach/superadmin only on every route — matches CKQ's actual
// enforced middleware exactly (its own route comments mention "Parent"
// access, but the real gate applied to every one of its routes is
// adminOrCoachOnly; followed the verified code, not the comment).
router.post('/', requireAuth, requireRole('coach', 'admin', 'superadmin'), create);
router.get('/student/:studentId', requireAuth, requireRole('coach', 'admin', 'superadmin'), getByStudent);
router.get('/:id', requireAuth, requireRole('coach', 'admin', 'superadmin'), getById);
router.put('/:id', requireAuth, requireRole('coach', 'admin', 'superadmin'), update);

module.exports = router;
