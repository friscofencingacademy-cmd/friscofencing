const PaymentMethod = require('../models/paymentMethod.model');
const { ensureCustomer } = require('./paymentCustomer.service');
const { getPaymentProvider } = require('../payments');
const { badRequestError } = require('../utils/errors');

// Saves (or replaces) the requesting parent's single card on file, with the
// ACTIVE payment provider. `paymentMethodToken` is what the browser's card
// form produced for that provider. One saved card per parent for MVP — an
// existing card on the SAME provider is detached before the doc is updated in
// place, so nothing orphaned is left attached to the provider customer. An
// existing card on a provider that is no longer active is simply overwritten:
// that provider is not the one this process can talk to, and its card is
// unusable here anyway (docs/plans/payment-provider-port-plan.md D7).
//
// A card declined at save time surfaces as the port's own 402 (plan D3) —
// some cards decline at attach itself, not only when charged.
async function savePaymentMethod({ paymentMethodToken }, requestingUser) {
  if (typeof paymentMethodToken !== 'string' || paymentMethodToken.trim() === '') {
    throw badRequestError('paymentMethodToken is required');
  }

  const provider = getPaymentProvider();
  const customerId = await ensureCustomer(requestingUser);
  const attached = await provider.attachPaymentMethod({ customerId, token: paymentMethodToken });

  const cardDetails = {
    provider: provider.name,
    providerPaymentMethodId: attached.id,
    cardBrand: attached.brand,
    cardLast4: attached.last4,
    cardExpMonth: attached.expMonth,
    cardExpYear: attached.expYear,
  };

  const existing = await PaymentMethod.findOne({ parentId: requestingUser._id });

  if (existing) {
    if (existing.provider === provider.name && existing.providerPaymentMethodId !== attached.id) {
      await provider.detachPaymentMethod({ paymentMethodId: existing.providerPaymentMethodId });
    }

    existing.set(cardDetails);
    await existing.save();

    return existing;
  }

  return PaymentMethod.create({
    parentId: requestingUser._id,
    ...cardDetails,
  });
}

// The parent's card on file with the ACTIVE provider, or null. A card saved
// with a provider that is no longer active cannot be charged here, so it reads
// as "no card on file" — every charge path already handles that (a 400 at
// registration/booking, `failed_no_payment_method` at renewal), and the parent
// is asked to add a card. The document is kept, never deleted, so switching
// back to that provider makes it usable again (plan D7).
async function getMine(parentId) {
  const doc = await PaymentMethod.findOne({ parentId });

  return doc && doc.provider === getPaymentProvider().name ? doc : null;
}

module.exports = { savePaymentMethod, getMine };
