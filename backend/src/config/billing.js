// Billing-domain constants that aren't secrets/connections (unlike this
// directory's other files — db.js, passport.js, stripe.js) but also don't
// belong buried inside a service file. First occupant: the retry/dunning
// ceiling (docs/plans/registration-ledger-plan.md D6), matching CKQ's own
// config/payment.js MAX_PAYMENT_RETRIES value.
const MAX_PAYMENT_RETRIES = 3;

module.exports = { MAX_PAYMENT_RETRIES };
