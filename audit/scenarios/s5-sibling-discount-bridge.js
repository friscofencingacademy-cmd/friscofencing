const { login } = require('../lib/login');
const { fillCardElement, STRIPE_TEST_CARDS } = require('../lib/stripe-card');
const { registerChild } = require('../lib/register-child');

// S5 — sibling discount, BRIDGE case (docs/plans/audit-skills-refresh-plan.md
// D3; docs/decisions/006-sibling-discount-family-rule.md). PR 3 of the
// billing-anchor-and-sibling-discount plan added a genuinely new path: a
// new child registering as the family's HIGHER payer also gets 10% off
// immediately, based on the sibling's EXISTING lower fee — not just the
// "own-fee" case S3 already covers (a new child registering as the LOWER
// payer). The registration order here is deliberately reversed relative to
// S3 — that's what actually exercises the new path:
//   1. BridgeFirst into the CHEAPER Level B first — no sibling yet, no
//      discount expected, same as any first registration.
//   2. BridgeSecond into the PRICIER Level A second — expects the live
//      preview to show the discount (not "no discount," which is what the
//      OLD rule would have shown for a higher payer), and the confirmation
//      screen to show the bridge-specific reason text, distinct from S3's
//      own-fee wording (calculateChargeAmount.service.js).
async function run(context, config) {
  const page = await context.newPage();

  try {
    await login(page, config.stagingUrl, 'audit-bridge-parent@example.com', config.testPassword);

    await page.goto(`${config.stagingUrl}/parent/payment-method`);
    const alreadyOnFile = await page.getByText(/card on file/i).isVisible().catch(() => false);
    if (!alreadyOnFile) {
      await fillCardElement(page, { number: STRIPE_TEST_CARDS.success });
      await page.getByRole('button', { name: /save card/i }).click();
      await page.getByText(/card on file/i).waitFor({ timeout: 30000 });
    }

    // First child, cheaper level — no sibling yet, no discount expected.
    await registerChild(page, config, /audit bridgefirst/i, 'Audit Level B', false);

    // Second child, PRICIER level — the bridge case: expects the discount
    // (based on the first child's lower fee) with the bridge-specific
    // reason text, distinct from S3's own-fee wording.
    await registerChild(page, config, /audit bridgesecond/i, 'Audit Level A', true, {
      expectedReason:
        "Your family's 10% sibling discount applies to this registration, based on your other child's lower-priced plan.",
    });

    return { id: 'S5', name: 'Sibling discount (bridge case)', result: 'pass', note: '' };
  } catch (error) {
    if (await page.getByText(/already registered/i).isVisible().catch(() => false)) {
      return {
        id: 'S5',
        name: 'Sibling discount (bridge case)',
        result: 'skip',
        note: 'Already registered from a prior run — run `npm run audit:reset` in backend/ first.',
      };
    }
    return { id: 'S5', name: 'Sibling discount (bridge case)', result: 'fail', note: error.message };
  } finally {
    await page.close();
  }
}

module.exports = { run };
