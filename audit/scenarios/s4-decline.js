const { login } = require('../lib/login');
const { fillCardElement, STRIPE_TEST_CARDS } = require('../lib/stripe-card');

const ID = 'S4';
const NAME = 'Decline path (clean failure)';

// S4 — decline path: a card that declines at SAVE time.
//
// Found on the first real run (2026-08-23): Stripe's documented decline card
// (4000000000000002) declines at stripe.paymentMethods.attach() itself, not
// only when charged. Since payment PR 1 (docs/decisions/013-payment-provider-
// port.md) the Stripe adapter maps that to a 402 carrying Stripe's own
// message (stripe.provider.js attachPaymentMethod), and StripeCardForm shows
// it verbatim. The scenario expects that clean message, never a raw
// Stripe/JS error and never the central error handler's generic 5xx text —
// that text here would mean the 402 mapping regressed and the decline became
// a 500 (errorHandler.js GENERIC_SERVER_ERROR_MESSAGE). Also no false
// "card on file" success.
const GENERIC_SERVER_ERROR = /something went wrong/i;

async function run(context, config) {
  const page = await context.newPage();

  try {
    await login(page, config.stagingUrl, 'audit-decline-parent@example.com', config.testPassword);

    await page.goto(`${config.stagingUrl}/parent/payment-method`);
    const alreadyOnFile = await page.getByText(/card on file/i).isVisible().catch(() => false);

    if (alreadyOnFile) {
      return {
        id: ID,
        name: NAME,
        result: 'skip',
        note: 'A payment method is already on file for this account — run `npm run audit:reset` in backend/ first for a clean decline test.',
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
    if (GENERIC_SERVER_ERROR.test(alertText)) {
      throw new Error(`Generic server-error text shown ("${alertText.trim()}") — the 402 card-decline mapping regressed`);
    }
    if (looksRaw || !alertText.trim()) {
      throw new Error(`Decline message not clean/legible: "${alertText}"`);
    }

    return { id: ID, name: NAME, result: 'pass', note: alertText.trim() };
  } catch (error) {
    return { id: ID, name: NAME, result: 'fail', note: error.message };
  } finally {
    await page.close();
  }
}

module.exports = { id: ID, name: NAME, run };
