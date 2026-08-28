const { login } = require('../lib/login');
const { fillCardElement, STRIPE_TEST_CARDS } = require('../lib/stripe-card');

// S6 — a declined REGISTRATION CHARGE enters retry, not an error
// (docs/plans/audit-skills-refresh-plan.md D4; docs/decisions/
// 008-registration-create-pending-first.md). Distinct from S4, which
// covers a card declining at the payment-method SAVE step
// (POST /payment-methods) — this covers a card that saves fine but the
// REGISTRATION CHARGE itself (create()'s own Stripe attempt) is declined.
// PR 2 changed that outcome: it no longer returns an error — it returns
// 201/"Registration received" and enters the same retry/dunning a failed
// renewal uses. Only S6's job is the live, real-browser, real-Stripe
// first-attempt UX (docs/TESTING_STRATEGY.md's two-layer table) — the
// actual 3-day retry/cancel-after-exhaustion cycle is already covered by
// the real Jest integration tests (renewal.service.test.js,
// registration.routes.test.js), not re-proven here.
async function run(context, config) {
  const page = await context.newPage();

  try {
    await login(page, config.stagingUrl, 'audit-retry-parent@example.com', config.testPassword);

    await page.goto(`${config.stagingUrl}/parent/payment-method`);
    const alreadyOnFile = await page.getByText(/card on file/i).isVisible().catch(() => false);

    // This card is expected to SAVE successfully — unlike S4's decline
    // card, chargeDeclineOnly only fails at charge time. If a card is
    // already on file from a prior un-reset run, skip rather than assume
    // it's this specific card.
    if (alreadyOnFile) {
      return {
        id: 'S6',
        name: 'Charge decline enters retry (not an error)',
        result: 'skip',
        note: 'A payment method is already on file for this account — run `npm run audit:reset` first for a clean run.',
      };
    }

    await fillCardElement(page, { number: STRIPE_TEST_CARDS.chargeDeclineOnly });
    await page.getByRole('button', { name: /save card/i }).click();
    await page.getByText(/card on file/i).waitFor({ timeout: 30000 });

    await page.goto(`${config.stagingUrl}/parent/register`);

    await page.getByRole('radio', { name: /audit retrychild/i }).click();
    await page.getByRole('button', { name: /continue/i }).click();

    await page.getByRole('radio', { name: /audit level a/i }).click();
    const timePill = page.getByRole('radiogroup', { name: 'Select a time' }).getByRole('radio').first();
    await timePill.waitFor({ timeout: 10000 });
    await timePill.click();
    await page.getByRole('button', { name: /continue/i }).click();

    await page.getByText(/card on file/i).waitFor({ timeout: 45000 });
    await page.getByRole('button', { name: /register & pay/i }).click();

    // The point of this scenario: a declined charge must NOT surface as an
    // error. The wizard reaches step 2 with "Registration received", never
    // "Registration complete!" (that title is the paymentStatus: 'completed'
    // branch) and never a raw error/alert.
    await page.getByText('Registration received').waitFor({ timeout: 45000 });
    const sawRetryWording = await page
      .getByText(/we'll automatically retry/i)
      .isVisible()
      .catch(() => false);

    if (!sawRetryWording) {
      throw new Error('Reached "Registration received" but the automatic-retry copy is missing from the confirmation screen');
    }

    // Verify via an authenticated API call in the same browser context
    // (GET /registrations/mine, matching this repo's existing "verify
    // honestly, not via a DB peek" convention) that the subscription is
    // active with retryCount >= 1 — chargeFinalization.service.js sets
    // retryCount to the attempt number immediately on a failed charge, no
    // cron wait needed.
    const res = await page.request.get(`${config.stagingUrl}/api/v1/registrations/mine`);
    if (!res.ok()) {
      throw new Error(`GET /registrations/mine failed: HTTP ${res.status()}`);
    }
    const { subscriptions } = await res.json();
    const retrySub = subscriptions.find((sub) => sub.studentId?.lastName === 'RetryChild');

    if (!retrySub) {
      throw new Error('No Subscription found for RetryChild via GET /registrations/mine');
    }
    if (retrySub.status !== 'active') {
      throw new Error(`Expected RetryChild's Subscription.status === 'active', got '${retrySub.status}'`);
    }
    if (!(retrySub.retryCount >= 1)) {
      throw new Error(`Expected RetryChild's Subscription.retryCount >= 1, got ${retrySub.retryCount}`);
    }

    return { id: 'S6', name: 'Charge decline enters retry (not an error)', result: 'pass', note: '' };
  } catch (error) {
    if (await page.getByText(/already registered/i).isVisible().catch(() => false)) {
      return {
        id: 'S6',
        name: 'Charge decline enters retry (not an error)',
        result: 'skip',
        note: 'Already registered from a prior run — run `npm run audit:reset` in backend/ first.',
      };
    }
    return { id: 'S6', name: 'Charge decline enters retry (not an error)', result: 'fail', note: error.message };
  } finally {
    await page.close();
  }
}

module.exports = { run };
