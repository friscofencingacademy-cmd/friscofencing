const express = require('express');

const { byScheduleId, getById } = require('../controllers/groupClassSession.controller');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.get('/by-schedule/:scheduleId', requireAuth, byScheduleId);
router.get('/:id', requireAuth, getById);

module.exports = router;
