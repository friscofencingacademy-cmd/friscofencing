// Fills the Stripe Elements CardElement on /parent/payment-method
// (frontend/app/parent/payment-method/page.tsx). CardElement renders one
// combined iframe (number/expiry/CVC as one field group), which is Stripe's
// documented default `card` element — the frame title below is Stripe's own
// stable selector for it.
//
// Verified against a real staging run (2026-08-23) — the frame/field
// selectors below are confirmed correct. One thing the original,
// pre-verification version of this helper got wrong, found on that run:
// frontend/app/parent/payment-method/page.tsx's <CardElement> uses Stripe's
// default options (no `hidePostalCode: true`), so the combined element
// includes a ZIP/postal field too — omitting it produced a real, legible
// "Your postal code is incomplete." validation error from Stripe itself,
// which surfaced as a save timeout downstream. Any 5-digit value satisfies
// Stripe's test-mode validation.
async function fillCardElement(page, { number, expiry = '12/34', cvc = '123', postal = '75034' }) {
  const stripeFrame = page.frameLocator('iframe[title="Secure card payment input frame"]');

  await stripeFrame.locator('[name="cardnumber"]').fill(number);
  await stripeFrame.locator('[name="exp-date"]').fill(expiry);
  await stripeFrame.locator('[name="cvc"]').fill(cvc);
  await stripeFrame.locator('[name="postal"]').fill(postal);
}

const STRIPE_TEST_CARDS = {
  success: '4242424242424242',
  decline: '4000000000000002',
};

module.exports = { fillCardElement, STRIPE_TEST_CARDS };
