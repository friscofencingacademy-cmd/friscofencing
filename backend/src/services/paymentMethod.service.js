const stripe = require('../config/stripe');
const PaymentMethod = require('../models/paymentMethod.model');
const { ensureStripeCustomer } = require('./stripeCustomer.service');

function paymentFailedError(message) {
  const error = new Error(message);
  error.status = 402;
  return error;
}

// Saves (or replaces) the requesting parent's single card on file. One
// saved card per parent for MVP — if they already have one, the old Stripe
// PaymentMethod is detached before the doc is updated in place, so we never
// leave an orphaned attached card sitting on the Stripe customer.
async function savePaymentMethod({ stripePaymentMethodId }, requestingUser) {
  const stripeCustomerId = await ensureStripeCustomer(requestingUser);

  let attached;

  try {
    attached = await stripe.paymentMethods.attach(stripePaymentMethodId, {
      customer: stripeCustomerId,
    });
  } catch (error) {
    // Found via the live audit (docs/plans/audit-system-plan.md's 2026-08-23
    // addendum): some Stripe test cards (e.g. the documented decline card,
    // 4000000000000002) decline at attach() itself, not only at charge time.
    // A hard decline is a synchronous throw from the Stripe SDK, not a
    // resolved object — same distinction registration.service.js's create()
    // and renewal.service.js's renewOne() already make for their own charge
    // calls. Without this catch, a declined card here surfaced as a raw 500
    // instead of the 402 every other payment-failure case in this codebase
    // uses.
    if (error.type === 'StripeCardError') {
      throw paymentFailedError(error.message);
    }

    throw error;
  }

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
