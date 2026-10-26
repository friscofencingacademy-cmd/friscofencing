// Payment provider port — the requirement list for any payment provider
// adapter (docs/decisions/013-payment-provider-port.md). Business code never
// imports an adapter or an SDK: it calls getPaymentProvider() (./index.js)
// and uses only the members below. Copied from CKQ's src/payments/contract.js
// (ADR backend-021) and reduced to the members this codebase actually calls;
// a member is added in the PR that adds its first caller, never before
// (docs/plans/payment-provider-port-plan.md D2).
//
// Amounts are DOLLARS at this boundary; each adapter converts to its
// provider's minor unit. `raw` on any result is the provider's own object,
// for logging and repair only — business code never reads it.

/**
 * @typedef {Object} ChargeRequest
 * @property {number} amount            dollars
 * @property {string} customerId        the provider customer id stored for this parent
 * @property {string} paymentMethodId   the provider's saved-card id stored for this parent
 * @property {string} idempotencyKey    `payment_<registrationId>` or `payment_<registrationId>_retry<n>` (≤ 45 chars)
 * @property {string} reference         our Registration row id (≤ 40 chars)
 * @property {Object<string, string>} metadata   flat string map stored with the payment
 */

/**
 * @typedef {Object} ChargeResult
 * @property {string|null} id           provider payment id (null only when a decline produced no payment object)
 * @property {'succeeded'|'processing'|'requires_action'|'failed'} status
 * @property {string|null} failureMessage   set whenever status !== 'succeeded' — the exact text stored on the ledger row
 * @property {Object} raw
 */

/**
 * @typedef {Object} CustomerInput
 * @property {string} email
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} userId
 */

/**
 * @typedef {Object} AttachedCard
 * @property {string} id
 * @property {string} brand   lowercase, as the provider reports it (e.g. 'visa')
 * @property {string} last4
 * @property {number} expMonth
 * @property {number} expYear
 */

/**
 * @typedef {Object} FoundPayment
 * @property {string} id
 * @property {'succeeded'|'processing'|'requires_action'|'failed'} status
 * @property {number} amount   dollars
 * @property {Object} raw
 */

/**
 * @typedef {Object} NormalizedWebhookEvent
 * @property {string} eventId
 * @property {'payment.succeeded'|'payment.failed'|'ignored'} type
 * @property {string|null} paymentId
 * @property {string|null} providerStatus      the payment's raw provider status, for the audit row
 * @property {string} providerEventType         the raw provider event type, for the audit row
 * @property {Object} raw
 */

/**
 * @typedef {Object} PaymentProvider
 * @property {string} name   'stripe' | 'square'
 * @property {{ savedPaymentMethods: boolean, webhooks: boolean, findByReference: boolean }} capabilities
 *   findByReference — whether findPayment({ reference }) can look a payment up by our
 *   Registration id. When false, it returns null and callers fall back to the
 *   recorded payment id or an idempotent replay (plan D4).
 * @property {(req: ChargeRequest) => Promise<ChargeResult>} charge
 *   Never throws for a card-level failure: it resolves status 'failed' with the
 *   provider's message. Infrastructure errors are re-thrown unchanged.
 * @property {(input: CustomerInput) => Promise<string>} createCustomer   returns the provider customer id
 * @property {(args: { customerId: string, token: string }) => Promise<AttachedCard>} attachPaymentMethod
 *   Throws httpError(402, providerMessage) for a card-level failure.
 * @property {(args: { paymentMethodId: string }) => Promise<void>} detachPaymentMethod
 * @property {(query: { paymentId?: string, reference?: string }) => Promise<FoundPayment|null>} findPayment
 *   By paymentId: null when no such payment. By reference: the SUCCEEDED payment
 *   for that reference, or null (always null when !capabilities.findByReference).
 * @property {(args: { rawBody: Buffer, headers: Object }) => Promise<NormalizedWebhookEvent>} verifyWebhook
 *   Throws httpError(400, `Webhook signature verification failed: <reason>`) on a bad or missing signature.
 */

// Every provider an adapter exists or is planned for — the ONE list the
// models' `provider` enums read (a model must never require ./index.js, which
// would load provider SDKs). A provider's `name` is always one of these.
const PROVIDER_NAMES = ['stripe', 'square'];

const REQUIRED_MEMBERS = [
  'name',
  'capabilities',
  'charge',
  'createCustomer',
  'attachPaymentMethod',
  'detachPaymentMethod',
  'findPayment',
  'verifyWebhook',
];

/**
 * Throws if `adapter` does not implement every required member, naming all of
 * the missing ones at once.
 * @param {Object} adapter
 */
function assertProviderContract(adapter) {
  const missing = REQUIRED_MEMBERS.filter((member) => adapter == null || adapter[member] == null);

  if (missing.length > 0) {
    throw new Error(`[payments] provider adapter is missing required member(s): ${missing.join(', ')}`);
  }
}

module.exports = { assertProviderContract, REQUIRED_MEMBERS, PROVIDER_NAMES };
