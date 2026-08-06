const express = require('express');

const { handle } = require('../controllers/stripeWebhook.controller');

const router = express.Router();

// No requireAuth/requireRole: Stripe itself is the caller, authenticated via
// signature verification (see stripeWebhook.controller.js), not our JWT
// scheme. The raw-body middleware this route needs is applied in app.js at
// the mount point, ahead of the global express.json() call.
router.post('/', handle);

module.exports = router;
