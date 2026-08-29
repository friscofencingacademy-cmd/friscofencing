const { selectStartDate } = require('./select-start-date');

// If you change this wizard's DOM/labels, also update:
//   frontend/e2e/parent-register.spec.ts (E2E twin, mocked-network)
//   audit/scenarios/s2-registration.js (this file's own plain-registration twin)
// (docs/plans/e2e-testing-plan.md's D9.)
//
// Shared by s3-sibling-discount.js (own-fee case) and
// s5-sibling-discount-bridge.js (bridge case) — docs/plans/
// audit-skills-refresh-plan.md D3. Registers one child into one level and
// checks the live GET /registrations/preview discount line in the UI
// against the real applied discount shown post-charge — the two scenarios
// differ only in account/order/expected-reason, not in mechanics, so this
// stays a single implementation both import rather than duplicating the
// Playwright steps.
async function registerChild(page, config, childNameRegex, levelName, expectDiscount, options = {}) {
  const { expectedReason } = options;

  await page.goto(`${config.stagingUrl}/parent/register`);

  // Picking a child auto-advances straight to the level/date step — no
  // separate "Continue" click (frontend commit 9608fdf merged the wizard
  // steps). There is no "Continue"-labeled button anywhere in this flow
  // any more; the level/date step's CTA goes directly to "Register & Pay".
  await page.getByRole('radio', { name: childNameRegex }).click();

  // Level-cards + date-pills, not the old Class/Schedule <select>s.
  await page.getByRole('radio', { name: new RegExp(levelName, 'i') }).click();
  await selectStartDate(page);

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

  // Own-fee vs. bridge case render distinct reason copy (ADR 006's "mark" —
  // the whole point of having two cases at all). Only asserted when the
  // caller passes one, since S3's first call (no sibling yet) has no
  // reason line to check.
  if (expectedReason) {
    const sawReason = await page.getByText(expectedReason).isVisible().catch(() => false);
    if (!sawReason) {
      throw new Error(`Expected confirmation reason text not found: "${expectedReason}"`);
    }
  }
}

module.exports = { registerChild };
