const { login } = require('../lib/login');
const { fillCardElement, STRIPE_TEST_CARDS } = require('../lib/stripe-card');
const { registerChild } = require('../lib/register-child');

// S3 — sibling discount, OWN-FEE case. Registers audit-sibling-parent's
// FIRST child into the PRICIER level (no discount expected — no sibling
// with an active subscription exists yet), then the SECOND child into the
// CHEAPER level (expects the live GET /registrations/preview discount line
// in the UI, per this session's sibling-discount-preview feature, and the
// real applied discount on the confirmation screen). Cross-checks that the
// two never disagree — the same property registration.routes.test.js
// proves at the API level, here proven through the real UI a parent
// actually sees.
//
// See s5-sibling-discount-bridge.js for the BRIDGE case (a new child
// registering as the family's HIGHER payer) — the two scenarios share
// register-child.js's mechanics and differ only in account/order/expected-
// reason text.
async function run(context, config) {
  const page = await context.newPage();

  try {
    await login(page, config.stagingUrl, 'audit-sibling-parent@example.com', config.testPassword);

    await page.goto(`${config.stagingUrl}/parent/payment-method`);
    const alreadyOnFile = await page.getByText(/card on file/i).isVisible().catch(() => false);
    if (!alreadyOnFile) {
      await fillCardElement(page, { number: STRIPE_TEST_CARDS.success });
      await page.getByRole('button', { name: /save card/i }).click();
      await page.getByText(/card on file/i).waitFor({ timeout: 30000 });
    }

    // First sibling, pricier level — no discount yet.
    await registerChild(page, config, /audit firstsibling/i, 'Audit Level A', false);

    // Second sibling, cheaper level — expects the discount, both pre- and
    // post-charge, with the own-fee reason text.
    await registerChild(page, config, /audit secondsibling/i, 'Audit Level B', true, {
      expectedReason: 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
    });

    return { id: 'S3', name: 'Sibling discount (preview == charge)', result: 'pass', note: '' };
  } catch (error) {
    if (await page.getByText(/already registered/i).isVisible().catch(() => false)) {
      return {
        id: 'S3',
        name: 'Sibling discount (preview == charge)',
        result: 'skip',
        note: 'Already registered from a prior run — run `npm run audit:reset` in backend/ first.',
      };
    }
    return { id: 'S3', name: 'Sibling discount (preview == charge)', result: 'fail', note: error.message };
  } finally {
    await page.close();
  }
}

module.exports = { run };
