const { login } = require('../lib/login');
const { fillCardElement, STRIPE_TEST_CARDS } = require('../lib/stripe-card');

// S3 — sibling discount. Registers audit-sibling-parent's FIRST child into
// the PRICIER class (no discount expected — no sibling with an active
// subscription exists yet), then the SECOND child into the CHEAPER class
// (expects the live GET /registrations/preview discount line in the UI,
// per this session's sibling-discount-preview feature, and the real
// applied discount on the confirmation screen). Cross-checks that the two
// never disagree — the same property registration.routes.test.js proves
// at the API level, here proven through the real UI a parent actually sees.
async function registerChild(page, config, childNameRegex, className, expectDiscount) {
  await page.goto(`${config.stagingUrl}/parent/register`);

  await page.getByRole('radio', { name: childNameRegex }).click();
  await page.getByRole('button', { name: /continue/i }).click();

  await page.getByLabel('Class').selectOption({ label: className });
  await page.getByLabel('Schedule').waitFor();
  await page.getByLabel('Schedule').selectOption({ index: 1 });

  const discountVisible = await page
    .getByText(/10% sibling discount applied/i)
    .isVisible({ timeout: 8000 })
    .catch(() => false);

  if (expectDiscount !== discountVisible) {
    throw new Error(
      `Expected sibling-discount preview visibility=${expectDiscount}, got ${discountVisible} for ${className}`
    );
  }

  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByText(/card on file/i).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /register & pay/i }).click();
  await page.getByText('Registration complete!').waitFor({ timeout: 20000 });

  const sawConfirmationDiscount = await page
    .getByText('Sibling Discount')
    .isVisible()
    .catch(() => false);

  if (expectDiscount !== sawConfirmationDiscount) {
    throw new Error(
      `Preview said discount=${expectDiscount} but confirmation screen's Sibling Discount line visibility=${sawConfirmationDiscount} — preview and reality disagree`
    );
  }
}

async function run(context, config) {
  const page = await context.newPage();

  try {
    await login(page, config.stagingUrl, 'audit-sibling-parent@example.com', config.testPassword);

    await page.goto(`${config.stagingUrl}/parent/payment-method`);
    const alreadyOnFile = await page.getByText(/card on file/i).isVisible().catch(() => false);
    if (!alreadyOnFile) {
      await fillCardElement(page, { number: STRIPE_TEST_CARDS.success });
      await page.getByRole('button', { name: /save card/i }).click();
      await page.getByText(/card on file/i).waitFor({ timeout: 15000 });
    }

    // First sibling, pricier class — no discount yet.
    await registerChild(page, config, /audit firstsibling/i, 'Audit Class A', false);

    // Second sibling, cheaper class — expects the discount, both pre- and
    // post-charge.
    await registerChild(page, config, /audit secondsibling/i, 'Audit Class B', true);

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
