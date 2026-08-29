import { defineConfig, devices } from '@playwright/test';

// CI-gated E2E layer — see docs/plans/e2e-testing-plan.md for the full design.
// Real Chromium against a real, locally-built Next.js server; every backend
// call is intercepted with page.route() (frontend/e2e/fixtures/mock-api.ts) —
// no real database, no Stripe, no staging. See docs/TESTING_STRATEGY.md's
// three-layer table for how this differs from the Jest/MSW layer and from
// audit/'s real-staging live audit.
const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Fixed regardless of the CI runner's host timezone — the register
    // wizard's date-window math (D5) runs on the browser's local Date, so
    // an unpinned timezone would make the same clock-mocked "now" resolve
    // to a different calendar day depending on where this runs.
    timezoneId: 'America/Chicago',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Builds+starts the real Next.js app once per run and reuses it locally
  // (fast iteration); CI always starts fresh so a stale build can't mask a
  // real breakage. `next build` needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY at
  // build time (lib/stripe.ts's module-scope loadStripe() call) — set here
  // to Stripe's own published example test publishable key (not secret by
  // design, safe to commit) rather than assumed present in the environment.
  // See docs/plans/e2e-testing-plan.md's D11 for why BACKEND_URL needs no
  // equivalent entry: every backend call is mocked before it ever reaches
  // next.config.js's rewrite.
  webServer: {
    command: 'npm run build && npm run start',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_TYooMQauvdEDq54NiTphI7jx',
    },
  },
});
