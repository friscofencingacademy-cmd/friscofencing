const { login } = require('../lib/login');

const ID = 'S1';
const NAME = 'Trial booking';

// The backend's own conflict text for a second trial (trialClass.service.js) —
// a stale TrialClass from an un-reset run, reported as a skip, not a failure.
const ALREADY_USED_TRIAL = /already used their trial class/i;

// S1 — trial booking (free, no payment). Matches frontend/app/parent/book-
// trial/page.tsx: one sequential page, no "Continue" step — picking a child
// reveals the Level select, picking a level reveals the session pills, and the
// summary's "Book Trial Class" CTA submits (rewritten 2026-10-26,
// docs/plans/audit-and-health-refresh-plan.md F3: the old flow clicked a
// "Continue" button and a "Class" select that no longer exist).
//
// Trial booking requires the family phone and the child's date of birth
// (trialClass.service.js); the audit seed sets both on every run.
async function run(context, config) {
  const page = await context.newPage();

  try {
    await login(page, config.stagingUrl, 'audit-parent-1@example.com', config.testPassword);

    await page.goto(`${config.stagingUrl}/parent/book-trial`);

    await page.getByRole('radio', { name: /audit childone/i }).click();
    await page.getByLabel('Level').selectOption({ label: 'Audit Level A' });

    const sessionPills = page.getByRole('radiogroup', { name: 'Select a session' }).getByRole('radio');
    await sessionPills.first().waitFor({ timeout: 10000 });
    await sessionPills.first().click();

    await page.getByRole('button', { name: /book trial class/i }).click();

    const booked = page.getByText('Trial class booked!');
    const alreadyUsed = page.getByText(ALREADY_USED_TRIAL);
    await booked.or(alreadyUsed).first().waitFor({ timeout: 15000 });

    if (await alreadyUsed.isVisible()) {
      return {
        id: ID,
        name: NAME,
        result: 'skip',
        note: 'This child already has a trial from a prior run — run `npm run audit:reset` in backend/ first.',
      };
    }

    return { id: ID, name: NAME, result: 'pass', note: '' };
  } catch (error) {
    return { id: ID, name: NAME, result: 'fail', note: error.message };
  } finally {
    await page.close();
  }
}

module.exports = { id: ID, name: NAME, run };
