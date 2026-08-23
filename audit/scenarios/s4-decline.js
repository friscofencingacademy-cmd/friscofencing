const { login } = require('../lib/login');
const { fillCardElement, STRIPE_TEST_CARDS } = require('../lib/stripe-card');

// S4 — decline path. Stripe's documented decline card saves successfully
// (paymentMethod.service.js's savePaymentMethod only calls
// stripe.paymentMethods.attach() — no SetupIntent/confirm at save time, see
// docs/plans/audit-system-plan.md D3) and only fails at actual charge time.
// Expects a clear, legible decline message (never a raw Stripe/JS error),
// and no Registration/Subscription left in a false-success state.
async function run(context, config) {
  const page = await context.newPage();

  try {
    await login(page, config.stagingUrl, 'audit-decline-parent@example.com', config.testPassword);

    await page.goto(`${config.stagingUrl}/parent/payment-method`);
    const alreadyOnFile = await page.getByText(/card on file/i).isVisible().catch(() => false);
    if (!alreadyOnFile) {
      await fillCardElement(page, { number: STRIPE_TEST_CARDS.decline });
      await page.getByRole('button', { name: /save card/i }).click();
      // Saving a decline card is expected to SUCCEED — Stripe only declines
      // at charge time. If it fails here instead, that's itself a finding.
      await page.getByText(/card on file/i).waitFor({ timeout: 15000 });
    }

    await page.goto(`${config.stagingUrl}/parent/register`);

    await page.getByRole('radio', { name: /audit declinechild/i }).click();
    await page.getByRole('button', { name: /continue/i }).click();

    await page.getByLabel('Class').selectOption({ label: 'Audit Class A' });
    await page.getByLabel('Schedule').waitFor();
    await page.getByLabel('Schedule').selectOption({ index: 1 });
    await page.getByRole('button', { name: /continue/i }).click();

    await page.getByText(/card on file/i).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /register & pay/i }).click();

    const alert = page.getByRole('alert');
    await alert.waitFor({ timeout: 20000 });
    const alertText = (await alert.textContent()) || '';

    const looksRaw = /stripe|typeerror|undefined|\[object/i.test(alertText);
    const sawSuccess = await page.getByText('Registration complete!').isVisible().catch(() => false);

    if (sawSuccess) {
      throw new Error('False success: confirmation screen rendered despite a declined card');
    }
    if (looksRaw || !alertText.trim()) {
      throw new Error(`Decline message not clean/legible: "${alertText}"`);
    }

    return { id: 'S4', name: 'Decline path (clean failure)', result: 'pass', note: alertText.trim() };
  } catch (error) {
    if (await page.getByText(/already registered/i).isVisible().catch(() => false)) {
      return {
        id: 'S4',
        name: 'Decline path (clean failure)',
        result: 'skip',
        note: 'Already registered from a prior run — run `npm run audit:reset` in backend/ first.',
      };
    }
    return { id: 'S4', name: 'Decline path (clean failure)', result: 'fail', note: error.message };
  } finally {
    await page.close();
  }
}

module.exports = { run };
