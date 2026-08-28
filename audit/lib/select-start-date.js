// Selects a start date on the register wizard's Level step — handles both
// UI states the picker can be in (frontend/app/parent/register/page.tsx):
// a "this month" pill row of upcoming dates (radiogroup "Select a start
// date"), shown when at least one session falls within the 14-day/
// month-end window, OR an "Enroll for next month" button when none does.
//
// Found live against staging, not assumed up front: a fixed weekly audit
// schedule genuinely has zero "this month" sessions whenever today falls
// late enough in the month that the schedule's next occurrence rolls into
// next month (e.g. a Tuesday-only class with today on a late-month Friday)
// — the window caps at the EARLIER of 14 days out or month-end, so this
// isn't a rare edge case, it recurs predictably near the end of every
// month. Shared by register-child.js, s2-registration.js, and
// s6-charge-decline-retry.js so all three pick whichever control a real
// parent would actually see, rather than assuming the pill row is always
// present.
async function selectStartDate(page) {
  const pillRow = page.getByRole('radiogroup', { name: 'Select a start date' });
  const enrollNextMonth = page.getByRole('button', { name: /enroll for next month/i });

  const pillRowVisible = await pillRow
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (pillRowVisible) {
    await pillRow.getByRole('radio').first().click();
    return;
  }

  // No this-month sessions — fall back to "Enroll for next month", same as
  // a real parent would. It's disabled if no next-month session exists
  // either (schedule not posted yet); that's a genuine "nothing to
  // register into" state, surfaced as a thrown error rather than silently
  // doing nothing.
  const enrollEnabled = await enrollNextMonth.isEnabled().catch(() => false);
  if (!enrollEnabled) {
    throw new Error('Neither a this-month start date nor "Enroll for next month" is available for this level.');
  }
  await enrollNextMonth.click();
}

module.exports = { selectStartDate };
