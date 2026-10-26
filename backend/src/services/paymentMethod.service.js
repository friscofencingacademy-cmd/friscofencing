const PaymentMethod = require('../models/paymentMethod.model');
const { ensureCustomer } = require('./paymentCustomer.service');
const { getPaymentProvider } = require('../payments');

// Saves (or replaces) the requesting parent's single card on file. One saved
// card per parent for MVP — if they already have one, the old provider card
// is detached before the doc is updated in place, so we never leave an
// orphaned card attached to the provider customer. A card declined at save
// time surfaces as the port's own 402 (docs/plans/payment-provider-port-plan.md
// D3): some cards decline at attach itself, not only when charged.
async function savePaymentMethod({ stripePaymentMethodId }, requestingUser) {
  const provider = getPaymentProvider();
  const customerId = await ensureCustomer(requestingUser);
  const attached = await provider.attachPaymentMethod({ customerId, token: stripePaymentMethodId });

  const cardDetails = {
    stripePaymentMethodId: attached.id,
    cardBrand: attached.brand,
    cardLast4: attached.last4,
    cardExpMonth: attached.expMonth,
    cardExpYear: attached.expYear,
  };

  const existing = await PaymentMethod.findOne({ parentId: requestingUser._id });

  if (existing) {
    if (existing.stripePaymentMethodId !== attached.id) {
      await provider.detachPaymentMethod({ paymentMethodId: existing.stripePaymentMethodId });
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

async function getMine(parentId) {
  return PaymentMethod.findOne({ parentId });
}

module.exports = { savePaymentMethod, getMine };
