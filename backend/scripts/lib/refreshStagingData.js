// Composes the full "clean slate" sequence the owner asked for
// (2026-08-24): wipe everything, bring the new legacy data in, then make
// sure superadmin exists again. One call, one Mongo connection — the CLI
// wrapper (scripts/refresh-staging-data.js) only handles argv/env/guarding.

const { wipeDatabase } = require('./wipeDatabase');
const { runLegacyImport } = require('./runLegacyImport');
const { seedSuperadmin } = require('./seedSuperadmin');

async function refreshStagingData({ csvText, config, superadmin }) {
  const wipeResult = await wipeDatabase();
  const importSummary = await runLegacyImport({ csvText, config });
  const { superadmin: superadminUser, created: superadminCreated } = await seedSuperadmin(superadmin);

  return {
    wipeResult,
    importSummary,
    superadminEmail: superadminUser.email,
    superadminCreated,
  };
}

module.exports = { refreshStagingData };
