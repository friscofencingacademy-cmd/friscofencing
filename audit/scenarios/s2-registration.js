const { login } = require('../lib/login');
const { fillCardElement, STRIPE_TEST_CARDS } = require('../lib/stripe-card');

// S2 — add a payment method (real Stripe CardElement, success card), then
// complete a group-class registration. Frisco always uses a pre-saved card
// (frontend/app/parent/payment-method/page.tsx) — there is no "new card at
// checkout" step on the register wizard itself (see docs/plans/audit-
// system-plan.md, D3), unlike CKQ's checkout flow.
async function run(context, config) {
  const page = await context.newPage();

  try {
    await login(page, config.stagingUrl, 'audit-parent-1@example.com', config.testPassword);

    await page.goto(`${config.stagingUrl}/parent/payment-method`);

    const alreadyOnFile = await page.getByText(/card on file/i).isVisible().catch(() => false);
    if (!alreadyOnFile) {
      await fillCardElement(page, { number: STRIPE_TEST_CARDS.success });
      await page.getByRole('button', { name: /save card/i }).click();
      await page.getByText(/card on file/i).waitFor({ timeout: 15000 });
    }

    await page.goto(`${config.stagingUrl}/parent/register`);

    await page.getByRole('radio', { name: /audit childone/i }).click();
    await page.getByRole('button', { name: /continue/i }).click();

    await page.getByLabel('Class').selectOption({ label: 'Audit Class A' });
    await page.getByLabel('Schedule').waitFor();
    await page.getByLabel('Schedule').selectOption({ index: 1 }); // the one schedule audit-seed.js created
    await page.getByRole('button', { name: /continue/i }).click();

    await page.getByText(/card on file/i).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /register & pay/i }).click();

    await page.getByText('Registration complete!').waitFor({ timeout: 20000 });

    const chargeText = await page.getByText(/your card was charged/i).textContent();

    return {
      id: 'S2',
      name: 'Add card + register',
      result: 'pass',
      note: chargeText ? chargeText.trim() : '',
    };
  } catch (error) {
    // Already-registered (409, from a prior un-reset run) is a known,
    // reportable skip condition, not a hard failure — the reset script
    // (npm run audit:reset in backend/) clears this between runs.
    if (await page.getByText(/already registered/i).isVisible().catch(() => false)) {
      return {
        id: 'S2',
        name: 'Add card + register',
        result: 'skip',
        note: 'Already registered from a prior run — run `npm run audit:reset` in backend/ first.',
      };
    }
    return { id: 'S2', name: 'Add card + register', result: 'fail', note: error.message };
  } finally {
    await page.close();
  }
}

module.exports = { run };
