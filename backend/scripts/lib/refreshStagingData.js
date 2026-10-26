// Composes the full "clean slate" sequence the owner asked for
// (2026-08-24): wipe everything, bring the new legacy data in, then make
// sure superadmin exists again. One call, one Mongo connection — the CLI
// wrapper (scripts/refresh-staging-data.js) only handles argv/env/guarding
// (including the staging/local-only guard every step below relies on —
// none of these functions has its own opinion on staging vs. production,
// same discipline as wipeDatabase() itself).

const { wipeDatabase } = require('./wipeDatabase');
const { migratePeriodMonth } = require('./migratePeriodMonth');
const { seedServices } = require('./seedServices');
const { runLegacyImport } = require('./runLegacyImport');
const { seedSuperadmin } = require('./seedSuperadmin');
const { scrubProviderFields } = require('./scrubProviderFields');
const { setStagingTestPasswords } = require('./setStagingTestPasswords');
const { seedAuditFixtures } = require('./seedAuditFixtures');

async function refreshStagingData({ csvText, config, superadmin, auditTestPassword }) {
  // Checked before the wipe: a refresh that cannot re-seed the audit
  // fixtures must not start, or it would leave staging without them.
  if (typeof auditTestPassword !== 'string' || auditTestPassword.length === 0) {
    throw new Error('refreshStagingData: auditTestPassword (AUDIT_TEST_PASSWORD) is required');
  }

  const wipeResult = await wipeDatabase();

  // periodMonth/Guard B index migration (docs/plans/payment-airtight-plan
  // .md D7) — runs against a just-wiped, empty `registrations` collection,
  // the safest possible moment: nothing to backfill, nothing that could
  // collide, so this is always a clean no-op on the DATA side. What it
  // still does every time is ensure the CURRENT unique index
  // ({subscriptionId, periodMonth}) exists and the stale, pre-migration one
  // ({subscriptionId, periodStart}) is dropped — wipeDatabase() only
  // deletes documents, never indexes, so a stale index would otherwise
  // silently survive every reseed forever.
  const periodMonthMigration = await migratePeriodMonth({ apply: true });

  // Services seeded BEFORE the legacy import — the import writes real
  // Registration ledger rows (docs/plans/service-registry-unified-ledger-
  // plan.md), which require a resolvable serviceId. A refresh that left
  // this collection empty would make every ledger write in the import fail.
  const serviceSeedResults = await seedServices();
  const importSummary = await runLegacyImport({ csvText, config });
  const { superadmin: superadminUser, created: superadminCreated } = await seedSuperadmin(superadmin);

  // Explicit payment-provider scrub (owner request, 2026-08-31) — the wipe + CSV-only
  // import already guarantee this today (see scrubProviderFields.js's own
  // comment for why), but this makes the guarantee a standing, self-
  // documenting step rather than an accident of the current data source
  // that a future change could quietly weaken.
  const providerScrubResult = await scrubProviderFields();

  // One known password for every login-capable user (owner request,
  // 2026-08-31) — staging testing convenience ONLY; a migrated parent
  // otherwise has no password at all, and each real coach gets its own
  // distinct password from legacy-import.config.js.
  const testPasswordResult = await setStagingTestPasswords();

  // The live audit's own fixtures (docs/plans/audit-and-health-refresh-plan
  // .md D7). The wipe removes them, and before this step a refresh silently
  // left the audit unrunnable (found 2026-10-26). Runs LAST so the audit
  // accounts end on AUDIT_TEST_PASSWORD, not the shared staging password
  // the step above just set.
  const auditFixtures = await seedAuditFixtures({ testPassword: auditTestPassword });

  return {
    wipeResult,
    periodMonthMigration,
    serviceSeedResults,
    importSummary,
    superadminEmail: superadminUser.email,
    superadminCreated,
    providerScrubResult,
    testPasswordResult,
    auditFixtures: {
      counts: auditFixtures.counts,
      sessionsCreated: auditFixtures.sessionExtension.totals.created,
    },
  };
}

module.exports = { refreshStagingData };
