require('dotenv/config');

const { chromium } = require('playwright');

const { assertStaging } = require('./lib/staging-guard');
const { login } = require('./lib/login');
const s1 = require('./scenarios/s1-trial-booking');
const s2 = require('./scenarios/s2-registration');
const s3 = require('./scenarios/s3-sibling-discount');
const s4 = require('./scenarios/s4-decline');
const s5 = require('./scenarios/s5-sibling-discount-bridge');
const s6 = require('./scenarios/s6-charge-decline-retry');

const REQUIRED_ENV_VARS = [
  'AUDIT_STAGING_URL',
  'AUDIT_TEST_PASSWORD',
  'AUDIT_SUPERADMIN_EMAIL',
  'AUDIT_SUPERADMIN_PASSWORD',
];

const SCENARIOS = [s1, s2, s3, s4, s5, s6];

function overallFrom(results) {
  if (results.some((r) => r.result === 'fail')) return 'fail';
  if (results.some((r) => r.result === 'skip')) return 'partial';
  return 'pass';
}

function printReport(results, startedAt, finishedAt, config) {
  console.log('════════════════════════════════════════');
  console.log(' AUDIT: audit-live-registration');
  console.log(` Run: ${finishedAt.toISOString()}`);
  console.log(` Target: ${config.stagingUrl}`);
  console.log('════════════════════════════════════════');
  results.forEach((r) => {
    const icon = r.result === 'pass' ? '✓' : r.result === 'fail' ? '✗' : '⏭';
    console.log(` ${r.id} — ${r.name.padEnd(38)} ${icon}${r.note ? `  (${r.note})` : ''}`);
  });
  const passed = results.filter((r) => r.result === 'pass').length;
  console.log('────────────────────────────────────────');
  console.log(` Passed: ${passed}/${results.length}`);
  const failed = results.filter((r) => r.result === 'fail');
  if (failed.length > 0) {
    console.log(` Failed: ${failed.map((r) => r.id).join(', ')}`);
  }
  const skipped = results.filter((r) => r.result === 'skip');
  if (skipped.length > 0) {
    console.log(` Skipped: ${skipped.map((r) => r.id).join(', ')}`);
  }
  console.log('════════════════════════════════════════');
}

// Non-fatal by design (docs/plans/audit-system-plan.md's Phase 3 report
// format) — a reporting failure must never change the audit's own exit
// code or be retried.
async function reportResults(browser, config, results, startedAt, finishedAt) {
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page, config.stagingUrl, config.superadminEmail, config.superadminPassword);

    const payload = {
      auditName: 'audit-live-registration',
      group: null,
      overall: overallFrom(results),
      scenarios: results.map((r) => ({ id: r.id, name: r.name, result: r.result, note: r.note })),
      summary: `${results.filter((r) => r.result === 'pass').length}/${results.length} scenarios passed.`,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      runner: 'playwright-script',
    };

    // Through the frontend's own /api/v1/* proxy, not a raw backend URL —
    // see lib/staging-guard.js's comment for why that matters here.
    const res = await context.request.post(`${config.stagingUrl}/api/v1/audit-runs`, { data: payload });

    if (!res.ok()) {
      console.warn(`⚠️  Could not report results to the audit dashboard: HTTP ${res.status()}`);
    } else {
      console.log('Reported to /admin/audits.');
    }

    await context.close();
  } catch (error) {
    console.warn(`⚠️  Could not report results to the audit dashboard: ${error.message}`);
  }
}

async function main() {
  assertStaging();

  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}. Set them in audit/.env.`);
    process.exit(1);
  }

  const config = {
    stagingUrl: process.env.AUDIT_STAGING_URL.replace(/\/$/, ''),
    testPassword: process.env.AUDIT_TEST_PASSWORD,
    superadminEmail: process.env.AUDIT_SUPERADMIN_EMAIL,
    superadminPassword: process.env.AUDIT_SUPERADMIN_PASSWORD,
  };

  const startedAt = new Date();
  const browser = await chromium.launch({ headless: process.env.AUDIT_HEADED !== 'true' });

  // Run every scenario even if one fails — collect all results first, then
  // report at the end (docs/plans/audit-system-plan.md's Phase 3 rule).
  // Each scenario gets its own fresh browser context — no shared state,
  // no login bleeding from one scenario's parent account into another's.
  const results = [];
  for (const scenario of SCENARIOS) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design,
    // scenarios share the one browser instance and must not run concurrently
    // against the same seeded accounts.
    const context = await browser.newContext();
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await scenario.run(context, config);
      results.push(result);
    } catch (error) {
      results.push({ id: '?', name: scenario.name || 'unknown scenario', result: 'fail', note: error.message });
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await context.close();
    }
  }

  const finishedAt = new Date();

  printReport(results, startedAt, finishedAt, config);
  await reportResults(browser, config, results, startedAt, finishedAt);

  await browser.close();

  process.exitCode = results.some((r) => r.result === 'fail') ? 1 : 0;
}

main();
