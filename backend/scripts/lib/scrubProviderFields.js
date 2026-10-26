// Guarantees NO real payment-provider data can ever survive a staging
// reseed — explicit, not incidental. Today's refreshStagingData() sequence
// already gets this for free: wipeDatabase() deletes every PaymentMethod
// document, and the legacy import creates brand-new User docs that never set
// a provider customer (that field is only ever written by
// paymentCustomer.service.js when a parent actually saves a real card).
// Production has no real payment data yet, so nothing leaks today — but that
// guarantee is currently an ACCIDENT of "the only import source is a CSV
// file, never a live copy of production Mongo." The moment any future
// workflow clones/syncs production data into staging (even partially, even
// by mistake), a subtler import that doesn't start from a full wipe would
// carry real provider customer / card / payment ids into a lower-trust
// environment. This function makes the scrub an explicit, standing step of
// the reseed sequence instead of relying on that accident holding forever.
//
// Provider-neutral since the payment provider port
// (docs/decisions/013-payment-provider-port.md): it clears every provider's
// ids, whichever provider(s) wrote them.
//
// Idempotent and safe to run any time — a fresh reseed with nothing to
// scrub yet reports all-zero counts, which is the expected/healthy state.

const User = require('../../src/models/user.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
const Registration = require('../../src/models/registration.model');

async function scrubProviderFields() {
  const [userResult, paymentMethodResult, registrationResult] = await Promise.all([
    User.updateMany(
      { $or: [{ providerCustomerId: { $exists: true } }, { paymentProvider: { $exists: true } }] },
      { $unset: { providerCustomerId: '', paymentProvider: '' } }
    ),
    PaymentMethod.deleteMany({}),
    Registration.updateMany(
      { $or: [{ providerPaymentId: { $ne: null } }, { provider: { $ne: null } }] },
      { $set: { providerPaymentId: null, provider: null } }
    ),
  ]);

  return {
    providerCustomerIdsCleared: userResult.modifiedCount,
    paymentMethodsDeleted: paymentMethodResult.deletedCount,
    providerPaymentIdsCleared: registrationResult.modifiedCount,
  };
}

module.exports = { scrubProviderFields };
