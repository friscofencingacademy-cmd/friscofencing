// Guarantees NO real Stripe data can ever survive a staging reseed —
// explicit, not incidental. Today's refreshStagingData() sequence already
// gets this for free: wipeDatabase() deletes every PaymentMethod document,
// and the legacy import creates brand-new User docs that never set
// stripeCustomerId (that field is only ever written by
// stripeCustomer.service.js when a parent actually saves a real card).
// Production has no real Stripe data yet, so nothing leaks today — but that
// guarantee is currently an ACCIDENT of "the only import source is a CSV
// file, never a live copy of production Mongo." The moment any future
// workflow clones/syncs production data into staging (even partially, even
// by mistake), a subtler import that doesn't start from a full wipe would
// carry real stripeCustomerId/PaymentMethod/stripePaymentIntentId values
// into a lower-trust environment. This function makes the scrub an
// explicit, standing step of the reseed sequence instead of relying on
// that accident holding forever.
//
// Idempotent and safe to run any time — a fresh reseed with nothing to
// scrub yet reports all-zero counts, which is the expected/healthy state.

const User = require('../../src/models/user.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
const Registration = require('../../src/models/registration.model');

async function scrubStripeFields() {
  const [userResult, paymentMethodResult, registrationResult] = await Promise.all([
    User.updateMany({ stripeCustomerId: { $ne: null } }, { $unset: { stripeCustomerId: '' } }),
    PaymentMethod.deleteMany({}),
    Registration.updateMany(
      { stripePaymentIntentId: { $ne: null } },
      { $set: { stripePaymentIntentId: null } }
    ),
  ]);

  return {
    stripeCustomerIdsCleared: userResult.modifiedCount,
    paymentMethodsDeleted: paymentMethodResult.deletedCount,
    stripePaymentIntentIdsCleared: registrationResult.modifiedCount,
  };
}

module.exports = { scrubStripeFields };
