// Deletes every document from every collection on whatever database
// `mongoose` is currently connected to. No allowlist, no exceptions — the
// caller (scripts/wipe-staging-environment.js, scripts/refreshStagingData.js)
// is what's responsible for guarding WHICH database this ever runs against.
// This function itself has no opinion on staging vs. production; never call
// it without a guard already having run.

const mongoose = require('mongoose');

async function wipeDatabase() {
  const { collections } = mongoose.connection;
  const results = {};

  for (const [name, collection] of Object.entries(collections)) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, a
    // handful of collections, no benefit to parallelizing a one-off wipe.
    const { deletedCount } = await collection.deleteMany({});
    results[name] = deletedCount;
  }

  return results;
}

module.exports = { wipeDatabase };
