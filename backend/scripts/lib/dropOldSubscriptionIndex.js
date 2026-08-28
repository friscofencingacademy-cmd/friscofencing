const Subscription = require('../../src/models/subscription.model');

// The compound index Guard A used before docs/decisions/005-one-active-
// subscription-per-student.md tightened it to {studentId} alone. Mongoose's
// autoIndex creates the NEW index on deploy but never drops an old one that
// no longer matches the schema — the two simply coexist (harmless, since
// the new index is strictly tighter, just redundant). This is the one-time
// cleanup for that redundancy on an already-deployed database.
const OLD_INDEX_NAME = 'studentId_1_scheduleId_1';

// Dry-run by default: reports whether the old index exists without
// dropping it. Pass `{ apply: true }` to actually drop it. A no-op (not an
// error) when the index is already absent — safe to re-run.
async function dropOldSubscriptionIndex({ apply = false } = {}) {
  const indexes = await Subscription.collection.indexes();
  const oldIndexExists = indexes.some((index) => index.name === OLD_INDEX_NAME);

  if (!oldIndexExists) {
    return { existed: false, dropped: false };
  }

  if (apply) {
    await Subscription.collection.dropIndex(OLD_INDEX_NAME);
  }

  return { existed: true, dropped: apply };
}

module.exports = { dropOldSubscriptionIndex, OLD_INDEX_NAME };
