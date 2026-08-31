const subscriptionService = require('../services/subscription.service');
const { previewRenewal, chargeNow, recordManualPayment } = require('../services/renewal.service');

async function list(req, res) {
  try {
    const { status, q, page, limit } = req.query;
    const result = await subscriptionService.listAll({ status, q, page, limit });
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list subscriptions' });
  }
}

async function cancel(req, res) {
  try {
    const subscription = await subscriptionService.cancel(req.params.id, req.user);
    return res.status(200).json({ subscription });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to cancel subscription' });
  }
}

async function reactivate(req, res) {
  try {
    const subscription = await subscriptionService.reactivate(req.params.id, req.user);
    return res.status(200).json({ subscription });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to reactivate subscription' });
  }
}

async function changeSchedule(req, res) {
  try {
    const subscription = await subscriptionService.changeSchedule(req.params.id, req.body.newScheduleId);
    return res.status(200).json({ subscription });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to change schedule' });
  }
}

// Superadmin-only manual Charge button (docs/plans/manual-charge-and-pdf-
// invoice-plan.md). previewRenewal/chargeNow never throw for a billing
// STATE (not_found/inactive/no_price/skipped_*/failed_payment/etc. all come
// back as a 200 outcome object) — the try/catch here only guards against a
// genuine unexpected error (e.g. a real Stripe/DB failure), same posture as
// every other controller in this file.
async function chargePreview(req, res) {
  try {
    const preview = await previewRenewal(req.params.id);
    return res.status(200).json(preview);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to preview charge' });
  }
}

// `period` ('full' | 'prorated', docs/plans/payment-airtight-plan.md D4) —
// defaults to 'full' when omitted, matching chargeNow's own default.
async function charge(req, res) {
  try {
    const period = req.body && req.body.period === 'prorated' ? 'prorated' : 'full';
    const result = await chargeNow(req.params.id, { period, adminUser: req.user });
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to charge subscription' });
  }
}

// The manual/offline payment path (D5) — recordManualPayment never throws
// for a validation or billing STATE (invalid_amount/invalid_note/
// invalid_period/not_found/skipped_*/etc. all come back as a 200 outcome
// object), same posture as chargePreview/charge above.
async function recordPayment(req, res) {
  try {
    const { amount, note, period } = req.body || {};
    const result = await recordManualPayment(req.params.id, { amount, note, period }, req.user);
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to record payment' });
  }
}

module.exports = { list, cancel, reactivate, changeSchedule, chargePreview, charge, recordPayment };
