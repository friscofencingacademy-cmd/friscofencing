const { login } = require('../lib/login');
const { fillCardElement, STRIPE_TEST_CARDS } = require('../lib/stripe-card');

// S4 — decline path.
//
// Corrected on the first real run against staging, not assumed: the
// original design (and this file's original comment) claimed Stripe's
// decline card saves successfully and only fails at charge time, reasoning
// from paymentMethod.service.js having no SetupIntent/confirm step. That
// reasoning was wrong — confirmed live, Stripe's documented decline card
// (4000000000000002) actually declines at stripe.paymentMethods.attach()
// itself. POST /payment-methods returns 500 with message "Your card was
// declined." (a real, if architecturally sloppy, finding on its own: a
// card decline is an expected user-facing outcome, and 500 is normally
// reserved for "our server broke" — registration.service.js's own decline
// path correctly uses 402 for the same kind of failure. Not fixed here —
// this is the audit surfacing it, not silently patching app behavior).
// Expects a clean, legible message (never a raw Stripe/JS error or a raw
// 500 page) and no false "card on file" success.
async function run(context, config) {
  const page = await context.newPage();

  try {
    await login(page, config.stagingUrl, 'audit-decline-parent@example.com', config.testPassword);

    await page.goto(`${config.stagingUrl}/parent/payment-method`);
    const alreadyOnFile = await page.getByText(/card on file/i).isVisible().catch(() => false);

    if (alreadyOnFile) {
      return {
        id: 'S4',
        name: 'Decline path (clean failure)',
        result: 'skip',
        note: 'A payment method is already on file for this account — run `npm run audit:reset` (then `audit:seed`) first for a clean decline test.',
      };
    }

    await fillCardElement(page, { number: STRIPE_TEST_CARDS.decline });
    await page.getByRole('button', { name: /save card/i }).click();

    // Found on the first real run against staging, not assumed: this page
    // has TWO role="alert" elements (this one's Alert plus an unrelated,
    // always-empty one elsewhere in the portal shell). page.getByRole
    // ('alert') is ambiguous between them and can resolve to the empty one.
    // Filter to the one that actually has text.
    const alertWithText = page.getByRole('alert').filter({ hasNotText: /^$/ });
    await alertWithText.first().waitFor({ timeout: 20000 });
    const alertText = (await alertWithText.first().textContent()) || '';

    const looksRaw = /stripe|typeerror|undefined|\[object|internal server error/i.test(alertText);
    const sawSaved = await page.getByText(/card on file/i).isVisible().catch(() => false);

    if (sawSaved) {
      throw new Error('False success: a card appears saved despite using a Stripe decline test card');
    }
    if (looksRaw || !alertText.trim()) {
      throw new Error(`Decline message not clean/legible: "${alertText}"`);
    }

    return { id: 'S4', name: 'Decline path (clean failure)', result: 'pass', note: alertText.trim() };
  } catch (error) {
    return { id: 'S4', name: 'Decline path (clean failure)', result: 'fail', note: error.message };
  } finally {
    await page.close();
  }
}

module.exports = { run };
