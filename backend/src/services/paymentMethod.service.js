const stripe = require('../config/stripe');
const PaymentMethod = require('../models/paymentMethod.model');
const { ensureStripeCustomer } = require('./stripeCustomer.service');

// Saves (or replaces) the requesting parent's single card on file. One
// saved card per parent for MVP — if they already have one, the old Stripe
// PaymentMethod is detached before the doc is updated in place, so we never
// leave an orphaned attached card sitting on the Stripe customer.
async function savePaymentMethod({ stripePaymentMethodId }, requestingUser) {
  const stripeCustomerId = await ensureStripeCustomer(requestingUser);

  const attached = await stripe.paymentMethods.attach(stripePaymentMethodId, {
    customer: stripeCustomerId,
  });

  const cardDetails = {
    stripePaymentMethodId: attached.id,
    cardBrand: attached.card.brand,
    cardLast4: attached.card.last4,
    cardExpMonth: attached.card.exp_month,
    cardExpYear: attached.card.exp_year,
  };

  const existing = await PaymentMethod.findOne({ parentId: requestingUser._id });

  if (existing) {
    if (existing.stripePaymentMethodId !== attached.id) {
      await stripe.paymentMethods.detach(existing.stripePaymentMethodId);
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
