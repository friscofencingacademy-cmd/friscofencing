const User = require('../models/user.model');
const { getPaymentProvider } = require('../payments');

// Returns the active payment provider's customer id for `user`, creating one
// (and persisting it) the first time this parent ever needs one. Idempotent
// per user — a user who already has one never hits the provider.
async function ensureCustomer(user) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customerId = await getPaymentProvider().createCustomer({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    userId: user._id.toString(),
  });

  await User.findByIdAndUpdate(user._id, { stripeCustomerId: customerId });

  return customerId;
}

module.exports = { ensureCustomer };
