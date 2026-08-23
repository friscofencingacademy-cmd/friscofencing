// Logs a Playwright page in through the REAL /login form — never a direct
// cookie/API shortcut. Matches frontend/app/login/page.tsx exactly: label
// "Email"/"Password", submit button "Log In".
//
// Found on the first real run against staging, not assumed: the button's
// accessible name changes to "Logging in..." the instant handleSubmit
// starts (frontend/app/login/page.tsx: `{submitting ? 'Logging in...' :
// 'Log In'}`) — well before the async login request resolves. Waiting for
// the "Log In"-named element to detach therefore matches that text change,
// not a successful login: it was resolving in ~400ms with zero cookies set
// and the page still on /login. Wait for actual navigation away from
// /login instead — this fires only once ROLE_LANDING_PATH's router.replace
// has really happened, i.e. login actually succeeded.
async function login(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
}

module.exports = { login };
