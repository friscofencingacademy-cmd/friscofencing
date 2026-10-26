const { assertProviderContract, PROVIDER_NAMES } = require('./contract');
const stripeProvider = require('./stripe/stripe.provider');

// Payment provider selection (docs/decisions/013-payment-provider-port.md).
// Business and service code never imports an adapter directly — it calls
// getPaymentProvider() and uses the port (./contract.js). Exactly one
// provider is active per process, chosen by PAYMENT_PROVIDER (default
// 'stripe'); an unknown value throws on first use, so a typo in an
// environment fails the first payment loudly instead of silently.

const PROVIDERS = { stripe: stripeProvider };

let cachedProvider = null;

/** @returns {import('./contract').PaymentProvider} */
function getPaymentProvider() {
  if (cachedProvider) return cachedProvider;

  const providerName = process.env.PAYMENT_PROVIDER || 'stripe';
  const provider = PROVIDERS[providerName];

  if (!provider) {
    throw new Error(`[payments] unknown PAYMENT_PROVIDER: "${providerName}"`);
  }

  assertProviderContract(provider);

  // The selected adapter's name is what every ledger row, card and customer
  // records as its provider, so it must be the name it was selected by and
  // one the models' enums accept.
  if (provider.name !== providerName || !PROVIDER_NAMES.includes(provider.name)) {
    throw new Error(`[payments] adapter selected as "${providerName}" is named "${provider.name}"`);
  }

  cachedProvider = provider;
  return provider;
}

/** Test-only: clears the cached provider so a test can re-select via env changes. */
function _resetForTests() {
  cachedProvider = null;
}

module.exports = { getPaymentProvider, _resetForTests };
