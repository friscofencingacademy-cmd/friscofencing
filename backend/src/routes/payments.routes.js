const express = require('express');

const { getConfig } = require('../controllers/payments.controller');

const router = express.Router();

// GET /api/v1/payments/config — public, no auth: the card form needs it before
// a parent saves a card, and it holds only public identifiers (never a secret).
router.get('/config', getConfig);

module.exports = router;
