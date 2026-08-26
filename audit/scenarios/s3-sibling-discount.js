const { login } = require('../lib/login');
const { fillCardElement, STRIPE_TEST_CARDS } = require('../lib/stripe-card');

// S3 — sibling discount. Registers audit-sibling-parent's FIRST child into
// the PRICIER level (no discount expected — no sibling with an active
// subscription exists yet), then the SECOND child into the CHEAPER level
// (expects the live GET /registrations/preview discount line in the UI,
// per this session's sibling-discount-preview feature, and the real
// applied discount on the confirmation screen). Cross-checks that the two
// never disagree — the same property registration.routes.test.js proves
// at the API level, here proven through the real UI a parent actually sees.
async function registerChild(page, config, childNameRegex, levelName, expectDiscount) {
  await page.goto(`${config.stagingUrl}/parent/register`);

  await page.getByRole('radio', { name: childNameRegex }).click();
  await page.getByRole('button', { name: /continue/i }).click();

  // Level-cards + time-pills, not the old Class/Schedule <select>s.
  await page.getByRole('radio', { name: new RegExp(levelName, 'i') }).click();
  const timePill = page.getByRole('radiogroup', { name: 'Select a time' }).getByRole('radio').first();
  await timePill.waitFor({ timeout: 10000 });
  await timePill.click();

  // Found on the first real run against staging, not assumed: Locator
  // .isVisible() checks the DOM state immediately — it doesn't actually
  // wait/retry the way .waitFor()/auto-waiting actions do, despite taking a
  // `timeout` option. The live discount preview (GET /registrations/preview)
  // needs a real network round-trip, so an immediate isVisible() check ran
  // before that fetch resolved and always reported false. waitFor() properly
  // polls until the timeout instead.
  const discountVisible = await page
    .getByText(/10% sibling discount applied/i)
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (expectDiscount !== discountVisible) {
    throw new Error(
      `Expected sibling-discount preview visibility=${expectDiscount}, got ${discountVisible} for ${levelName}`
    );
  }

  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByText(/card on file/i).waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: /register & pay/i }).click();
  await page.getByText('Registration complete!').waitFor({ timeout: 45000 });

  // exact:true — the confirmation screen also shows a plain-language reason
  // line (e.g. "...the 10% sibling discount applies here.") next to this
  // one whenever the discount applies. A non-exact substring match resolves
  // to BOTH elements, which throws a Playwright strict-mode violation that
  // .catch(() => false) silently swallowed as "not visible" — a false
  // failure found on a real run against staging, not assumed up front (the
  // real charge was correct: verified independently via GET
  // /registrations/mine, which showed lastSiblingDiscountApplied: true).
  const sawConfirmationDiscount = await page
    .getByText('Sibling Discount', { exact: true })
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
      await page.getByText(/card on file/i).waitFor({ timeout: 30000 });
    }

    // First sibling, pricier level — no discount yet.
    await registerChild(page, config, /audit firstsibling/i, 'Audit Level A', false);

    // Second sibling, cheaper level — expects the discount, both pre- and
    // post-charge.
    await registerChild(page, config, /audit secondsibling/i, 'Audit Level B', true);

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
