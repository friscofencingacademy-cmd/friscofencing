const WebhookEvent = require('../models/webhookEvent.model');
const { getPaymentProvider } = require('../payments');
const { notFoundError } = require('../utils/errors');

// Handles incoming webhook deliveries from the ACTIVE payment provider
// (docs/plans/payment-provider-port-plan.md D5). Requires the raw (unparsed)
// request body — see app.js, where this router is mounted with its own
// express.raw() middleware ahead of the global express.json() call, so the
// provider's signature verification sees the exact bytes it signed.
//
// Only the active provider's URL is live: a delivery for any other
// `:provider` is a 404, so a stale registration in an old provider's
// dashboard can never write anything here.
//
// Deliberately narrow: records only payment succeeded / failed events,
// deduped by the provider's own event id. Full reconciliation against
// Registration/Subscription state is out of scope — every charge in this
// codebase is synchronous (off-session, confirmed), so this is a safety net
// for a narrow crash-recovery window, not something the core flow depends on.
async function handle(req, res, next) {
  const provider = getPaymentProvider();

  if (req.params.provider !== provider.name) {
    return next(notFoundError('No webhook endpoint for this payment provider'));
  }

  let event;

  try {
    event = await provider.verifyWebhook({ rawBody: req.body, headers: req.headers });
  } catch (error) {
    // The adapter's own 400 (bad or missing signature) — nothing was stored.
    return next(error);
  }

  try {
    const existing = await WebhookEvent.findOne({ provider: provider.name, providerEventId: event.eventId });

    if (existing) {
      // Providers redeliver events (at-least-once); a redelivery is a safe no-op.
      return res.status(200).json({ received: true });
    }

    if (event.type !== 'ignored') {
      await WebhookEvent.create({
        provider: provider.name,
        providerEventId: event.eventId,
        type: event.providerEventType,
        providerPaymentId: event.paymentId,
        status: event.providerStatus,
      });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    // Signature verification already succeeded, so a 5xx here is safe: the
    // provider retries delivery, and the dedup check above makes a
    // successful retry idempotent.
    return next(error);
  }
}

module.exports = { handle };
