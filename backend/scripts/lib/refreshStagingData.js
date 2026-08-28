// Composes the full "clean slate" sequence the owner asked for
// (2026-08-24): wipe everything, bring the new legacy data in, then make
// sure superadmin exists again. One call, one Mongo connection — the CLI
// wrapper (scripts/refresh-staging-data.js) only handles argv/env/guarding.

const { wipeDatabase } = require('./wipeDatabase');
const { seedServices } = require('./seedServices');
const { runLegacyImport } = require('./runLegacyImport');
const { seedSuperadmin } = require('./seedSuperadmin');

async function refreshStagingData({ csvText, config, superadmin }) {
  const wipeResult = await wipeDatabase();
  // Services seeded BEFORE the legacy import — the import writes real
  // Registration ledger rows (docs/plans/service-registry-unified-ledger-
  // plan.md), which require a resolvable serviceId. A refresh that left
  // this collection empty would make every ledger write in the import fail.
  const serviceSeedResults = await seedServices();
  const importSummary = await runLegacyImport({ csvText, config });
  const { superadmin: superadminUser, created: superadminCreated } = await seedSuperadmin(superadmin);

  return {
    wipeResult,
    serviceSeedResults,
    importSummary,
    superadminEmail: superadminUser.email,
    superadminCreated,
  };
}

module.exports = { refreshStagingData };
