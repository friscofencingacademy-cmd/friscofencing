const { login } = require('../lib/login');
const { fillCardElement, STRIPE_TEST_CARDS } = require('../lib/stripe-card');
const { registerChild } = require('../lib/register-child');

const ID = 'S5';
const NAME = 'Sibling discount (bridge case)';

// The register wizard's own notice for a child with an active subscription
// (register/page.tsx) — a stale registration from an un-reset run, reported
// as a skip, not a failure.
const ALREADY_ENROLLED = /is already enrolled/i;

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
    // with bridge wording, distinct from S3's own-plan wording. The backend
    // has two bridge sentences (calculateChargeAmount.service.js
    // SIBLING_DISCOUNT_REASONS): BRIDGE when the 10% comes from the sibling's
    // plan, BRIDGE_PRORATED when a late-month start prorates this plan's first
    // charge below it. Which one depends on today's date, so this checks the
    // opening both share — and the own-plan sentence lacks — keeping S5
    // correct on every day of the month (found 2026-10-26: S5 failed late in
    // the month when the reason was still chosen by the prorated amount).
    await registerChild(page, config, /audit bridgesecond/i, 'Audit Level A', true, {
      expectedReason: "Your family's 10% sibling discount applies to this registration",
    });

    return { id: ID, name: NAME, result: 'pass', note: '' };
  } catch (error) {
    if (await page.getByText(ALREADY_ENROLLED).isVisible().catch(() => false)) {
      return {
        id: ID,
        name: NAME,
        result: 'skip',
        note: 'Already enrolled from a prior run — run `npm run audit:reset` in backend/ first.',
      };
    }
    return { id: ID, name: NAME, result: 'fail', note: error.message };
  } finally {
    await page.close();
  }
}

module.exports = { id: ID, name: NAME, run };
