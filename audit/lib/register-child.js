const { selectStartDate } = require('./select-start-date');

// If you change this wizard's DOM/labels, also update:
//   frontend/e2e/parent-register.spec.ts (E2E twin, mocked-network)
//   audit/scenarios/s2-registration.js (this file's own plain-registration twin)
// frontend/lib/__tests__/guards/auditSelectorGuard.test.ts fails CI when a
// label or text this package relies on disappears from the app
// (docs/plans/audit-and-health-refresh-plan.md D8).
//
// Shared by s3-sibling-discount.js (own-fee case) and
// s5-sibling-discount-bridge.js (bridge case). Registers one child into one
// level and cross-checks the LIVE preview (GET /registrations/preview, shown
// in the order summary before paying) against what was actually charged
// (POST /registrations, shown on the confirmation screen): the discount must
// be shown in both or neither, and when shown, the two amounts must be the
// exact same string. The backend is the only source of both figures (CLAUDE.md
// hard rule 7); this proves the preview a parent sees is the charge they get.

// The order summary shows this note only when the preview applies the
// sibling discount (register/page.tsx SIBLING_DISCOUNT_NOTE).
const SIBLING_DISCOUNT_NOTE = /the 10% sibling discount always applies to the lower-priced plan/i;
// The summary's discount row label starts with this ("Sibling Discount (10% of
// $X)*"); the confirmation screen's row is exactly this.
const SIBLING_DISCOUNT_LABEL = 'Sibling Discount';
// The summary's bottom line — rendered only once the preview has loaded, so
// waiting for it makes every "is the discount shown?" read deterministic.
const PREVIEW_LOADED_LABEL = 'Due at enrollment';

// The value rendered next to a label: OrderSummary and FlowConfirmation both
// render a row as <label element><value element> siblings.
function valueNextTo(labelLocator) {
  return labelLocator.locator('xpath=following-sibling::*[1]');
}

async function readText(locator) {
  return ((await locator.textContent()) || '').trim();
}

async function registerChild(page, config, childNameRegex, levelName, expectDiscount, options = {}) {
  const { expectedReason } = options;

  await page.goto(`${config.stagingUrl}/parent/register`);

  // Picking a child reveals the level step on the same page — there is no
  // "Continue" step; the summary's CTA is always "Register & Pay".
  await page.getByRole('radio', { name: childNameRegex }).click();
  await page.getByRole('radio', { name: new RegExp(levelName, 'i') }).click();
  await selectStartDate(page);

  await page.getByText(PREVIEW_LOADED_LABEL, { exact: true }).waitFor({ timeout: 15000 });

  const previewShowsDiscount = await page.getByText(SIBLING_DISCOUNT_NOTE).isVisible();
  if (expectDiscount !== previewShowsDiscount) {
    throw new Error(`Expected the sibling-discount preview shown=${expectDiscount}, got ${previewShowsDiscount} for ${levelName}`);
  }

  const previewAmount = expectDiscount
    ? await readText(valueNextTo(page.getByText(new RegExp(`^${SIBLING_DISCOUNT_LABEL}`)).first()))
    : null;

  await page.getByText(/card on file/i).waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: /register & pay/i }).click();
  await page.getByText('Registration complete!').waitFor({ timeout: 45000 });

  // exact: true — the confirmation also shows a "Why" reason line that
  // mentions the discount; a substring match would resolve to both.
  const chargedLabel = page.getByText(SIBLING_DISCOUNT_LABEL, { exact: true });
  const chargeShowsDiscount = await chargedLabel.isVisible();

  if (expectDiscount !== chargeShowsDiscount) {
    throw new Error(
      `Preview said discount=${expectDiscount} but the confirmation's ${SIBLING_DISCOUNT_LABEL} line shown=${chargeShowsDiscount} — preview and charge disagree`
    );
  }

  if (expectDiscount) {
    const chargedAmount = await readText(valueNextTo(chargedLabel));
    if (!previewAmount || previewAmount !== chargedAmount) {
      throw new Error(`Previewed discount "${previewAmount}" but charged discount "${chargedAmount}" — preview and charge disagree`);
    }
  }

  // Own-fee vs. bridge case render distinct reason copy (ADR 006's "mark").
  // Only asserted when the caller passes one — a first child has no sibling.
  if (expectedReason) {
    const sawReason = await page.getByText(expectedReason).isVisible();
    if (!sawReason) {
      throw new Error(`Expected confirmation reason text not found: "${expectedReason}"`);
    }
  }

  return { discountAmount: previewAmount };
}

module.exports = { registerChild };
