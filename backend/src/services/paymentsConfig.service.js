const { getPaymentProvider } = require('../payments');

// What the browser needs to collect a card with the ACTIVE payment provider
// (docs/plans/payment-provider-port-plan.md D10): the provider's name and its
// public configuration, from the adapter itself — this service knows nothing
// provider-specific. The backend is the one source of which provider is
// active, so the frontend build needs no provider key at all.
//
// A provider selected without its public configuration throws (a deployment
// defect, answered as the generic 500 and logged), so the card form shows a
// load error instead of silently rendering against the wrong account.
function getPublicConfig() {
  const provider = getPaymentProvider();

  return { provider: provider.name, [provider.name]: provider.publicConfig() };
}

module.exports = { getPublicConfig };
