const { SubscriptionCycleRegistration, periodMonthOf } = require('../../src/models/registration.model');

const OLD_INDEX_NAME = 'subscriptionId_1_periodStart_1';
const NEW_INDEX_NAME = 'subscriptionId_1_periodMonth_1';

// One-time migration for docs/plans/payment-airtight-plan.md D7 — backfills
// periodMonth on every existing subscription_cycle ledger row (the schema's
// own pre-validate hook only fires on a NEW save; a row that already
// existed before this field was added never gets it retroactively on its
// own), then swaps Guard B's unique index from the exact (subscriptionId,
// periodStart) pair to (subscriptionId, periodMonth) — so a duplicate
// payment for the same calendar month collides regardless of which day
// within it either row anchors to.
//
// Safety: dry-run by default (report only, no writes, no index changes).
// Before ANY write, scans every row's WOULD-BE periodMonth value and aborts
// the entire run — nothing written, index untouched — if two pending/
// completed rows for the same subscription would land in the same
// periodMonth bucket. Under this codebase's real history that should never
// happen: every existing row's periodStart already came from
// resolveFirstChargePeriod (the initial charge) or renewOne's own
// currentPeriodEnd -> +1-month stepping (a renewal), one row per calendar
// month by construction, long before an admin could anchor a second row
// mid-month — this check exists to make that assumption VERIFIED against
// the real database, not merely assumed.
async function migratePeriodMonth({ apply = false } = {}) {
  const rows = await SubscriptionCycleRegistration.find({}, 'subscriptionId periodStart periodMonth status').lean();

  const computed = rows.map((row) => ({
    _id: row._id,
    subscriptionId: row.subscriptionId,
    status: row.status,
    oldPeriodMonth: row.periodMonth ?? null,
    newPeriodMonth: periodMonthOf(row.periodStart),
  }));

  // Collision check, scoped to pending/completed rows only (Guard B's own
  // partial filter) — grouped by (subscriptionId, newPeriodMonth).
  const buckets = new Map();
  const collisions = [];

  computed.forEach((row) => {
    if (row.status !== 'pending' && row.status !== 'completed') {
      return;
    }

    const key = `${row.subscriptionId}:${row.newPeriodMonth}`;
    const existingRowId = buckets.get(key);

    if (existingRowId) {
      collisions.push({ subscriptionId: row.subscriptionId, periodMonth: row.newPeriodMonth, rowIds: [existingRowId, row._id] });
    } else {
      buckets.set(key, row._id);
    }
  });

  const changes = computed.filter((row) => row.oldPeriodMonth !== row.newPeriodMonth);

  if (collisions.length > 0) {
    return {
      scannedCount: rows.length,
      changeCount: changes.length,
      changes,
      collisions,
      aborted: true,
      indexSwapped: false,
    };
  }

  if (apply) {
    // eslint-disable-next-line no-restricted-syntax -- sequential writes,
    // a one-time migration over a small dataset; no benefit to Promise.all.
    for (const row of changes) {
      // eslint-disable-next-line no-await-in-loop
      await SubscriptionCycleRegistration.updateOne({ _id: row._id }, { $set: { periodMonth: row.newPeriodMonth } });
    }
  }

  let indexSwapped = false;

  if (apply) {
    const indexes = await SubscriptionCycleRegistration.collection.indexes();
    const oldIndexExists = indexes.some((index) => index.name === OLD_INDEX_NAME);
    const newIndexExists = indexes.some((index) => index.name === NEW_INDEX_NAME);

    if (!newIndexExists) {
      await SubscriptionCycleRegistration.collection.createIndex(
        { subscriptionId: 1, periodMonth: 1 },
        {
          name: NEW_INDEX_NAME,
          unique: true,
          partialFilterExpression: {
            status: { $in: ['pending', 'completed'] },
            subscriptionId: { $exists: true },
          },
        }
      );
    }

    if (oldIndexExists) {
      await SubscriptionCycleRegistration.collection.dropIndex(OLD_INDEX_NAME);
    }

    indexSwapped = true;
  }

  return {
    scannedCount: rows.length,
    changeCount: changes.length,
    changes,
    collisions: [],
    aborted: false,
    indexSwapped,
  };
}

module.exports = { migratePeriodMonth, OLD_INDEX_NAME, NEW_INDEX_NAME };
