const express = require('express');

const { handle } = require('../controllers/webhooks.controller');

const router = express.Router();

// POST /api/v1/webhooks/:provider — no requireAuth/requireRole: the payment
// provider itself is the caller, authenticated by its signature (verified in
// the adapter, see webhooks.controller.js), not our JWT scheme. Only the
// active provider's :provider value is accepted. The raw-body middleware
// this route needs is applied in app.js at the mount point, ahead of the
// global express.json() call.
router.post('/:provider', handle);

module.exports = router;
