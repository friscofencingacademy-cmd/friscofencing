const GroupClassSession = require('../../src/models/groupClassSession.model');
const Subscription = require('../../src/models/subscription.model');
const { SubscriptionCycleRegistration } = require('../../src/models/registration.model');
const { dateOnlyUTC } = require('../../src/utils/dateShapes');

// One-time migration for docs/plans/utc-date-standard-plan.md §4.4 —
// normalizes every calendar-day sentinel field currently in the database
// to true UTC midnight of its own UTC calendar day. Fixes the shape
// contamination this plan's PR 2 also stops at the source: sessions
// generated before the fix are Eastern-midnight (~04:00Z, the owner's
// original dev-machine data) or Central-midnight (~05:00Z/06:00Z, the
// interim generator this PR replaces) instants instead of true UTC-midnight
// sentinels, and that contamination propagates into Subscription/
// Registration period fields via registration.service.js's anchorDate
// whenever a parent picked a contaminated session date as their start date.
//
// Dry-run by default: returns the report without writing anything. Pass
// `{ apply: true }` to actually persist the normalization — same contract
// as scripts/lib/realignBillingAnchors.js.
//
// Truncation is safe (lands on the INTENDED calendar day) for every shape
// actually produced by this codebase's own generators — Eastern (~04:00Z),
// Central (~05:00Z/06:00Z), and clean UTC (00:00Z) all fall well before UTC
// noon. A value at or past UTC noon would mean an EAST-of-UTC creation
// (truncating would land on the WRONG day, one day too early) — this
// migration has never knowingly produced one, but aborts loudly rather than
// silently mis-truncating if one is ever found.
const HOUR_ABORT_THRESHOLD = 12;

function msSinceUtcMidnight(date) {
  return (
    date.getUTCHours() * 3600000 +
    date.getUTCMinutes() * 60000 +
    date.getUTCSeconds() * 1000 +
    date.getUTCMilliseconds()
  );
}

// The per-value decision, extracted so it's independently unit-testable
// (docs/plans/utc-date-standard-plan.md §4.4) — the script itself stays a
// thin runner over this.
function normalizeSentinelValue(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return { action: 'skip' };
  }

  if (msSinceUtcMidnight(value) === 0) {
    return { action: 'keep' };
  }

  if (value.getUTCHours() >= HOUR_ABORT_THRESHOLD) {
    return {
      action: 'abort',
      reason: `UTC hour ${value.getUTCHours()} >= ${HOUR_ABORT_THRESHOLD} — possible east-of-UTC creation; truncating to UTC midnight could land on the wrong calendar day`,
    };
  }

  return { action: 'truncate', newValue: dateOnlyUTC(value) };
}

// Every sentinel field this migration knows about, table-driven. `unique`
// (optional) names the fields a collision pre-check must consider together
// before any write — mirrors the model's own DB-level unique index, scoped
// the same way (`statusIn`, when given, matches that index's partial-filter
// scope).
const TARGETS = [
  {
    label: 'GroupClassSession.date',
    Model: GroupClassSession,
    fields: ['date'],
    unique: { keyFields: ['scheduleId'], dateField: 'date' },
  },
  {
    label: 'Subscription period fields',
    Model: Subscription,
    fields: ['currentPeriodStart', 'currentPeriodEnd', 'nextBillingDate'],
    // No date-based unique index on Subscription (Guard A is studentId +
    // active status only) — nothing to collision-check here.
    unique: null,
  },
  {
    label: 'SubscriptionCycleRegistration period fields',
    Model: SubscriptionCycleRegistration,
    fields: ['periodStart', 'periodEnd'],
    // Guard B (registration.model.js) is {subscriptionId, periodStart},
    // scoped to pending/completed rows only — 'failed' rows never collide.
    unique: { keyFields: ['subscriptionId'], dateField: 'periodStart', statusIn: ['pending', 'completed'] },
  },
];

// Groups this target's planned+existing values by its unique key (if any)
// to find any normalization that would collide with another row after
// truncation — either two rows being truncated onto the same value, or a
// row being truncated onto a value an untouched row already holds. Returns
// the set of change indices (into `changes`) to SKIP, never written.
function findCollisions(target, allDocs, changes) {
  if (!target.unique) return new Set();

  const { keyFields, dateField, statusIn } = target.unique;
  const scoped = statusIn ? allDocs.filter((doc) => statusIn.includes(doc.status)) : allDocs;

  // Every row's EFFECTIVE value after this run — the new value for a row
  // being changed, the existing value otherwise.
  const changeByDocId = new Map(changes.filter((c) => c.field === dateField).map((c) => [String(c.docId), c]));

  const buckets = new Map();

  scoped.forEach((doc) => {
    const change = changeByDocId.get(String(doc._id));
    const effectiveValue = change ? change.newValue : doc[dateField];

    if (!(effectiveValue instanceof Date)) return;

    const key = `${keyFields.map((f) => String(doc[f])).join('|')}|${effectiveValue.getTime()}`;

    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(doc._id);
  });

  const collidingDocIds = new Set();

  buckets.forEach((docIds) => {
    if (docIds.length > 1) {
      docIds.forEach((id) => collidingDocIds.add(String(id)));
    }
  });

  const skipIndices = new Set();

  changes.forEach((change, index) => {
    if (change.field === dateField && collidingDocIds.has(String(change.docId))) {
      skipIndices.add(index);
    }
  });

  return skipIndices;
}

async function normalizeDateSentinels({ apply = false } = {}) {
  const report = {
    applied: false,
    aborted: false,
    targets: [],
    changes: [],
    skippedCollisions: [],
  };

  for (const target of TARGETS) {
    // eslint-disable-next-line no-await-in-loop -- sequential over a small,
    // fixed list of targets; each scan is independent and the script's own
    // report ordering (matching TARGETS' declared order) is worth keeping.
    const docs = await target.Model.find({}, ['_id', 'status', ...new Set([...target.fields, ...(target.unique ? target.unique.keyFields : [])])].join(' '));

    const distribution = {};
    const targetChanges = [];
    let abortReason = null;

    docs.forEach((doc) => {
      target.fields.forEach((field) => {
        const value = doc[field];
        if (!(value instanceof Date)) return;

        const hour = value.getUTCHours();
        distribution[hour] = (distribution[hour] || 0) + 1;

        const decision = normalizeSentinelValue(value);

        if (decision.action === 'abort' && !abortReason) {
          abortReason = { docId: doc._id, field, reason: decision.reason };
        }

        if (decision.action === 'truncate') {
          targetChanges.push({
            collection: target.label,
            docId: doc._id,
            field,
            oldValue: value,
            newValue: decision.newValue,
          });
        }
      });
    });

    if (abortReason) {
      report.aborted = true;
      report.targets.push({
        label: target.label,
        scannedCount: docs.length,
        distribution,
        abortReason,
      });
      // Abort the WHOLE run, not just this target — even under apply,
      // nothing gets written once any field anywhere fails the safety
      // check (docs/plans/utc-date-standard-plan.md §4.4 D5).
      return report;
    }

    const skipIndices = findCollisions(target, docs, targetChanges);

    targetChanges.forEach((change, index) => {
      if (skipIndices.has(index)) {
        report.skippedCollisions.push(change);
      } else {
        report.changes.push(change);
      }
    });

    report.targets.push({
      label: target.label,
      scannedCount: docs.length,
      distribution,
      changeCount: targetChanges.length - skipIndices.size,
    });
  }

  if (apply && report.changes.length > 0) {
    // Sequential by design, same reasoning as realignBillingAnchors.js — a
    // one-time migration over a bounded collection, not a hot path.
    for (const change of report.changes) {
      const target = TARGETS.find((t) => t.label === change.collection);
      // eslint-disable-next-line no-await-in-loop -- see comment above.
      await target.Model.updateOne({ _id: change.docId }, { $set: { [change.field]: change.newValue } });
    }

    report.applied = true;
  }

  return report;
}

module.exports = { normalizeDateSentinels, normalizeSentinelValue };
