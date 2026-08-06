const stripe = require('../config/stripe');
const User = require('../models/user.model');

// Returns the Stripe Customer id for `user`, creating one on Stripe (and
// persisting it) the first time this parent ever needs one. Idempotent per
// user — a user who already has stripeCustomerId set never hits Stripe.
async function ensureStripeCustomer(user) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: `${user.firstName} ${user.lastName}`,
    metadata: { userId: user._id.toString() },
  });

  await User.findByIdAndUpdate(user._id, { stripeCustomerId: customer.id });

  return customer.id;
}

module.exports = { ensureStripeCustomer };
