// Logs a Playwright page in through the REAL /login form — never a direct
// cookie/API shortcut. Matches frontend/app/login/page.tsx exactly: label
// "Email"/"Password", submit button "Log In".
async function login(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  // Login redirects on success (ROLE_LANDING_PATH) — wait for the login
  // form itself to disappear rather than a specific destination, since
  // different roles land on different pages.
  await page.getByRole('button', { name: 'Log In' }).waitFor({ state: 'detached', timeout: 15000 });
}

module.exports = { login };
