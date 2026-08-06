// Falls back to a placeholder key when STRIPE_SECRET_KEY isn't set in env.
// Same bug class already fixed for JWT in config/passport.js
// (secretOrKeyProvider): the Stripe SDK's constructor throws synchronously
// on a falsy apiKey, which would break module load — and therefore every
// route, including /health — in any test process that requires app.js
// without STRIPE_SECRET_KEY set (i.e. every route test except this
// feature's own). The placeholder never causes a real problem: no network
// call happens at construction time, only when a Stripe method is actually
// invoked, and no other route touches Stripe.
module.exports = require('stripe')(
  process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_missing_stripe_secret_key'
);
