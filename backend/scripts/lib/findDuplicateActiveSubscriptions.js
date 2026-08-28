const Subscription = require('../../src/models/subscription.model');

// Read-only diagnostic for docs/decisions/005-one-active-subscription-per-
// student.md's migration pre-flight — Guard A's tightened index ({
// studentId: 1 }, unique, partial on status:'active') will FAIL to build if
// any student already holds 2+ active subscriptions (legitimate under the
// OLD {studentId, scheduleId} scope, e.g. a student enrolled in two levels).
// Never writes anything; report only, so the owner can decide manual
// cleanup (cancel one, or confirm both) before the index swap ships.
async function findDuplicateActiveSubscriptions() {
  const duplicates = await Subscription.aggregate([
    { $match: { status: 'active' } },
    {
      $group: {
        _id: '$studentId',
        count: { $sum: 1 },
        subscriptionIds: { $push: '$_id' },
        scheduleIds: { $push: '$scheduleId' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  const scannedCount = await Subscription.countDocuments({ status: 'active' });

  return {
    scannedCount,
    duplicates: duplicates.map((entry) => ({
      studentId: entry._id,
      count: entry.count,
      subscriptionIds: entry.subscriptionIds,
      scheduleIds: entry.scheduleIds,
    })),
  };
}

module.exports = { findDuplicateActiveSubscriptions };
