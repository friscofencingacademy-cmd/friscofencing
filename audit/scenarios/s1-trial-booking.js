const { login } = require('../lib/login');

// S1 — trial booking (free, no Stripe). Matches frontend/app/parent/book-
// trial/page.tsx's real 3-step wizard exactly: Who -> Pick a Class (class
// select -> PillRow session pick, no separate schedule step) -> Confirmation.
async function run(context, config) {
  const page = await context.newPage();

  try {
    await login(page, config.stagingUrl, 'audit-parent-1@example.com', config.testPassword);

    await page.goto(`${config.stagingUrl}/parent/book-trial`);

    await page.getByRole('radio', { name: /audit childone/i }).click();
    await page.getByRole('button', { name: /continue/i }).click();

    await page.getByLabel('Class').selectOption({ label: 'Audit Class A' });

    const sessionPills = page.getByRole('radiogroup', { name: 'Select a session' }).getByRole('radio');
    await sessionPills.first().waitFor({ timeout: 10000 });
    await sessionPills.first().click();

    await page.getByRole('button', { name: /book trial class/i }).click();

    await page.getByText('Trial class booked!').waitFor({ timeout: 15000 });

    return { id: 'S1', name: 'Trial booking', result: 'pass', note: '' };
  } catch (error) {
    return { id: 'S1', name: 'Trial booking', result: 'fail', note: error.message };
  } finally {
    await page.close();
  }
}

module.exports = { run };
