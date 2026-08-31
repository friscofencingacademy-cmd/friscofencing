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
const { scrubStripeFields } = require('./scrubStripeFields');
const { setStagingTestPasswords } = require('./setStagingTestPasswords');

async function refreshStagingData({ csvText, config, superadmin }) {
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

  // Explicit Stripe scrub (owner request, 2026-08-31) — the wipe + CSV-only
  // import already guarantee this today (see scrubStripeFields.js's own
  // comment for why), but this makes the guarantee a standing, self-
  // documenting step rather than an accident of the current data source
  // that a future change could quietly weaken.
  const stripeScrubResult = await scrubStripeFields();

  // One known password for every login-capable user (owner request,
  // 2026-08-31) — staging testing convenience ONLY; a migrated parent
  // otherwise has no password at all, and each real coach gets its own
  // distinct password from legacy-import.config.js.
  const testPasswordResult = await setStagingTestPasswords();

  return {
    wipeResult,
    periodMonthMigration,
    serviceSeedResults,
    importSummary,
    superadminEmail: superadminUser.email,
    superadminCreated,
    stripeScrubResult,
    testPasswordResult,
  };
}

module.exports = { refreshStagingData };
