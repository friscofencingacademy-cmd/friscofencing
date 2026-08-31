// Deletes every document from every collection on whatever database
// `mongoose` is currently connected to. No allowlist, no exceptions — the
// caller (scripts/wipe-staging-environment.js, scripts/refreshStagingData.js)
// is what's responsible for guarding WHICH database this ever runs against.
// This function itself has no opinion on staging vs. production; never call
// it without a guard already having run.
//
// Enumerates collections from the DATABASE itself (listCollections()), not
// from mongoose.connection.collections — the latter only contains an entry
// for a model that has been require()d somewhere in the running process
// (docs/plans/booking-and-private-class-fixes-plan.md §3, root-caused
// 2026-08-31: a real staging incident where PrivateClassSchedule/
// PrivateClassSession rows survived every refresh-staging-data.js run,
// because that script's require graph never loads those two models). A
// caller's require graph is not a reliable proxy for "what's actually in
// the database" — this makes the "no allowlist, no exceptions" comment
// above actually true, and future-proofs every model added later that a
// given caller's require graph doesn't happen to touch.
const mongoose = require('mongoose');

async function wipeDatabase() {
  const collectionInfos = await mongoose.connection.db.listCollections().toArray();
  const results = {};

  for (const { name } of collectionInfos) {
    // system.* namespaces (e.g. system.views) aren't wipeable user data and
    // deleteMany against one would just error — skip them, same as the old
    // model-registry approach implicitly did by construction.
    if (name.startsWith('system.')) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop -- sequential by design, a
    // handful of collections, no benefit to parallelizing a one-off wipe.
    const { deletedCount } = await mongoose.connection.db.collection(name).deleteMany({});
    results[name] = deletedCount;
  }

  return results;
}

module.exports = { wipeDatabase };
