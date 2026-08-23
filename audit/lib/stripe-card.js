// Fills the Stripe Elements CardElement on /parent/payment-method
// (frontend/app/parent/payment-method/page.tsx). CardElement renders one
// combined iframe (number/expiry/CVC as one field group), which is Stripe's
// documented default `card` element — the frame title below is Stripe's own
// stable selector for it.
//
// UNVERIFIED AGAINST A REAL RUN (flagged, not hidden): this is the standard
// Playwright+Stripe.js pattern, but Stripe Elements' internal DOM has
// changed across versions before. If the frame/field selectors below don't
// match on the first real run, inspect the live iframe (`page.frames()`,
// or run headed via AUDIT_HEADED=true) and correct here — this is the one
// piece of this script that couldn't be confirmed without actually driving
// a live Stripe Elements instance.
async function fillCardElement(page, { number, expiry = '12/34', cvc = '123' }) {
  const stripeFrame = page.frameLocator('iframe[title="Secure card payment input frame"]');

  await stripeFrame.locator('[name="cardnumber"]').fill(number);
  await stripeFrame.locator('[name="exp-date"]').fill(expiry);
  await stripeFrame.locator('[name="cvc"]').fill(cvc);
}

const STRIPE_TEST_CARDS = {
  success: '4242424242424242',
  decline: '4000000000000002',
};

module.exports = { fillCardElement, STRIPE_TEST_CARDS };
