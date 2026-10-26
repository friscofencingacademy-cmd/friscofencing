const User = require('../models/user.model');
const { getPaymentProvider } = require('../payments');
const { notFoundError } = require('../utils/errors');

// Returns the ACTIVE payment provider's customer id for `user`, creating one
// (and persisting it with the provider's name) the first time this parent
// needs one on that provider.
//
// Reads the STORED state, never the caller's in-memory user object — a stale
// object (loaded before another request created the customer) would otherwise
// mint a second customer, and the parent's card and charges would land on
// different customers. The write is an atomic claim: if a concurrent request
// claimed a customer first, its id is returned and ours is left unused on the
// provider (harmless — no card is ever attached to it).
//
// A customer stored for a provider that is no longer active is not usable
// (customers never move between providers), so it is replaced with a fresh
// one on the active provider — docs/plans/payment-provider-port-plan.md D7.
async function ensureCustomer(user) {
  const provider = getPaymentProvider();
  const stored = await User.findById(user._id, 'paymentProvider providerCustomerId').lean();

  if (!stored) {
    throw notFoundError('User not found');
  }

  if (stored.paymentProvider === provider.name && stored.providerCustomerId) {
    return stored.providerCustomerId;
  }

  const customerId = await provider.createCustomer({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    userId: user._id.toString(),
  });

  const claimed = await User.findOneAndUpdate(
    {
      _id: user._id,
      $or: [{ paymentProvider: { $ne: provider.name } }, { providerCustomerId: { $exists: false } }],
    },
    { $set: { paymentProvider: provider.name, providerCustomerId: customerId } },
    { new: true, projection: { providerCustomerId: 1 } }
  ).lean();

  if (claimed) {
    return customerId;
  }

  const winner = await User.findById(user._id, 'providerCustomerId').lean();
  return winner.providerCustomerId;
}

module.exports = { ensureCustomer };
